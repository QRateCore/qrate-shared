#!/usr/bin/env python3
"""Propagate the QRate review gate from one repo to others, so every repo stays identical.

  python3 .claude/review/sync_gate.py --from <source repo or workspace> --to <repo-or-dir> [--to ...] [--dry-run]

--to may be a single repo or a directory containing many repo checkouts (only those whose origin is a
QRate GitHub org are touched). For each target it:
  * copies the gate files (FILES below) unless the target's GATE_VERSION is newer than the source's
  * merges the two hooks into .claude/settings.json, keeping every other key
  * un-ignores the gate paths if the repo's .gitignore hides .claude/
It never commits. Review and commit in each repo yourself; each commit passes through the gate.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

FILES = [
    ".claude/review/qrate_review.py",
    ".claude/review/sync_gate.py",
    ".claude/review/checklist.md",
    ".claude/review/test_gate.sh",
    ".claude/agents/qrate-reviewer.md",
    ".claude/rules/qrate-code-review-gate.md",
]
GATE_CMD = 'python3 "$CLAUDE_PROJECT_DIR/.claude/review/qrate_review.py"'
HOOKS = {
    "PreToolUse": {"matcher": "Bash|Edit|Write|MultiEdit|NotebookEdit",
                   "hooks": [{"type": "command", "command": f"{GATE_CMD} gate", "timeout": 60}]},
    "SubagentStop": {"matcher": "qrate-reviewer",
                     "hooks": [{"type": "command", "command": f"{GATE_CMD} record", "timeout": 60}]},
}
QRATE_REMOTE = re.compile(r"github\.com[:/](QRateCore|qrate-builder)/", re.I)
VERSION_RE = re.compile(r'GATE_VERSION\s*=\s*"([^"]+)"')


def version(repo: Path) -> str:
    p = repo / ".claude/review/qrate_review.py"
    m = VERSION_RE.search(p.read_text()) if p.exists() else None
    return m.group(1) if m else ""


def _vkey(v: str) -> tuple:
    """Numeric compare: 2026-11-08.10 > 2026-11-08.2 (a string compare gets this wrong)."""
    return tuple(int(x) for x in re.split(r"[-.]", v) if x.isdigit())


def is_qrate_repo(p: Path) -> bool:
    if not (p / ".git").exists():
        return False
    r = subprocess.run(["git", "-C", str(p), "remote", "get-url", "origin"], capture_output=True, text=True)
    return bool(QRATE_REMOTE.search(r.stdout))


def merge_settings(repo: Path, dry: bool) -> str:
    path = repo / ".claude/settings.json"
    data = json.loads(path.read_text()) if path.exists() else {}
    hooks = data.setdefault("hooks", {})
    changed = False
    for event, entry in HOOKS.items():
        lst = hooks.setdefault(event, [])
        # drop any older gate entry, then add the current one
        kept = [e for e in lst if "qrate_review.py" not in json.dumps(e)]
        new = kept + [entry]
        if new != lst:
            hooks[event] = new
            changed = True
    if changed and not dry:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2) + "\n")
    return "settings.json updated" if changed else "settings.json ok"


def unignore(repo: Path, dry: bool) -> str:
    ignored = [f for f in FILES + [".claude/settings.json"]
               if subprocess.run(["git", "-C", str(repo), "check-ignore", "-q", f]).returncode == 0]
    if not ignored:
        return ""
    gi = repo / ".gitignore"
    block = "\n# QRate review gate — must be versioned (see .claude/rules/qrate-code-review-gate.md)\n" + \
        "!.claude/\n.claude/*\n" + "".join(f"!{d}/\n" for d in (".claude/review", ".claude/agents", ".claude/rules")) + \
        "!.claude/settings.json\n.claude/review/__pycache__/\n"
    if not dry:
        with gi.open("a") as fh:
            fh.write(block)
    still = [f for f in ignored if subprocess.run(["git", "-C", str(repo), "check-ignore", "-q", f]).returncode == 0]
    return f".gitignore patched ({len(ignored)} paths were ignored" + (f"; STILL ignored: {still}" if still and not dry else "") + ")"


def sync_one(src: Path, dst: Path, dry: bool) -> str:
    sv, dv = version(src), version(dst)
    if dv and _vkey(dv) > _vkey(sv):
        return f"SKIP — target GATE_VERSION {dv} is newer than source {sv}"
    copied = 0
    for f in FILES:
        s, d = src / f, dst / f
        if not s.exists():
            continue
        if d.exists() and d.read_bytes() == s.read_bytes():
            continue
        copied += 1
        if not dry:
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(s, d)
    notes = [f"{copied} file(s) copied", merge_settings(dst, dry)]
    u = unignore(dst, dry)
    if u:
        notes.append(u)
    return ", ".join(notes)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", required=True)
    ap.add_argument("--to", action="append", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    src = Path(a.src).resolve()
    if not (src / ".claude/review/qrate_review.py").exists():
        sys.exit(f"{src} has no .claude/review/qrate_review.py")
    targets: list[Path] = []
    for t in a.to:
        p = Path(t).resolve()
        targets += [p] if (p / ".git").exists() else sorted(c for c in p.iterdir() if c.is_dir())
    for t in targets:
        if t == src or not is_qrate_repo(t):
            continue
        print(f"{t.name:34} {sync_one(src, t, a.dry_run)}")


if __name__ == "__main__":
    main()
