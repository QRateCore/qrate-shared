#!/bin/bash
# Regression test for the QRate review gate.
# Usage: bash .claude/review/test_gate.sh [path/to/qrate_review.py]   (defaults to the copy next to this file)
# Run it after ANY change to qrate_review.py, before sync_gate.py propagates it.
set -u
SRC="${1:-$(dirname "$0")/qrate_review.py}"
Q="$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")"   # absolute: we cd away below
[ -f "$Q" ] || { echo "no such file: $Q"; exit 2; }
T=$(mktemp -d); cd "$T"
git init -q --bare bare.git && git init -q -b main w && cd w
git config user.email t@t; git config user.name t
git remote add origin https://github.com/QRateCore/zz-gate-test.git && git config remote.origin.pushurl "$T/bare.git"
echo a > a.txt && git add . && git commit -qm init && git push -q origin main 2>/dev/null
git update-ref refs/remotes/origin/main HEAD && git branch -q -u origin/main
echo b >> a.txt && git commit -qam change
SHA=$(git rev-parse HEAD); git tag v1 HEAD~1
pass=0; fail=0
check() { # check <allow|deny> <command>
  local exp="$1" cmd="$2" out rc got
  out=$(jq -n --arg c "$cmd" --arg d "$PWD" '{tool_name:"Bash",tool_input:{command:$c},cwd:$d}' | python3 "$Q" gate 2>&1); rc=$?
  if [ $rc -ne 0 ]; then got="CRASH(rc=$rc)"
  elif [ -z "$out" ]; then got=allow
  else got=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null || echo "BADJSON"); fi
  if [ "$got" = "$exp" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: [$cmd] expected $exp got $got"; fi
}
W="$PWD"
check deny  "git push origin main"
check deny  "git push"
check deny  "git push origin $SHA:main"
check deny  "git push origin +$SHA:refs/heads/main"
check deny  "git fetch origin && git rebase origin/main && git push origin main"
check deny  "git push --all origin"
check deny  "bash -c 'git push origin main'"
check deny  "/usr/bin/git push origin main"
check deny  "R=$W; cd \$R && git push origin main"
check deny  "R=$W; git -C \$R push origin main"
check deny  "export R=$W && git -C \"\${R}\" push origin main"
check deny  "cd \$(git rev-parse --show-toplevel) && git push origin main"
check deny  "for r in $W; do git -C \$r push origin main; done"
check deny  "if true; then git push origin main; fi"
check deny  "R=\$(pwd); cd \$R/. && git push origin main"
check deny  "R=\$(dirname \$PWD); git -C \$R/w push origin main"
check deny  "cd nope; git push origin main"
check deny  "cd /tmp && GIT_DIR=$W/.git git push origin main"
check deny  "cd /tmp && git --git-dir=$W/.git push origin main"
check deny  "export GIT_DIR=$W/.git; cd /tmp && git push origin main"
check allow "git push origin v1"
check allow "git push origin :old-branch"
check allow "git push origin --delete old-branch"
check allow "git push origin HEAD~1:main"
check allow "echo 'git push origin main'"
check allow "git commit -m 'then git push'"
check allow "git status"
check allow "cd /tmp && git push origin main"
# write a PASS marker the way the record hook would, then expect allow
KEY=$(python3 "$Q" key . | jq -r .key)
MD="$(git rev-parse --git-common-dir)/qrate""-review"; mkdir -p "$MD"; echo '{"verdict":"PASS"}' > "$MD/$KEY.json"
check allow "git push origin main"
check allow "git push origin $SHA:main"
check allow "R=$W; git -C \$R push origin main"
# marker-dir guard
check deny  "touch .git/qrate""-review/x.json"
check allow "ls .git/qrate""-review/"
echo "passed=$pass failed=$fail"; rm -rf "$T"; [ $fail -eq 0 ]
