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
check deny  "cd /tmp && gh pr merge 3 -R someone/else"   # GitHub-side writes denied for every repo
check deny  "cd /tmp && gh pr merge https://github.com/QRateCore/zz/pull/3"
check deny  "cd /tmp && gh pr merge 3 -R https://github.com/QRateCore/zz"
check deny  "cd /tmp && gh pr merge 3 --repo=github.com/QRateCore/zz"
check deny  "cd /tmp && GH_REPO=QRateCore/zz gh pr merge 3"
check deny  "export GH_REPO=QRateCore/zz; cd /tmp && gh pr merge 3"
check deny  "cd /tmp && env GH_REPO=QRateCore/zz gh pr merge 3"
check deny  "env -u GH_REPO gh pr merge 3"
check deny  "cd /tmp && cd $W && gh pr merge 3"
check deny  "cd /tmp && gh pr merge \$PR_URL"
check deny  "gh pr merge 3 -R someone/else"   # GitHub-side writes denied for every repo
check deny  "cd /tmp && gh pr merge https://github.com/someone/else/pull/3"   # GitHub-side writes denied for every repo
check deny  "cd /tmp && gh pr merge feature/x"               # no repo named on the gh command: hook cwd counts
check deny  "cd /tmp && GH_REPO=QRateCore/zz gh api -X PUT repos/{owner}/{repo}/contents/a -f message=m"
printf 'mutation { mergePullRequest(input:{}) { clientMutationId } }' > "$T/q_mut.graphql"
printf 'query { viewer { login } }' > "$T/q_read.graphql"
check deny  "gh api graphql -F query=@$T/q_mut.graphql"
check deny  "gh api graphql --input $T/q_mut.graphql"
check deny  "gh api graphql --input -"
check deny  "gh api graphql -F query=@$T/missing.graphql"
check deny  "gh api graphql -F query=@$T/q_read.graphql"   # GitHub-side writes denied for every repo
# round-2 review: everything gh would still run against the QRate cwd must stay denied
check deny  "cd /nonexistent; gh pr merge 3"
check deny  "GH_REPO= gh pr merge 3"
check deny  "export GH_REPO=; gh pr merge 3"
check deny  "gh pr merge fix.ui/button"
check deny  "(cd /tmp); gh pr merge 3"
check deny  "cd /tmp && cd - && gh pr merge 3"
check deny  "pushd /tmp; popd; gh pr merge 3"
check deny  "(export GH_REPO=someone/else); gh pr merge 3"
check deny  "printf x | gh api graphql --input /dev/stdin"
check deny  "gh api graphql -F query=@/dev/fd/0"
check deny  "cd /tmp && gh pr -R QRateCore/zz merge 3"
check deny  "cd /tmp && timeout 5 gh pr merge 3 -R QRateCore/zz"
check deny  "cd /tmp && gh pr merge 3 -R git@github.com:QRateCore/zz.git"
check deny  "cd /tmp && gh pr -R someone/else merge 3"   # GitHub-side writes denied for every repo
check allow "gh pr -R QRateCore/zz view 3"
# round-3 review: shell semantics the gate can't track => union of every place gh might run
check deny  "GH_REPO=someone/else; gh pr merge 3"
check deny  "GH_REPO=someone/else && gh pr merge 3"
check deny  "true;(cd /tmp);gh pr merge 3"
check deny  "true&&(cd /tmp)&&gh pr merge 3"
check deny  "cd /tmp | cat; gh pr merge 3"
check deny  "cd /tmp & gh pr merge 3"
check deny  "false && cd /tmp; gh pr merge 3"
check deny  "if false; then cd /tmp; fi; gh pr merge 3"
check deny  "f(){ cd /tmp; }; gh pr merge 3"
check deny  "pushd /tmp; pushd; gh pr merge 3"
check deny  "cd / /; gh pr merge 3"
check deny  "true;(export GH_REPO=someone/else);gh pr merge 3"
check deny  "cd /tmp && gh -R QRateCore/zz pr merge 3"
check deny  "cd /tmp && gh --repo QRateCore/zz pr merge 3"
check deny  "cd /tmp && timeout -s KILL 5 gh pr merge 3 -R QRateCore/zz"
check deny  "cd /tmp && env -S 'gh pr merge 3 -R QRateCore/zz'"
check deny  "printf 'mutation{mergePullRequest(input:{}){clientMutationId}}' > $T/q_read.graphql; gh api graphql -F query=@$T/q_read.graphql"
printf '{"query":"\u006dutation{\u006dergePullRequest(input:{}){clientMutationId}}"}' > "$T/esc.json"
check deny  "gh api graphql --input $T/esc.json"
check deny  "GH_REPO=someone/else gh pr merge 3"   # GitHub-side writes denied for every repo
check deny  "env GH_REPO=someone/else gh pr merge 3"   # GitHub-side writes denied for every repo
check deny  "cd /tmp && gh -R someone/else pr merge 3"   # GitHub-side writes denied for every repo
# round-4 review: repo spelled via variables / percent-encoding / other endpoints and launchers
check deny  "(X=someone/else); GH_REPO=\$X gh pr merge 3"
check deny  "false && X=someone/else; GH_REPO=\$X gh pr merge 3"
check deny  "(U=https://github.com/someone/else/pull/3); gh pr merge \$U"
check deny  "gh pr merge https://github.com/%51RateCore/zz/pull/3"
check deny  "gh api -X PUT repos/%51RateCore/zz/contents/a -f message=m"
check deny  "gh api -X PUT repos/someone/else/contents/a -f message=m"
check deny  "gh api /graphql -f query='mutation{mergePullRequest(input:{}){clientMutationId}}'"
check deny  "gh api https://api.github.com/graphql -f query='mutation{updateRef(input:{}){clientMutationId}}'"
check deny  "cd /tmp && gh api graphql -F query=@q.graphql"
check deny  "/usr/bin/env gh pr merge 3"
check deny  "find . -maxdepth 0 -exec gh pr merge 3 \\;"
check deny  "xargs -n1 gh pr merge <<< 3"
check deny  "gh api -X PUT \$EP -f message=m"
check allow "gh api repos/someone/else/issues -f title=x"
check allow "gh api -X GET repos/someone/else/contents/a"
check allow "echo use gh pr view instead"
# round-5 review: clustered short flags, encoded paths, aliases
check deny  "gh api -iX PATCH repos/QRateCore/qrate-core/git/refs/heads/main -f sha=abc"
check deny  "gh api -iX PUT repos/QRateCore/qrate-core/contents/a -f message=m -f content=eA=="
check deny  "gh api -if sha=abc repos/QRateCore/zz/git/refs/heads/main -X PATCH"
check deny  "gh api -iX PUT repos/QRateCore/zz/pulls/3/merge"
check deny  "gh api -iH 'X: y' repos/a/b/git/refs -f ref=refs/heads/x -f sha=1"
check deny  "gh api -if query='mutation{mergePullRequest(input:{}){clientMutationId}}' graphql"
check deny  "gh api -XPATCH repos/QRateCore/zz/git/refs/heads/main -f sha=a"
check deny  "gh api --method=PUT repos/QRateCore/zz/contents/a -f message=m"
check deny  "gh api -X PUT repos/QRateCore/zz/%63ontents/a -f message=m"
check deny  "gh api repos/QRateCore/zz/git%2Frefs/heads/main -X PATCH -f sha=a"
check deny  "gh alias set mm 'pr merge'"
check deny  "gh alias set --shell mm 'gh pr merge \$1'"
check deny  "gh alias import aliases.yml"
check allow "gh alias set co 'pr checkout'"
check allow "gh api -i repos/QRateCore/zz/git/refs/heads/main"
check allow "gh api -X POST repos/someone/else/issues -f body=x"
mkdir -p "$T/ghcfg" && printf 'aliases:\n    mm: pr merge\n    co: pr checkout\n' > "$T/ghcfg/config.yml"
export GH_CONFIG_DIR="$T/ghcfg"
printf 'aliases:\n    mm: pr merge\n    co: pr checkout\n    m: pr\n    mx: pr -R QRateCore/qrate-core merge\n    sh: "!gh pr merge"\n' > "$T/ghcfg/config.yml"
check deny  "gh mm 3"
check allow "gh co 3"
check deny  "gh m merge 3"
check deny  "gh mx 3"
check deny  "gh sh 3"
check allow "gh m list"
unset GH_CONFIG_DIR
# round-6 review: read verbs in non-method positions, shell-built queries, endpoint spellings, false positives
check deny  "gh api repos/QRateCore/qrate-core/merges -f base=main -f head=feat --template GET"
check deny  "gh api repos/QRateCore/zz/git/refs -f ref=refs/heads/x -f sha=1 -q GET"
check deny  "gh api repos/QRateCore/zz/git/refs -f ref=refs/heads/x -f sha=1 --jq HEAD"
check allow "gh api --method GET repos/QRateCore/zz/contents/a -f ref=main"
check allow "gh api -XGET repos/QRateCore/zz/contents/a -f ref=main"
check deny  "gh api graphql -f query=\"\$(cat /tmp/q.txt)\""
check deny  "gh api graphql -f query=\"\$Q\""
check deny  "gh api 'graphql?x=1' -f query='mutation{mergePullRequest(input:{}){clientMutationId}}'"
check deny  "gh api graphql -f query='mutation{merge''PullRequest(input:{}){clientMutationId}}'"
check deny  "gh api -X PUT repositories/123/contents/a -f message=m"
check deny  "gh api -X PUT repos/QRateCore/x//contents/a -f message=m"
check allow "gh pr list --label merge"
check allow "echo \"use gh to view the PR; don't merge"
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
check allow "git push --force-if-includes origin main"
check deny  "git push --force-with-lease --force-if-includes origin main"
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
