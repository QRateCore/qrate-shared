# QRate Code Review Gate — Every Push Is Independently Reviewed

**Policy (set by Avi on 2026-11-08), for every QRate repo:** every change pushed to a repo whose `origin` is
`github.com/QRateCore/*` or `qrate-builder/*` must first pass the **`qrate-reviewer`** subagent. A push
to `main` starts that repo's CodePipeline, so this review is the gate in front of the deploy. We work
straight on `main` with no PRs, so this review stands in for PR review.

It is **enforced by hooks that ship inside every repo**. Agents don't have to remember it:
- `.claude/settings.json` has a `PreToolUse` hook that blocks any `git push` whose diff has no PASS
  verdict.
- A `SubagentStop` hook records the reviewer's verdict as a marker under `.git/` (in the
  `qrate-review` dir). Only that hook is meant to write markers. Tool calls that name the directory
  literally are denied. That guard stops accidents, not a determined agent, which is why the rule
  below forbids touching it.
- Pushes the gate can't resolve statically fail closed: a directory taken from a loop variable,
  `$(...)` or backticks, or `--all`/`--mirror`. Push each repo with a literal path.
- Gate: `.claude/review/qrate_review.py`. Reviewer: `.claude/agents/qrate-reviewer.md`. Living
  checklist: `.claude/review/checklist.md`. Logs are per user, in
  `${CLAUDE_CONFIG_DIR:-~/.claude}/qrate-review-logs/`.
- The hooks need `python3` on `PATH` and `git`.

## The loop (builder agent)

1. Finish the change and run your own tests. **Commit everything.** Uncommitted work is not reviewed.
2. Launch the reviewer: Agent tool, `subagent_type: "qrate-reviewer"`. Brief it with:
   - the repo path(s). Batch a multi-repo change into ONE review so cross-repo contracts are checked.
   - the intent, in 1–3 sentences.
   - what you tested, with the exact commands. It will verify these, not take them on faith.
   - anything deliberately out of scope.
   Do **not** hand it your reasoning or conclusions. Its value is reading the code cold.
3. **PASS:** the push unlocks. Run the normal protocol: `git fetch origin && git rebase origin/main &&
   git push origin main`. Rebasing does not invalidate the PASS, because the key is the patch-id of
   the zero-context diff. If a rebase conflict changed the diff, review again.
4. **BLOCK:** fix each P0/P1, or rebut it with evidence (a command and its output) in the next brief.
   Then commit and re-review. Never argue a finding away without evidence.
5. **Report to the user** in your final message, every time: the verdict, any P2/P3 you deferred, the
   reviewer's "Challenge to the builder" questions with your answers, and any PROMOTE suggestions.

## Rules

- **Never bypass to save time.** `QRATE_REVIEW_BYPASS="<reason>" git push …` exists only for genuine
  incidents, and only with the user's explicit OK in this conversation. Every bypass is logged and
  must be mentioned to the user.
- **Never touch the marker directory**, the gate script, or the hook entries in settings to get a push
  through. If the gate itself is wrong, stop and tell the user.
- **Don't game the review** by splitting a risky change into small pushes or by writing a narrow brief.
  The reviewer reads the whole diff since upstream anyway.
- **Build good practices from the findings.** When the reviewer marks a finding `recurring` and proposes
  a PROMOTE, ask the user. With their OK, add it as a numbered check in `.claude/review/checklist.md`
  and propagate it (below).

## Changing the gate itself (keep every repo identical)

The gate files are **identical in every QRate repo**. To change any of them:
1. Edit the files in one repo, and bump `GATE_VERSION` in `qrate_review.py`.
2. Run `python3 .claude/review/sync_gate.py --from . --to <dir containing all the repo checkouts>`.
   It copies the gate files into every sibling QRate repo and merges the hooks into each
   `.claude/settings.json`. It refuses to overwrite a newer `GATE_VERSION`.
3. Commit in each repo. Each of those commits goes through the gate like any other change.

Pushes made by hand in a terminal outside Claude Code are not gated.
