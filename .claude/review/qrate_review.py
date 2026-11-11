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

GATE_VERSION = "2026-11-10.1"  # bump on EVERY change — sync_gate.py refuses to overwrite a newer copy
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
GH_WRITE_PATH = re.compile(r"repos(?:itories)?/(?P<org>[^/\s]+)/(?:[^/\s]+/)?"
                           r"(contents|git/|merges|pulls/\d+/merge|branches/[^/\s]+/rename)", re.I)
GH_GRAPHQL_WRITE = re.compile(r"createCommitOnBranch|mergePullRequest|updateRef|createRef|deleteRef|"
                              r"enablePullRequestAutoMerge|mergeBranch|updateRefs", re.I)
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
_WRAPPERS = {"command", "builtin", "exec", "time", "nice", "nohup", "sudo", "env", "xargs", "caffeinate"}
_SHELLS = {"bash", "sh", "zsh", "dash", "ksh", "mksh", "fish"}


UNRESOLVED = "*UNRESOLVED*"
_KEYWORDS = {"do", "then", "else", "elif", "if", "while", "until", "{", "!", "}", "coproc"}


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
                elif (a.startswith("--force") and a != "--force-if-includes") or re.match(r"^-[A-Za-z]*f[A-Za-z]*$", a):
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


_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_WRAPPER_VALUE_FLAGS = {
    "sudo": ("-u", "-g", "-C", "-h", "-p", "-U", "-D", "-r", "-t", "-T", "--user", "--group", "--close-from",
             "--host", "--prompt", "--other-user", "--chdir", "--role", "--type", "--command-timeout"),
    "xargs": ("-n", "-I", "-L", "-P", "-s", "-E", "-d", "-a", "--max-args", "--max-lines", "--max-procs",
              "--max-chars", "--eof", "--delimiter", "--arg-file", "--process-slot-var", "-J", "-R", "-S"),
    "exec": ("-a",),
    "nice": ("-n", "--adjustment"),
    "stdbuf": ("-i", "-o", "-e"),
}
_EXEC_FLAGS = {"-exec", "-execdir", "-ok", "-okdir"}


_HTTP_WRITE = {"PUT", "POST", "PATCH", "DELETE"}


def _unquote_all(text: str) -> str:
    from urllib.parse import unquote
    for _ in range(5):  # %2563 -> %63 -> c
        nxt = unquote(text)
        if nxt == text:
            break
        text = nxt
    return text


def _gh_api_is_write(args: list) -> bool:
    """Fail-closed. A write if: a bare PUT/POST/PATCH/DELETE token appears anywhere; or the explicit method
    (the value of `-X`/`-iX`/`--method`, separate, `=` or attached) is a write verb; or a field/body flag
    (`-f`, `-F`, `-if`, `--field`, `--raw-field`, `--input`) is present and the explicit method is not GET/HEAD.
    A GET token that is the value of some OTHER flag (`--template GET`, `-q GET`) does not count as a read."""
    explicit = None
    fields = False
    for i, a in enumerate(args):
        if a.upper() in _HTTP_WRITE:
            return True
        m = re.match(r"^(?:--method=?|-[A-Za-z]*X=?)(\w+)$", a)
        if m:
            explicit = m.group(1).upper()
        elif (a == "--method" or re.match(r"^-[A-Za-z]*X$", a)) and i + 1 < len(args):
            explicit = args[i + 1].upper()
        if a in ("--field", "--raw-field", "--input") or a.startswith(("--field=", "--raw-field=", "--input=")) \
                or re.match(r"^-[A-Za-z]*[fF]", a):
            fields = True
    if explicit in _HTTP_WRITE:
        return True
    if explicit in ("GET", "HEAD"):
        return False
    return fields


def _gh_aliases() -> dict:
    """gh aliases from gh's config (crude YAML read: `aliases:` then indented `name: expansion`)."""
    base = os.environ.get("GH_CONFIG_DIR") or os.path.join(
        os.environ.get("XDG_CONFIG_HOME") or os.path.join(str(Path.home()), ".config"), "gh")
    out, inside = {}, False
    try:
        for line in Path(base, "config.yml").read_text(errors="replace").splitlines():
            if re.match(r"^aliases:\s*$", line):
                inside = True
                continue
            if inside:
                m = re.match(r"^\s+([^\s:#][^:]*):\s*(.*)$", line)
                if m:
                    out[m.group(1).strip().strip("'\"")] = m.group(2).strip().strip("'\"")
                elif line.strip() and not line.startswith((" ", "\t", "#")):
                    inside = False
    except Exception:
        pass
    return out


def _expand_alias(exp: str, trailing: list) -> list:
    """gh's non-shell alias expansion: `$N` takes the Nth trailing arg; unused trailing args are appended."""
    used = set()

    def sub(m):
        k = int(m.group(1))
        used.add(k)
        return trailing[k - 1] if 0 < k <= len(trailing) else ""
    out = shlex.split(re.sub(r"\$(\d+)", sub, exp))  # substitute, THEN split (gh 2.85 behaviour)
    return out + [a for i, a in enumerate(trailing, 1) if i not in used]


def _gh_args_write(args: list, command: str, _depth: int = 0, dyn: list | None = None) -> bool:
    """`args` = everything after `gh`; `dyn[i]` is True if args[i] is expanded by the shell ($VAR, $(..)).
    True if it merges a PR, writes code via the API, or sets a risky alias."""
    dyn = list(dyn) if dyn is not None else [("$" in a or "`" in a) for a in args]
    first_i = next((i for i, a in enumerate(args) if not a.startswith("-")), None)
    if first_i is None:
        return False
    first = args[first_i]
    aliases = _gh_aliases()
    if _depth < 3:
        # longest (multi-word) alias name matching the words at the command position
        for name in sorted(aliases, key=lambda k: -len(k.split())):
            kw = name.split()
            if args[first_i:first_i + len(kw)] != kw:
                continue
            exp = aliases[name]
            if exp.startswith("!"):
                return True  # shell alias: can't see what it runs
            try:
                new = args[:first_i] + _expand_alias(exp, args[first_i + len(kw):])
            except Exception:
                return True
            return _gh_args_write(new, command, _depth + 1)
    pos = [i for i, a in enumerate(args) if not a.startswith("-")]
    if dyn[pos[0]] or (args[pos[0]] == "pr" and len(pos) > 1 and dyn[pos[1]]):
        return True  # gh $S merge, gh pr "$(echo merge)", f(){ gh "$@"; }: subcommand built by the shell
    if first == "alias" and ("set" in args or "import" in args):
        if "import" in args or "--shell" in args or "-s" in args:
            return True
        rest = args[args.index("set") + 1:]
        if "-" in rest:
            return True  # expansion read from stdin: can't be inspected
        exps = [a for a in rest if not a.startswith("-")][1:2]
        for e in exps:
            if e.startswith("!"):
                return True
            try:
                if _gh_args_write(shlex.split(e), command, _depth + 1) or "api" in shlex.split(e):
                    return True
            except Exception:
                return True
    # `gh … pr [-R X] merge`: merge must be pr's subcommand (so `gh pr list --label merge` is fine)
    if "pr" in args:
        rest, j = args[args.index("pr") + 1:], 0
        while j < len(rest) and rest[j].startswith("-"):
            j += 2 if rest[j] in ("-R", "--repo") else 1
        if j < len(rest) and rest[j] == "merge":
            return True
    if "api" not in args:
        return False
    api_args = args[args.index("api") + 1:]
    api_dyn = dyn[args.index("api") + 1:]
    import posixpath
    flat = " ".join(posixpath.normpath(re.sub(r"/{2,}", "/", u)) if "/" in u else u
                    for u in (_unquote_all(a) for a in api_args))  # ./ ../ // in endpoint paths
    if _graphql_text_writes(" ".join(api_args)) or _graphql_text_writes(flat):
        return True  # a ref/commit/merge mutation in the (dequoted) args, whatever the endpoint looks like
    is_gql = any("graphql" in _unquote_all(a).lower() and not re.match(r"^[\w.\[\]-]+=", a) for a in api_args)
    if is_gql:
        if _graphql_text_writes(_unquote_all(command)):
            return True
        if "=@" in flat or any(a == "--input" or a.startswith("--input=") for a in api_args):
            return True  # query/body read from a file or stdin: can't be inspected reliably
        if any(api_dyn):
            return True  # query built by the shell ($(cat f), "$Q"); '$var' in single quotes is fine
    raw_flat = re.sub(r"/{2,}", "/", _unquote_all(" ".join(api_args)))
    if any(api_dyn) and (GH_WRITE_PATH.search("/" + flat) or GH_WRITE_PATH.search("/" + raw_flat)):
        return True  # e.g. {-X,PUT}: the shell builds the method/flags, so assume a write
    if not _gh_api_is_write(api_args):
        return False
    if GH_WRITE_PATH.search("/" + flat) or GH_WRITE_PATH.search("/" + raw_flat):
        return True
    return any(d and not re.match(r"^[\w.-]+=", a) for a, d in zip(api_args, api_dyn))  # unseen endpoint


def _graphql_text_writes(text: str) -> bool:
    if GH_GRAPHQL_WRITE.search(text):
        return True
    try:  # a JSON body may spell the mutation with \u escapes
        return bool(GH_GRAPHQL_WRITE.search(json.dumps(json.loads(text), ensure_ascii=False)))
    except Exception:
        return False


def _subst_body(cmd: str, i: int) -> tuple:
    """cmd[i:i+2] == '$(' -> (body, index after the closing ')'), skipping quoted parens."""
    depth, j, n = 1, i + 2, len(cmd)
    while j < n:
        c = cmd[j]
        if c == "\\":
            j += 2
            continue
        if c == "'":
            k = cmd.find("'", j + 1)
            if k < 0:
                raise ValueError("unterminated quote")
            j = k + 1
            continue
        if c == '"':
            j += 1
            while j < n and cmd[j] != '"':
                j += 2 if cmd[j] == "\\" else 1
            j += 1
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return cmd[i + 2:j], j + 1
        j += 1
    raise ValueError("unterminated $(")


def _shell_words(cmd: str) -> tuple:
    """Quote-aware split of a shell command into segments of words.
    Returns (segments, substitutions): each segment is a list of (word, dynamic) where `word` is the
    dequoted text and `dynamic` is True if it contains $ / backticks the SHELL will expand (i.e. outside
    single quotes); `substitutions` are the bodies of every $(...) and `...` outside single quotes.
    `;&|`, newlines and `()` separate segments anywhere when unquoted; `{}` only at the start of a word.
    Raises ValueError on unbalanced quotes (callers fail closed)."""
    segs, cur, subs = [], [], []
    word, dyn = None, False
    i, n = 0, len(cmd)

    def end_word():
        nonlocal word, dyn
        if word is not None:
            cur.append(("".join(word), dyn))
        word, dyn = None, False

    def end_seg():
        nonlocal cur
        end_word()
        if cur:
            segs.append(cur)
        cur = []

    def add(t):
        nonlocal word
        if word is None:
            word = []
        word.append(t)

    while i < n:
        c = cmd[i]
        if c in " \t":
            end_word()
            i += 1
        elif c in "\n;&|":
            end_seg()
            i += 1
        elif c in "()" or (c in "{}" and word is None and (i + 1 >= n or cmd[i + 1] in " \t\n;&|)")):
            end_seg()  # <(…) >(…) f(){ …; } `case x in x)`; `{`/`}` only as standalone reserved words
            i += 1
        elif c == "#" and word is None:
            k = cmd.find("\n", i)  # comment to end of line (apostrophes inside must not pair up)
            i = n if k < 0 else k
        elif c == "\\" and i + 1 < n and cmd[i + 1] == "\n":
            i += 2  # line continuation
        elif c == "\\":
            add(cmd[i + 1] if i + 1 < n else "")
            i += 2
        elif c == "'":
            k = cmd.find("'", i + 1)
            if k < 0:
                raise ValueError("unterminated '")
            add(cmd[i + 1:k])
            i = k + 1
        elif c == '"':
            j, buf = i + 1, []
            while True:
                if j >= n:
                    raise ValueError('unterminated "')
                d = cmd[j]
                if d == '"':
                    break
                if d == "\\" and j + 1 < n and cmd[j + 1] == "\n":
                    j += 2  # line continuation inside double quotes
                    continue
                if d == "\\" and j + 1 < n and cmd[j + 1] in '"\\$`':
                    buf.append(cmd[j + 1])
                    j += 2
                    continue
                if d == "$" and j + 1 < n and cmd[j + 1] == "(":
                    body, j2 = _subst_body(cmd, j)
                    subs.append(body)
                    buf.append(cmd[j:j2])
                    dyn = True
                    j = j2
                    continue
                if d == "`":
                    k = cmd.find("`", j + 1)
                    if k < 0:
                        raise ValueError("unterminated `")
                    subs.append(cmd[j + 1:k])
                    buf.append(cmd[j:k + 1])
                    dyn = True
                    j = k + 1
                    continue
                if d == "$":
                    dyn = True
                buf.append(d)
                j += 1
            add("".join(buf))
            i = j + 1
        elif c == "$" and i + 1 < n and cmd[i + 1] == "(":
            body, j2 = _subst_body(cmd, i)
            subs.append(body)
            add(cmd[i:j2])
            dyn = True
            i = j2
        elif c == "`":
            k = cmd.find("`", i + 1)
            if k < 0:
                raise ValueError("unterminated `")
            subs.append(cmd[i + 1:k])
            add(cmd[i:k + 1])
            dyn = True
            i = k + 1
        else:
            if c in "${":
                dyn = True  # parameter or brace expansion: the shell builds this word
            add(c)
            i += 1
    end_seg()
    return segs, subs


def gh_writes(command: str, cwd: str = "", _depth: int = 0, _parent_gh: bool = False) -> bool:
    """True if `command` RUNS a GitHub-side code change: `gh pr merge`, a `gh api` REST write to
    contents/refs/merges, or a graphql ref/commit/merge mutation — for ANY repo.

    Deliberately NOT scoped to QRate repos: which repo gh targets depends on -R, GH_REPO, PR URLs (gh
    percent-decodes them) and the directory it runs in, and shell semantics (subshells, conditionals,
    pipelines, functions, non-exported variables) make that impossible to resolve statically. Every scoping
    attempt opened a bypass. We never use PRs, so a genuine non-QRate merge goes through the logged
    QRATE_REVIEW_BYPASS with the user's OK. `cwd` is accepted for backward compatibility only."""
    try:
        segs, subs = _shell_words(command)
    except Exception:
        return bool(re.search(r"(?:^|[\s;&|(`$])(?:\S*/)?gh\s+(?:\S+\s+)*?(?:pr|api|alias)\b", command))
    mentions_gh = _parent_gh or bool(re.search(r"\bgh\b", command))

    def inner_writes(body: str) -> bool:
        if _depth >= 6:
            return mentions_gh  # too deep to follow: fail closed
        return gh_writes(body, cwd, _depth + 1, mentions_gh)

    for body in subs:  # OUT="$(gh pr merge 3)", `gh api …`: the shell runs these too
        if re.search(r"\bcase\b", body):
            # `case` patterns' `)` end our $(…) scan early: fail closed
            if mentions_gh:
                return True
            continue
        if inner_writes(body):
            return True
    for seg in segs:
        via_xargs = False
        w = [t for t, _ in seg]
        dyn_of = {}
        for t, d in seg:
            dyn_of[t] = dyn_of.get(t, False) or d
        # strip keywords, assignments and wrappers (by basename, so /usr/bin/env counts)
        while w:
            b = os.path.basename(w[0])
            if w[0] in _KEYWORDS or _ASSIGN.match(w[0]) or w[0] in ("export", "local", "declare", "typeset"):
                w.pop(0)
            elif b == "env":
                w.pop(0)
                while w and (w[0].startswith("-") or _ASSIGN.match(w[0])):
                    a = w.pop(0)
                    if a in ("-u", "--unset", "-C", "--chdir") and w:
                        w.pop(0)
                    elif a in ("-S", "--split-string") or (a.startswith("-S") and len(a) > 2) \
                            or a.startswith("--split-string="):
                        val = (w.pop(0) if w else "") if a in ("-S", "--split-string") else \
                            (a.split("=", 1)[1] if a.startswith("--split-string=") else a[2:])
                        try:
                            w = shlex.split(val) + w
                        except Exception:
                            return True
                        break
            elif b == "timeout":
                w.pop(0)
                while w and (w[0].startswith("-") or re.match(r"^\d+(\.\d+)?[smhd]?$", w[0])):
                    w = w[2:] if w[0] in ("-s", "--signal", "-k", "--kill-after") else w[1:]
            elif b == "script":
                w.pop(0)
                while w and w[0].startswith("-"):
                    w = w[2:] if w[0] in ("-t", "-T", "-E", "-I", "-O", "-B") else w[1:]
                if w:
                    w.pop(0)  # the typescript file; the rest is the command
            elif b in _WRAPPERS or b == "stdbuf":
                if b == "xargs":
                    via_xargs = True
                w.pop(0)
                vflags = _WRAPPER_VALUE_FLAGS.get(b, ())
                while w and w[0].startswith("-"):  # wrapper options, e.g. `sudo -u root`, `xargs -0`
                    w = w[2:] if w[0] in vflags else w[1:]
            else:
                break
        if not w:
            continue
        if mentions_gh and any(dyn_of.get(w[i], True) for i in [0] + [k + 1 for k, t in enumerate(w[:-1])
                                                                      if t in _EXEC_FLAGS]):
            return True  # command word built by the shell ($(echo)gh, ${X}gh, $G, $'gh'): can't see it
        b0 = os.path.basename(w[0])
        cflag = next((k for k, a in enumerate(w[1:-1], 1) if re.match(r"^-[A-Za-z]*c[A-Za-z]*$", a)), None) \
            if b0 in _SHELLS else None
        if cflag is not None or b0 == "eval":
            k = cflag + 1 if cflag is not None else None
            if k is not None and k < len(w) - 1 and w[k] == "--":
                k += 1
            inner = w[k] if k is not None else " ".join(w[1:])
            if inner_writes(inner):
                return True
            continue
        if mentions_gh and b0 in _SHELLS and (any(a in ("<", "<<", "<<<") for a in w[1:]) or
                                              all(a.startswith("-") for a in w[1:])):
            return True  # `… | bash`, `bash <<< '…'`, `bash < f`: the script comes from stdin
        if mentions_gh and re.search(r"\balias\s+[^\s=]+=\S*\bgh\b", command):
            return True  # shell alias for gh
        if mentions_gh and b0 in ("source", ".") and (len(w) < 2 or w[1] in ("<", "/dev/stdin") or
                                                       dyn_of.get(w[1], True)):
            return True  # `source <(…)`: can't see what it runs
        if mentions_gh and via_xargs and re.search(r"\b(merge|api)\b", command) and \
                any(os.path.basename(t) == "gh" for t in w):
            return True  # xargs feeds gh its arguments from stdin
        # gh as the command, or run by find -exec/-execdir
        starts = [0] + [i + 1 for i, t in enumerate(w[:-1]) if t in _EXEC_FLAGS]
        for st in starts:
            sub_w = w[st:]
            if st and os.path.basename(sub_w[0]) in _SHELLS and "-c" in sub_w[1:-1]:
                if inner_writes(sub_w[sub_w.index("-c") + 1]):
                    return True
                continue
            if os.path.basename(sub_w[0]) != "gh" or len(sub_w) < 2:
                continue
            if _gh_args_write(sub_w[1:], command, dyn=[dyn_of.get(t, True) for t in sub_w[1:]]):
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
                _deny("QRate review gate: changing code through the GitHub API (`gh pr merge`, `gh api` writes "
                      "to contents/refs/merges, graphql ref/commit/merge mutations) skips the local pre-push "
                      "review, so it is denied for every repo. Commit locally, get a qrate-reviewer PASS, and "
                      "push. See .claude/rules/qrate-code-review-gate.md.")

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
