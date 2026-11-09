#!/bin/bash
# Regression test for the QRate review gate.
# Usage: bash .claude/review/test_gate.sh [path/to/qrate_review.py]   (defaults to the copy next to this file)
# Run it after ANY change to qrate_review.py, before sync_gate.py propagates it.
set -u
SRC="${1:-$(dirname "$0")/qrate_review.py}"
Q="$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")"   # absolute: we cd away below
[ -f "$Q" ] || { echo "no such file: $Q"; exit 2; }
T=$(mktemp -d); cd "$T"
export CLAUDE_CONFIG_DIR="$T/cfg"; mkdir -p "$CLAUDE_CONFIG_DIR"   # never write the real per-user logs
unset QRATE_REVIEW_BYPASS
git init -q --bare bare.git && git init -q -b main w && cd w
git config user.email t@t; git config user.name t
git remote add origin https://github.com/QRateCore/zz-gate-test.git && git config remote.origin.pushurl "$T/bare.git"
echo a > a.txt && seq 1 20 > L.txt && printf 'def f():\n    if ok():\n        run()\n\ndef g():\n    run()\n' > c.py && git add . && git commit -qm init && git push -q origin main 2>/dev/null
git update-ref refs/remotes/origin/main HEAD && git branch -q -u origin/main
echo b >> a.txt && sed -i '' 's/^18$/eighteen/' L.txt && printf 'def f():\n    if ok():\n        run()\n        check_auth()\n\ndef g():\n    run()\n' > c.py && git commit -qam change
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
check deny  "git --git-dir=$W/.git -C /tmp push origin main"
check deny  "git -C .git push origin main"
check deny  "gh pr merge 12 --squash"
check deny  "gh api -X PUT repos/QRateCore/zz/contents/a.txt -f message=m"
check deny  "gh api repos/QRateCore/zz/git/refs -f ref=refs/heads/x -f sha=abc"
check allow "gh api repos/QRateCore/zz/contents/a.txt"
check allow "gh pr view 12"
check allow "git commit -m 'deny gh pr merge / gh api writes'"
check deny  "bash -c 'gh pr merge 3'"
check deny  "git --git-dir $W/.git push origin main"
check deny  "cd /tmp && git --git-dir $W/.git push origin main"
check deny  "git --work-tree $W push origin main"
check deny  "gh api -X PUT repos/{owner}/{repo}/contents/a -f message=m"
check deny  "gh api -X PUT repos/:owner/:repo/contents/a -f message=m"
check deny  "O=QRateCore; gh api -X PUT repos/\$O/zz/contents/a -f message=m"
check deny  "gh api graphql -f query='mutation{createCommitOnBranch(input:{}){commit{oid}}}'"
check deny  "gh pr merge 3 -R QRateCore/zz"
check allow "gh api -X GET repos/QRateCore/zz/git/trees/main -f recursive=1"
check allow "gh api graphql -f query='query{viewer{login}}'"
check allow "cd /tmp && gh pr merge 3 -R someone/else"
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
check allow "git -C .git push origin main"
check deny  "git push --force origin main"
check deny  "git push -uf origin main"
check deny  "git push --force-with-lease origin main"
check deny  "git push origin +main"
check allow "QRATE_REVIEW_BYPASS='incident' git push -f origin main"
# a PASS must not survive a re-indent or a move (in Python both change behaviour)
git reset -q --soft HEAD~1 && printf 'def f():\n    if ok():\n        run()\n    check_auth()\n\ndef g():\n    run()\n' > c.py && git commit -qam "change (dedented)"
check deny  "git push origin main"
git reset -q --hard "$SHA"
git reset -q --soft HEAD~1 && printf 'def f():\n    if ok():\n        run()\n\ndef g():\n    run()\n    check_auth()\n' > c.py && git commit -qam "change (moved)"
check deny  "git push origin main"
git reset -q --hard "$SHA"
check allow "git push origin main"
# the PASS survives a rebase onto an unrelated upstream change in the same file
git checkout -q -b up origin/main && { printf 'top1\ntop2\n'; cat L.txt; } > L.tmp && mv L.tmp L.txt && git commit -qam up && git push -q --no-verify origin up:main && git fetch -q origin 2>/dev/null
git update-ref refs/remotes/origin/main up && git checkout -q main && git rebase -q origin/main || echo "FAIL: rebase conflicted"
[ "$(git rev-list --count origin/main..HEAD)" = 1 ] && grep -q '^top1$' L.txt || { fail=$((fail+1)); echo "FAIL: rebase setup"; }
check allow "git push origin main"
# marker-dir guard
check deny  "touch .git/qrate""-review/x.json"
check allow "ls .git/qrate""-review/"
# first push of a brand-new repo: gated, and a reviewer verdict can be recorded for it
cd "$T" && git init -q --bare nb.git && git init -q -b main n && cd n
git config user.email t@t; git config user.name t
git remote add origin https://github.com/QRateCore/zz-new.git && git config remote.origin.pushurl "$T/nb.git"
echo x > x.txt && git add . && git commit -qm first
check deny  "git push origin main"
NK=$(python3 "$Q" key . | jq -r .key)
jq -n --arg m "done
QRATE-REVIEW repo=$PWD key=$NK verdict=PASS" '{agent_type:"qrate-reviewer",last_assistant_message:$m}' | python3 "$Q" record >/dev/null
check allow "git push origin main"
echo "passed=$pass failed=$fail"; rm -rf "$T"; [ $fail -eq 0 ]
