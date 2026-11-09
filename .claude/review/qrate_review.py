#!/usr/bin/env python3
"""QRate pre-push review gate.

One file, three entry points:

  qrate_review.py key [REPO_DIR]   -> print the review key for the commits REPO_DIR would push
  qrate_review.py gate             -> PreToolUse hook (Bash/Edit/Write): block unreviewed pushes
  qrate_review.py record           -> SubagentStop hook: turn a qrate-reviewer verdict into a marker

Review key = sha1 of the diff merge-base(upstream, HEAD)..HEAD with 3 lines of context, whitespace
KEPT, and only the hunk line numbers and blob ids stripped. So the key survives the mandatory
`fetch && rebase origin/main` before a push (the SHA and line numbers change, the change does not),
but any edit to the change, including re-indenting it or moving it, means a new key and a new review.
A repo with nothing upstream yet (a first push) is diffed against the empty tree.

Markers live in <git-common-dir>/qrate-review/<key>.json — inside .git, so never committed and
shared by every worktree of the repo. ONLY the SubagentStop hook writes them; the gate refuses
any tool call that touches that directory, so a builder agent cannot self-approve.

Scope: repos whose `origin` is a QRate GitHub org (see QRATE_REMOTE). Everything else passes.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

GATE_VERSION = "2026-11-09.2"  # bump on EVERY change — sync_gate.py refuses to overwrite a newer copy
REVIEW_HOME = Path(__file__).resolve().parent
# Logs are per-USER, not per-repo: a hook writing into the work tree would dirty `git status`.
LOG_HOME = Path(os.environ.get("CLAUDE_CONFIG_DIR") or (Path.home() / ".claude")) / "qrate-review-logs"
FINDINGS_LOG = LOG_HOME / "findings.jsonl"
BYPASS_LOG = LOG_HOME / "bypass.log"
GATE_LOG = LOG_HOME / "gate.log"
MARKER_DIRNAME = "qrate-review"
REVIEWER_AGENT = "qrate-reviewer"
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
QRATE_REMOTE = re.compile(r"github\.com[:/](QRateCore|qrate-builder)/", re.I)
VERDICT_LINE = re.compile(
    r"QRATE-REVIEW\s+repo=(?P<repo>\S+)\s+key=(?P<key>[0-9a-f]{40}|none)\s+verdict=(?P<verdict>PASS|BLOCK)",
)
FINDINGS_BLOCK = re.compile(r"```(?:json)?\s*QRATE-FINDINGS\s*\n(?P<body>.*?)```", re.S)
GH_WRITE_PATH = re.compile(r"repos/(?P<org>[^/\s]+)/[^/\s]+/"
                           r"(contents|git/|merges|pulls/\d+/merge|branches/[^/\s]+/rename)", re.I)
GH_QRATE_ORG = re.compile(r"^(QRateCore|qrate-builder)$", re.I)
GH_PLACEHOLDER_ORG = re.compile(r"^(\{owner\}|:owner|\$\{?\w+\}?|.*\$.*)$")
GH_GRAPHQL_WRITE = re.compile(r"createCommitOnBranch|mergePullRequest|updateRef|createRef|deleteRef|"
                              r"enablePullRequestAutoMerge|mergeBranch|updateRefs", re.I)
GH_WRITE_METHOD = re.compile(r"(-X|--method)[\s=]*['\"]?(PUT|POST|PATCH|DELETE)", re.I)
GH_READ_METHOD = re.compile(r"(-X|--method)[\s=]*['\"]?(GET|HEAD)\b", re.I)
GH_FIELDS = re.compile(r"\s(-f|-F|--field|--raw-field|--input)[\s=]")
READ_ONLY_CMDS = {"ls", "cat", "head", "tail", "jq", "find", "grep", "wc", "stat", "less"}
GIT_PUSH = re.compile(r"(?:^|[\s;&|(])git(?P<opts>(?:\s+-[Cc]\s+\S+|\s+--[\w-]+(?:=\S+)?)*)\s+push\b")


# ----------------------------------------------------------------------------- git helpers
def _git(repo: str, *args: str) -> str:
    out = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip() or f"git {' '.join(args)} failed")
    return out.stdout.strip()


def toplevel(path: str) -> str | None:
    try:
        return _git(path, "rev-parse", "--show-toplevel")
    except Exception:
        return None


def repo_root(path: str) -> str | None:
    """Work-tree top level, or the absolute git dir when run from inside .git or a bare clone."""
    top = toplevel(path)
    if top:
        return top
    try:
        return _git(path, "rev-parse", "--absolute-git-dir")
    except Exception:
        return None


def is_qrate_repo(repo: str) -> bool:
    try:
        return bool(QRATE_REMOTE.search(_git(repo, "remote", "get-url", "origin")))
    except Exception:
        return False


def upstream_ref(repo: str) -> str | None:
    for ref in ("@{u}", "origin/main", "origin/master", "origin/HEAD"):
        try:
            _git(repo, "rev-parse", "--verify", "--quiet", ref)
            return ref
        except Exception:
            continue
    return None


def _exists(repo: str, rev: str) -> bool:
    try:
        _git(repo, "rev-parse", "--verify", "--quiet", rev)
        return True
    except Exception:
        return False


def review_key(repo: str, src: str = "HEAD", dst: str | None = None, remote: str = "origin",
               remote_sha: str | None = None) -> tuple[str | None, str]:
    """Return (key, explanation) for pushing `src` (default HEAD) to `dst` on `remote`.
    key None => nothing to review. `remote_sha` (the remote's current tip, from a pre-push hook)
    is the most exact base when we have that commit locally."""
    up = None
    if remote_sha and set(remote_sha) != {"0"} and _exists(repo, f"{remote_sha}^{{commit}}"):
        up = remote_sha
    elif src != "HEAD" or dst:
        branch = (dst or src).replace("refs/heads/", "")
        for ref in dict.fromkeys((f"{remote}/{branch}", f"{remote}/main", f"{remote}/master",
                                  "origin/main", "origin/master")):
            if _exists(repo, ref):
                up = ref
                break
    else:
        up = upstream_ref(repo)
    head = _git(repo, "rev-parse", "--verify", f"{src}^{{commit}}")
    if up is None:
        base, label = EMPTY_TREE, "nothing upstream yet (first push): whole tree"
    else:
        base = _git(repo, "merge-base", up, head)
        if base == head:
            return None, f"{src} is already contained in {up} — nothing to push"
        ahead = _git(repo, "rev-list", "--count", f"{base}..{head}")
        label = f"{ahead} commit(s) ahead of {up} (base {base[:10]})"
    diff = subprocess.run(
        ["git", "-C", repo, "diff", "-U3", "--binary", "--no-color", "--no-ext-diff", "--no-textconv",
         "--no-renames", "--diff-algorithm=myers", "--src-prefix=a/", "--dst-prefix=b/", base, head],
        capture_output=True, timeout=60,
    )
    if diff.returncode != 0:
        raise RuntimeError(diff.stderr.decode(errors="replace").strip() or "git diff failed")
    if not diff.stdout.strip():
        return None, "commits ahead have an empty net diff"
    norm = []
    for line in diff.stdout.split(b"\n"):
        if line.startswith(b"index "):
            continue  # blob ids change when the base moves under a rebase
        if line.startswith(b"@@"):
            line = b"@@"  # line numbers change under a rebase; the content and context don't
        norm.append(line)
    key = hashlib.sha1(b"\n".join(norm)).hexdigest()
    return key, label


def marker_dir(repo: str) -> Path:
    common = _git(repo, "rev-parse", "--git-common-dir")
    p = Path(common)
    if not p.is_absolute():
        p = Path(repo) / p
    return p / MARKER_DIRNAME


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _append(path: Path, line: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as fh:
            fh.write(line.rstrip("\n") + "\n")
    except Exception:
        pass


# ----------------------------------------------------------------------------- push parsing
def _segments(command: str) -> list[str]:
    # Split on shell control operators; good enough for agent-written one-liners.
    return [s for s in re.split(r"&&|\|\||;|\n|\|", command) if s.strip()]


_CONTROL = {"&&", "||", ";", "|", "&", "(", ")", ";;", "|&", "\n"}
_WRAPPERS = {"command", "builtin", "exec", "time", "nice", "nohup", "sudo", "env", "xargs"}
_SHELLS = {"bash", "sh", "zsh", "dash"}


UNRESOLVED = "*UNRESOLVED*"
_KEYWORDS = {"do", "then", "else", "elif", "if", "while", "until", "{", "!", "}"}


def _expand(arg: str, env: dict) -> str:
    """Expand $VAR/${VAR} from assignments seen earlier in the command, then the hook's environment.
    Anything still dynamic ($(..), backticks, loop variables) => UNRESOLVED (the gate fails closed)."""
    def sub(m: "re.Match") -> str:
        name = m.group(1) or m.group(2)
        val = env.get(name, os.environ.get(name))
        return val if val is not None else m.group(0)
    out = re.sub(r"\$\{(\w+)\}|\$(\w+)", sub, arg)
    if "$" in out or "`" in out or UNRESOLVED in out:
        return UNRESOLVED
    return os.path.expanduser(out)


def _resolve(cur: str, arg: str, env: dict | None = None) -> str:
    arg = _expand(arg, env or {})
    if arg == UNRESOLVED:
        return UNRESOLVED
    if os.path.isabs(arg):
        return os.path.normpath(arg)
    return UNRESOLVED if cur == UNRESOLVED else os.path.normpath(os.path.join(cur, arg))


def push_targets(command: str, cwd: str, _depth: int = 0) -> list[tuple]:
    """Directories in which `command` runs a `git push` AS A COMMAND (not inside a quoted string),
    resolved in order of `cd`s. Recurses into `bash -c '...'` / `eval '...'`."""
    try:
        lex = shlex.shlex(command.replace("\n", " ; "), posix=True, punctuation_chars=";&|()")
        lex.whitespace_split = True
        tokens = list(lex)
    except Exception:
        return _push_targets_regex(command, cwd)

    targets: list[tuple] = []  # (dir, refspecs)
    cur = cwd
    seg: list[str] = []
    env: dict = {}

    def flush(words: list[str]) -> None:
        nonlocal cur
        w = list(words)
        while w and w[0] in _KEYWORDS:
            w.pop(0)
        if w and w[0] == "export":
            w.pop(0)
        if w and all(re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", x) for x in w):
            for x in w:  # standalone assignments: remember them for later $VAR expansion
                k, _, v = x.partition("=")
                env[k] = _expand(v, env)
            return
        repo_override = False
        while w and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w[0]) or w[0] in _WRAPPERS or w[0] in _KEYWORDS):
            if re.match(r"^GIT_(DIR|WORK_TREE)=", w[0]):
                repo_override = True
            w.pop(0)
        if w and w[0] == "timeout":
            w = w[1:]
            while w and (w[0].startswith("-") or re.match(r"^\d+[smhd]?$", w[0])):
                w.pop(0)
        if not w:
            return
        if w[0] in ("cd", "pushd") and len(w) > 1:
            cur = _resolve(cur, w[1], env)
            return
        if _depth < 3 and ((w[0] in _SHELLS and "-c" in w[1:-1]) or w[0] == "eval"):
            inner = w[w.index("-c") + 1] if w[0] in _SHELLS else " ".join(w[1:])
            targets.extend(push_targets(inner, cur, _depth + 1))
            return
        if os.path.basename(w[0]) != "git":
            return
        d, i = (UNRESOLVED if repo_override or "GIT_DIR" in env else cur), 1
        gitdir_override = d == UNRESOLVED
        while i < len(w) and w[i].startswith("-"):
            if w[i].startswith(("--git-dir", "--work-tree")):
                gitdir_override = True
            if w[i] in ("-C", "-c", "--git-dir", "--work-tree", "--namespace") and i + 1 < len(w):
                if w[i] == "-C":
                    d = _resolve(d, w[i + 1], env)
                i += 2
            else:
                i += 1
        if gitdir_override:
            d = UNRESOLVED
        if i < len(w) and w[i] == "push":
            # Refspecs: `git push [opts] <remote> [<src>[:<dst>] ...]`. Recorded per target so the gate
            # reviews what is ACTUALLY pushed, not just HEAD (e.g. `git push origin <sha>:main`).
            args, j = w[i + 1:], 0
            pos: list[str] = []
            force: list[str] = []
            while j < len(args):
                a = args[j]
                if a in ("--all", "--mirror", "--branches"):
                    pos.append("*ALL*")
                elif a in ("--delete", "-d"):
                    pos.append("*DELETE*")
                elif a.startswith("--force") or re.match(r"^-[A-Za-z]*f[A-Za-z]*$", a):
                    force.append(a)
                elif a in ("--repo", "-o", "--push-option", "--receive-pack", "--exec"):
                    j += 1
                elif not a.startswith("-"):
                    pos.append(a)
                j += 1
            specs = tuple(pos[1:]) if "*DELETE*" not in pos else ("*DELETE*",)
            if force or any(x.startswith("+") for x in pos[1:]):
                specs = specs + ("*FORCE*",)
            targets.append((d, specs))

    for t in tokens:
        if t in _CONTROL or set(t) <= set(";&|()"):
            flush(seg)
            seg = []
        else:
            seg.append(t)
    flush(seg)
    return targets


def gh_writes(command: str, cwd: str = "", _depth: int = 0) -> bool:
    """True if `command` RUNS a GitHub-side write to a QRate repo (`gh pr merge`, a `gh api` REST write to
    contents/refs/merges, or a graphql ref/commit/merge mutation) — not merely mentions one."""
    def cwd_is_qrate() -> bool:
        r = repo_root(cwd) if cwd and os.path.isdir(cwd) else None
        return bool(r and is_qrate_repo(r))
    try:
        lex = shlex.shlex(command.replace("\n", " ; "), posix=True, punctuation_chars=";&|()")
        lex.whitespace_split = True
        tokens = list(lex)
    except Exception:
        return bool(re.search(r"(?:^|[\s;&|(])gh\s+(pr\s+merge|api\b)", command))  # unparseable: over-match
    segs, cur = [], []
    for t in tokens + [";"]:
        if t in _CONTROL or set(t) <= set(";&|()"):
            if cur:
                segs.append(cur)
            cur = []
        else:
            cur.append(t)
    for w in segs:
        while w and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w[0]) or w[0] in _WRAPPERS or w[0] in _KEYWORDS):
            w = w[1:]
        if not w:
            continue
        if _depth < 3 and ((w[0] in _SHELLS and "-c" in w[1:-1]) or w[0] == "eval"):
            inner = w[w.index("-c") + 1] if w[0] in _SHELLS else " ".join(w[1:])
            if gh_writes(inner, cwd, _depth + 1):
                return True
            continue
        if os.path.basename(w[0]) != "gh" or len(w) < 2:
            continue
        rest = " " + " ".join(w[1:])
        if w[1] == "pr" and len(w) > 2 and w[2] == "merge":
            m = re.search(r"\s(?:-R|--repo)[\s=]+(\S+)", rest)
            if (m and re.match(r"^(github\.com/)?(QRateCore|qrate-builder)/", m.group(1), re.I)) or (not m and cwd_is_qrate()):
                return True
            continue
        if w[1] != "api":
            continue
        if len(w) > 2 and w[2] == "graphql":
            if GH_GRAPHQL_WRITE.search(rest):
                return True  # mutations name repos by node id: can't scope them, so fail closed
            continue
        m = GH_WRITE_PATH.search(rest)
        if not m:
            continue
        org = m.group("org")
        if not (GH_QRATE_ORG.match(org) or (GH_PLACEHOLDER_ORG.match(org) and cwd_is_qrate())
                or (org.startswith("$") or "$" in org)):
            continue
        if GH_WRITE_METHOD.search(rest) or (GH_FIELDS.search(rest) and not GH_READ_METHOD.search(rest)):
            return True
    return False


def _push_targets_regex(command: str, cwd: str) -> list[tuple]:
    """Fallback for commands shlex cannot parse (unbalanced quotes): over-match rather than miss."""
    targets: list[str] = []
    cur = cwd
    for seg in _segments(command):
        seg_s = seg.strip().lstrip("(").strip()
        m_cd = re.match(r"^(?:builtin\s+)?(?:cd|pushd)\s+(.+)$", seg_s)
        if m_cd:
            try:
                arg = shlex.split(m_cd.group(1))[0]
            except Exception:
                arg = m_cd.group(1).split()[0]
            arg = os.path.expanduser(os.path.expandvars(arg))
            cur = arg if os.path.isabs(arg) else os.path.normpath(os.path.join(cur, arg))
            continue
        m = GIT_PUSH.search(" " + seg_s)
        if not m:
            continue
        d = cur
        m_c = re.search(r"-C\s+(\S+)", m.group("opts") or "")
        if m_c:
            arg = os.path.expanduser(m_c.group(1).strip("'\""))
            d = arg if os.path.isabs(arg) else os.path.normpath(os.path.join(cur, arg))
        targets.append((d, ("*UNPARSED*",)))
    return targets


# ----------------------------------------------------------------------------- hook output
def _deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def cmd_gate() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # never wedge the session on malformed input
    tool = data.get("tool_name", "")
    ti = data.get("tool_input") or {}
    cwd = data.get("cwd") or os.getcwd()

    # 1. Nobody but the SubagentStop hook writes approval markers.
    touched = " ".join(str(ti.get(k, "")) for k in ("command", "file_path", "path", "notebook_path"))
    if re.search(rf"\.git/{MARKER_DIRNAME}(/|[\s'\"]|$)", touched):
        def _seg_ro(seg: str) -> bool:
            s = re.sub(r"\d?>>?\s*/dev/null|2>&1", "", seg)
            if f"/{MARKER_DIRNAME}" not in s:
                return True  # only segments that touch the marker dir must be read-only
            return ">" not in s and (s.split() or [""])[0] in READ_ONLY_CMDS
        read_only = tool in ("Read", "Grep", "Glob") or (
            tool == "Bash" and all(_seg_ro(seg) for seg in _segments(touched))
        )
        if not read_only:
            _deny(
                "QRate review gate: approval markers under .git/qrate-review/ are written only by the "
                "qrate-reviewer SubagentStop hook. Do not create, edit or delete them — run the "
                "qrate-reviewer subagent instead (see .claude/rules/qrate-code-review-gate.md)."
            )

    if tool != "Bash":
        sys.exit(0)
    command = ti.get("command", "")
    bypass = re.search(r"QRATE_REVIEW_BYPASS=(\"[^\"]*\"|'[^']*'|\S+)", command)

    # 2. Ways to change a QRate repo on GitHub without a local push (no PRs here; see git-workflow.md).
    if "gh" in command and gh_writes(command, cwd):
        if bypass:
            _append(BYPASS_LOG, json.dumps({"ts": _now(), "github_api_write": command[:300],
                                            "reason": bypass.group(1).strip("'\""), "session": data.get("session_id")}))
        else:
                _deny("QRate review gate: changing a QRate repo through the GitHub API (`gh pr merge`, or "
                      "`gh api` writes to contents/refs/merges) skips the pre-push review. Commit locally, get a "
                      "qrate-reviewer PASS, and push. See .claude/rules/qrate-code-review-gate.md.")

    if "push" not in command or "git" not in command:
        sys.exit(0)

    targets = push_targets(command, cwd)
    if not targets:
        sys.exit(0)

    problems: list[str] = []
    checks: list[tuple] = []
    for d, specs in dict.fromkeys(targets):
        if "*DELETE*" in specs:
            continue  # branch deletion — nothing to review
        if d == UNRESOLVED:
            problems.append("- a `git push` whose directory can't be resolved statically ($VAR from a loop, "
                            "$(...), backticks). The gate can't see what it pushes, so it fails closed: push each "
                            "repo with a literal path, e.g. `git -C /abs/path/repo push origin main`")
            continue
        if not os.path.isdir(d):
            problems.append(f"- a `git push` targeting {d}, which does not exist. The push would really run "
                            "somewhere else (e.g. after a failed `cd x;`), so the gate fails closed. Use a literal, "
                            "existing repo path.")
            continue
        repo = repo_root(d)
        if not repo or not is_qrate_repo(repo):
            continue
        if "*FORCE*" in specs:
            if bypass:
                _append(BYPASS_LOG, json.dumps({"ts": _now(), "repo": repo, "force": True,
                                                "reason": bypass.group(1).strip("'\""),
                                                "session": data.get("session_id")}))
            else:
                problems.append(f"- {repo}: force push (`--force`, `-f`, `--force-with-lease` or a `+` refspec). "
                                "Force pushes are forbidden here: fetch, rebase and push plainly. If it still "
                                "won't go, stop and ask the user.")
                continue
            specs = tuple(x for x in specs if x != "*FORCE*")
        if "*ALL*" in specs or "*UNPARSED*" in specs:
            problems.append(f"- {repo}: push form not supported by the gate (--all/--mirror or unparseable "
                            "quoting) — push one explicit ref, e.g. `git push origin main`")
            continue
        pairs = []
        for s in specs or ("HEAD",):
            s = s.lstrip("+")
            src, _, dst = s.partition(":")
            if not src or src.startswith("refs/tags/"):
                continue  # deletion or tag — nothing to review
            try:
                _git(repo, "rev-parse", "--verify", "--quiet", f"refs/tags/{src}")
                continue  # a bare tag name
            except Exception:
                pass
            pairs.append((src, dst or None))
        for src, dst in pairs:
            checks.append((repo, src, dst))
    for repo, src, dst in checks:
        try:
            key, why = review_key(repo, src, dst)
        except Exception as e:  # can't compute => fail closed, but say why
            problems.append(f"- {repo} ({src}): could not compute review key ({e})")
            continue
        if key is None:
            continue
        mk = marker_dir(repo) / f"{key}.json"
        if mk.exists():
            try:
                m = json.loads(mk.read_text())
            except Exception:
                m = {}
            if m.get("verdict") == "PASS":
                _append(GATE_LOG, json.dumps({"ts": _now(), "event": "push_allowed", "repo": repo, "key": key}))
                continue
        if bypass:
            reason = bypass.group(1).strip("'\"")
            _append(BYPASS_LOG, json.dumps({"ts": _now(), "repo": repo, "key": key, "reason": reason,
                                            "session": data.get("session_id")}))
            continue
        problems.append(
            f"- {repo}\n    {why}\n    review key {key} has no PASS verdict"
            + (" (last verdict: BLOCK — fix the findings, re-commit, re-review)" if mk.exists() else "")
        )

    if problems:
        _append(GATE_LOG, json.dumps({"ts": _now(), "event": "push_denied", "problems": problems}))
        _deny(
            "QRate review gate — push blocked: these changes have not passed independent review.\n"
            + "\n".join(problems)
            + "\n\nNext step: commit everything, then launch the `qrate-reviewer` subagent (Agent tool, "
            "subagent_type \"qrate-reviewer\") with the repo path(s), the intent of the change, and what you "
            "claim to have tested. On PASS the push is unlocked automatically. On BLOCK, fix or rebut each "
            "P0/P1 finding with evidence and re-review. Rebasing onto origin/main does NOT invalidate a PASS; "
            "changing the diff does. Genuine incident only, with the user's explicit OK: prefix the push with "
            "QRATE_REVIEW_BYPASS=\"<reason>\" (logged and reported). See .claude/rules/qrate-code-review-gate.md."
        )
    sys.exit(0)


# ----------------------------------------------------------------------------- record (SubagentStop)
def _last_assistant_text(data: dict) -> str:
    txt = data.get("last_assistant_message")
    if isinstance(txt, str) and txt.strip():
        return txt
    path = data.get("agent_transcript_path") or ""
    if not path or not os.path.exists(path):
        return ""
    last = ""
    try:
        with open(path) as fh:
            for line in fh:
                try:
                    ev = json.loads(line)
                except Exception:
                    continue
                msg = ev.get("message") or {}
                if ev.get("type") == "assistant" or msg.get("role") == "assistant":
                    content = msg.get("content")
                    if isinstance(content, str):
                        parts = [content]
                    else:
                        parts = [c.get("text", "") for c in content or [] if isinstance(c, dict) and c.get("type") == "text"]
                    t = "\n".join(p for p in parts if p)
                    if t.strip():
                        last = t
    except Exception:
        return last
    return last


def cmd_record() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if (data.get("agent_type") or "") != REVIEWER_AGENT:
        sys.exit(0)
    text = _last_assistant_text(data)
    lines = list(VERDICT_LINE.finditer(text))
    notes: list[str] = []
    findings_body = None
    fb = FINDINGS_BLOCK.search(text)
    if fb:
        try:
            findings_body = json.loads(fb.group("body"))
        except Exception:
            notes.append("QRATE-FINDINGS block was not valid JSON — findings not logged")

    if not lines:
        notes.append("qrate-reviewer ended without a QRATE-REVIEW verdict line — nothing recorded; push stays blocked")
    for m in lines:
        repo = repo_root(os.path.expanduser(m.group("repo")))
        verdict = m.group("verdict")
        claimed = m.group("key")
        if not repo:
            notes.append(f"{m.group('repo')}: not a git repo — ignored")
            continue
        try:
            actual, why = review_key(repo)
            if claimed != actual:  # the builder may push HEAD to main while tracking another branch
                for dst in ("main", "master"):
                    k2, w2 = review_key(repo, "HEAD", dst)
                    if k2 and k2 == claimed:
                        actual, why = k2, w2
                        break
        except Exception as e:
            notes.append(f"{repo}: could not recompute key ({e})")
            continue
        if actual is None:
            notes.append(f"{repo}: nothing to push ({why}) — no marker needed")
            continue
        if claimed != actual:
            notes.append(
                f"{repo}: reviewer reviewed key {claimed} but the repo now has {actual} — the change moved "
                "during review; re-run qrate-reviewer"
            )
            continue
        md = marker_dir(repo)
        md.mkdir(parents=True, exist_ok=True)
        rec = {
            "ts": _now(), "repo": repo, "key": actual, "verdict": verdict,
            "head": _git(repo, "rev-parse", "HEAD"), "detail": why,
            "session": data.get("session_id"), "agent_id": data.get("agent_id"),
        }
        (md / f"{actual}.json").write_text(json.dumps(rec, indent=2))
        notes.append(f"{repo}: {verdict} recorded for key {actual[:12]}"
                     + (" — push unlocked" if verdict == "PASS" else " — push stays blocked"))

    if isinstance(findings_body, dict):
        findings_body = findings_body.get("findings", [])
    for f in findings_body or []:
        if isinstance(f, dict):
            f.setdefault("ts", _now())
            f.setdefault("session", data.get("session_id"))
            _append(FINDINGS_LOG, json.dumps(f))

    # Surface the outcome to the orchestrating agent / user.
    print(json.dumps({"systemMessage": "QRate review gate: " + "; ".join(notes)}))
    sys.exit(0)


def cmd_key(argv: list[str]) -> None:
    repo = repo_root(argv[0] if argv else os.getcwd())
    if not repo:
        print("not a git repo", file=sys.stderr)
        sys.exit(2)
    key, why = review_key(repo)
    print(json.dumps({"repo": repo, "key": key or "none", "qrate_repo": is_qrate_repo(repo), "detail": why}))


if __name__ == "__main__":
    sub = sys.argv[1] if len(sys.argv) > 1 else ""
    if sub == "gate":
        cmd_gate()
    elif sub == "record":
        cmd_record()
    elif sub == "version":
        print(GATE_VERSION)
    elif sub == "key":
        cmd_key(sys.argv[2:])
    else:
        print(__doc__)
        sys.exit(2)
