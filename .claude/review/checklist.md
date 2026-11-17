# QRate Review Checklist — the living practices file

> Read by the `qrate-reviewer` subagent on EVERY review. This is where good practices
> accumulate: when a finding recurs (same `trap` slug twice in `findings.jsonl`), it is
> promoted into a numbered check here (or into `.claude/rules/` if it governs authoring,
> not just review). Keep each check one line of "what to look for" + one line of "why".
> Delete checks that stop being true — a stale check is noise that trains reviewers to skim.

## How to use

Run only the sections whose trigger matches the diff. For each triggered check, the review
output must say PASS / FAIL / N/A — never silently skip a triggered check.

---

## A. Every change (always triggered)

- **A1 Secrets / infra identifiers.** No hardcoded Lambda URLs, `execute-api` / `cloudfront.net`
  hosts, Cognito pool/client IDs, `AKIA*`, `sk-ant-*`, literal `password=`/`token=`, real
  resource UUIDs as defaults. *Why: git history is permanent (`.claude/rules/secret-scan.md`).*
- **A2 Tests exist and were run.** New behaviour has a test; the builder's "tests pass" claim is
  verified. No `test.skip`, `it.skip`, `xit`, `@pytest.mark.skip`. Targeted runs are for finding bugs;
  the PASS itself needs the whole suite green (A6). *Why: CI red burns a deploy cycle; skips are banned.*
- **A3 Piped exit codes.** No `cmd | tail -N && git push` / `pytest | tail` gating anything.
  *Why: `tail`'s exit code masks the test failure (memory `pipe_tail_masks_test_failure`).*
- **A4 Does the diff match the stated intent?** Unrelated hunks, stray debug code, files from a
  parallel session swept into the commit (shared git index). *Why: concurrent agents share one index.*
- **A5 Error paths.** Swallowed exceptions, `catch {}` / bare `except:`, best-effort helpers whose
  failure is only `console.warn`-ed on a path that matters.
- **A6 The WHOLE suite is green — not just the touched files** (2026-11-12, Avi: "the reviewer should be
  checking that all tests are always green"). Before PASS, all four hold (reviewer procedure step 6):
  (a) the repo's FULL unit/CI suite + typecheck — the same commands its pipeline CI stage runs (owner
  `npx turbo run typecheck test --filter=@qrate/owner` [+ owner-mobile] or `npx vitest run` from the
  workspace root; core `./scripts/test-backend.sh` / `cd backend && pytest`) — was run by the reviewer,
  or by the builder with the exact command + full summary output at the reviewed HEAD; never through
  `| tail`. (b) **Any red test is P1 BLOCK, whether or not this diff caused it** — the only exception is
  a diff whose purpose is fixing those reds and that leaves the suite strictly greener (before/after
  counts), and a timing-budget red that passes when rerun alone (A6t). (c) The latest E2E-Dev run that ACTUALLY ran (`list-action-executions --pipeline-name
  qrate-cicd-<repo>-dev`; logs `/aws/codebuild/qrate-cicd-<repo>-deploy`, stream `e2e-dev/<build-id>`,
  `--profile qrate-breakglass`) is green — owner/admin/waiter E2E is nightly-only (`RUN_E2E`), so a green
  push run is SKIPPED, not passed. Red E2E is P1 BLOCK unless this diff fixes those reds, or the builder
  shows an in-flight fix for them AND this diff touches none of the failing specs' surfaces. A commit that
  fixes reds is never blocked by those same reds (deadlock escape). (d) Every E2E spec the diff adds or
  edits has RUN green — evidenced per the saved-transcript rule below; `--list` is not evidence, and a
  `describe.serial` whose earlier test failed reports the new ones as "did not run". **Post-deploy-only
  specs** (2026-11-13, Avi; `new-e2e-spec-never-run`, recurring): an added or edited spec that can only
  run once the change is on dev is still NOT RUN and still blocks — there is no sign-off exception (Avi
  chose strict). Run it first against a local build or with its reads route-mocked. Any dev run cited as
  evidence is reported FILE BY FILE, and a test that ended through a `pending-backend` /
  annotate-and-return escape counts as NOT RUN, not as passed. **Saved pass transcript** (2026-11-16,
  Avi; trap `new-e2e-spec-never-run`): for every new or edited E2E spec the brief cites a saved
  transcript of a run of THAT spec at the reviewed HEAD — the file path plus its `N passed` line — or
  the reviewer makes its own run at the reviewed HEAD. `--list` output, or an HTML report from a
  different run, does not count. (A6t's timing-budget allowance is for the UNIT full suite only; it never
  turns a new or edited E2E spec that did not pass into evidence.) The verdict states
  `Suite: full suite: N passed / M failed (<command>)` with M = 0, or M = only A6t reds, each listed and `E2E: last E2E-Dev: <run id> <result>`.
  *Why: 2026-11-12 a review passed an owner change on targeted vitest files while owner E2E-Dev had 40
  reds (34 pre-existing), and a pre-existing red in the same `describe.serial` spec aborted the new
  tests so they never ran.*
- **A6t Timing-budget reds under load** (2026-11-16, Avi; trap `full-suite-red-perf-budget-under-load`,
  recurring). A timing-budget test (a perf budget such as "renders in <200 ms", or a 5 s test timeout)
  that fails ONLY in a saturated full run is rerun ON ITS OWN at the same HEAD, on a machine that is not
  saturated (`uptime` load average below the core count; if it is higher, wait and rerun — a solo run
  under heavy load proves nothing either way).
  - **Still red alone** → a real red: P1 BLOCK under A6(b).
  - **Passes alone** → does NOT block by itself. Log it as **P3** under trap
    `full-suite-red-perf-budget-under-load` with the test FILE in the summary, and list it in the verdict
    with the full-run failure, the load average at the time and the solo-run output. The builder files
    it, or fixes it in the same change, to use a load-tolerant budget.
  - **Same test file logged this way in a second review** → **P2** until its budget is fixed (match on
    the trap slug + test file; older entries under `flaky-unit-under-load` / `full-suite-red` count).
  *Why: 2026-11-15/16 the owner full suite went red under load (EditModal 5 s timeouts,
  `FoodLibraryTable.perf` 200 ms budget) in several sessions, and each time the files passed alone —
  "passes alone" must be proven and recorded, never assumed, and two reviewers must reach the same
  verdict on it.*
  Older `full-suite-red` entries that name a directory instead of a test file count only when their
  summary names the same test. A checklist change that adds or removes an exception updates the matching
  step in `.claude/agents/qrate-reviewer.md` in the same version bump (grep both for the rule's key
  phrase, e.g. "only exception", "0 failed").

## B. qrate-core — backend / schema / infra

- **B1 CORS 3-file trap.** New HTTP method or CORS change ⇒ `Access-Control-Allow-Methods` updated in
  ALL of `shared/constants.py`, `cognito_auth.py`, `auth.py`. *STR-87.*
- **B2 New route on a non-proxy prefix** ⇒ registered in `infrastructure-cdk/lib/menucrawler-stack.ts`.
  Verify existing prefixes with `get-resources`, don't assume (`/admin/{proxy+}` DOES exist).
- **B3 Migrations are additive only.** `SCHEMA_SQL` / `database-init`: no `UPDATE`/`DELETE` on existing
  rows, no `RENAME TO`/`DROP COLUMN`/`DROP TABLE` (orphan re-creation on older refs). Seeds with
  `ON CONFLICT DO NOTHING` don't change existing rows — flag if the intent needs an UPDATE.
- **B4 Schema-guard comma trap.** No prose commas inside a `CREATE TABLE` body comment
  (test_schema_consistency splits on commas → phantom columns).
- **B5 `db_utils.py` 4 copies in sync** if any one changed.
- **B6 Auth on every new endpoint**, and ownership/IDOR check (restaurant id in path belongs to caller).
- **B7 EMF dimensions bounded.** No `RestaurantId`/`UserId`/`OrderId`/`SessionId` in `Dimensions`
  (`.claude/rules/cloudwatch-cost-patterns.md`). New log groups have explicit retention.
- **B8 Money.** Option prices clamped ≥ 0 server-side; patron never sees a negative price; no tax
  unless `payments_enabled` or `features.upi` AND rate > 0 (memory `no_silent_tax`).
- **B9 Tests run from `backend/`** (conftest puts the shared layer on `sys.path`).
- **B10 Schema ships BEFORE the code that reads it — across release trains too** (2026-11-12, Avi).
  The deploy runs `cdk deploy` (new code live) BEFORE db-init (migration), so a commit that adds a column
  AND reads it 500s in that window. Split it: the schema commit `[DEPLOY FIRST]`, the code `[DEPLOY SECOND]`,
  and a prod release train must carry the schema commit in an EARLIER train than the code (or prove prod
  already has the column before approving). **Degrade wording** (2026-11-16, Avi; trap
  `code-before-schema-window`): a reader that degrades to an empty 200 in the cdk→db-init window is P2
  (silent wrong data); a reader that 500s is P1. Either way, the commit message says which.
- **B11 A new DB-backed test file is wired into CI** (2026-11-15, Avi; `db-tests-skip-in-ci`, from the
  cart-suggestions review). A new test file that skips without `TEST_DATABASE_URL` ⇒ it is added to the CI
  schema-integration step in `infrastructure-cdk-cicd/lib/cicd-core-pipeline-stack.ts`, or it never runs in
  the pipeline.

## C. Webapps (owner / admin / patron / waiter / wine / landing)

- **C1 Shared types from `@qrate/shared`**, never local `@/types` for shared models (owner).
- **C2 `data-testid` on new interactive elements**; E2E selectors use testids/roles, never text/CSS.
- **C3 E2E specs follow the 10 rules** in `deployment-traps.md` (trailing-slash URL regex, no CSS
  `[value=]` on controlled inputs, no `**/` in JSDoc, unconditional sync-points, guard optional data).
- **C4 E2E tables ≥ 9900**; owner E2E pinned to Farm+Oak; cleanup restores shared state AND reads it
  back (see E4).
- **C5 Fonts self-hosted** — no `next/font/google` or Google `/l/font?kit=` (CodeBuild flake).
- **C6 Submodule pointer.** `packages/shared` bump is intentional and the turbo input override still exists.
- **C7 A control that changes what it does or what it covers ⇒ every E2E that drives it moves in the same
  commit** (2026-11-12, Avi; `stale-e2e-assert-after-ui-change`, recurring). When a shared control changes
  behaviour, renders something new on top (a dropdown, an overlay), or loses/renames a testid, grep `e2e/`
  (and the canary repo) for every spec and helper that drives it and confirm each later click/assert still
  works — e.g. a header search that now opens a results list over the page needs every "type, then click a
  row" spec to close the list first. A spec that switches editor sections must re-select the section before
  using a field that lives in another one.
- **C8 Rendered TEXT changes ⇒ grep the canary for that text before PASS** (2026-11-15, Avi;
  `stale-e2e-assert-after-ui-change`, recurring). When an element keeps its testid but what it RENDERS
  changes (a label dropped for an icon, a value reformatted), run
  `git -C qrate-canary grep -n '<testid>' origin/main` and check every `toContainText` / `toHaveText` on it
  (and the same in `e2e/`). Each one is fixed in the same release (with the canary proven on demand), or the
  diff keeps the old text reachable (e.g. screen-reader text beside the icon). *Why: the owner wine price
  became icon + amount and canary owner-menu-bulk-actions still read "Glass $11.00".*
- **C9 Shared menu-manager changes made for the owner workspace stay workspace-only** (2026-11-15, Avi;
  `ungated-classic-change`, recurring). A `packages/shared` menu-manager change written for the owner Menus
  workspace is guarded by `useBuilderWorkspace()` / `workspaceMode` / `rowChrome` unless the brief says the
  classic builder (admin, waiter) changes too. Check the classic `MenuManagerClient` props still reach the
  old path. *Why: grip-only sub-category drag first landed ungated and would have changed admin and waiter
  on their next submodule bump.*

## D. Cross-repo contracts

- **D1 Serve/status state machine** (core + waiter + canary) changes together — `groupKeyForItem`,
  "Enter in POS"/"Mark Served", serve testids. Canary follow-up required.
- **D2 Deploy order** stated: core `[DEPLOY FIRST]` → webapps `[DEPLOY SECOND]`. A webapp change that
  calls a new core route must not ship before core reaches the env.
- **D3 WS `ServerMessage` union is closed** — a new message type needs both ends.
- **D4 Optional request fields that change server behaviour** (2026-11-16, Avi; trap
  `optional-param-silent-fallback`). When a diff adds an optional request field or query param whose
  ABSENCE changes the server's result — OR adds/changes a CALLER of an endpoint that has one — it does
  one of: (a) shows EVERY caller sending it — file:line in
  each caller repo — plus a contract test in the caller asserting the field is in the real request body;
  or (b) makes the server's fallback correct for the business, never the Lambda clock or locale (time
  falls back to the restaurant's timezone, not UTC; and where that timezone can be NULL — it is NULL for
  existing restaurants — the server must not guess: it returns an explicit not-ready/required error,
  e.g. core's `timezone_required`, so the caller is forced onto (a)). Either way, the fixture proving the path exercises
  the dimension the field controls: a time-dependent field is proven against a timed menu, at a moment
  where local and UTC dates differ — not only against an all-day fixture. The reviewer greps the callers.
  *(Suggestions API took optional `local_time`/`day_of_week`, fell back to UTC; the patron never sent
  them; dev Anant evening orders got no suggestions.)*

### Release trains

- **R1 Trains carry test de-flakes** (2026-11-16, Avi; trap `full-suite-red`). A train cut from a prod
  branch carries main's test-only de-flake commits for any test that is red in the full run (A6t
  timing-budget reds included: if main has their fix, the train carries it; if main has none yet, A6t
  applies — P3, listed and filed).
- **R2 Edited specs run against the release build** (2026-11-16, Avi; trap `new-e2e-spec-never-run`).
  Every spec edited relative to the PROD base is run against the release build: the release pipeline has
  no E2E stage, and main's E2E-Dev does not count when the release source differs from main.
- **R3 A NEW remote release branch is keyed against the default branch** (2026-11-16, Avi; trap
  `new-release-branch-review-key` — new slug, first recorded here). The push gate keys a branch that does
  not yet exist on origin against `origin/main` (`origin/master` where that is the default, e.g.
  qrate-recommender). The reviewer computes that key read-only — never by changing git config:
  `python3 -c "import sys; sys.path.insert(0,'<repo>/.claude/review'); import qrate_review as q; print(q.review_key('<repo>','HEAD','<release-branch>'))"`.
  The builder cuts the branch with `--no-track` so its local upstream cannot shift the key, and says so
  in the brief.

## E. Canaries (qrate-canary)

- **E1** Asserts the app's REAL shape (read the component/route), pinned to its OWN artifact id.
- **E2** No vacuous assertions; cleanup asserted; no retries on stateful journeys.
- **E3** Schedule rows have `extraEnv`; never armed before an on-demand green; never touches real POS.
- **E4 Shared-fixture restore is read back** (2026-11-16, Avi; traps `e2e-shared-fixture-cross-spec-race`,
  `shared-fixture-precedence-leak`, `e2e-mutates-low-numbered-table`). A canary or test (incl. E2E, C4)
  that changes shared fixture state restores it in `finally` / `afterAll` AND reads it back to prove the
  restore took — a restore call alone is not evidence.
- **E5 Fixtures must vary the tested dimension** (2026-11-16, Avi; trap `fixture-removes-tested-dimension`).
  A canary fixture that removes the dimension under test (all-day menus for time logic, single-currency for
  money, one guest for table logic) cannot be the only proof of that dimension; add a step that varies it.

## F. Firmware (qrate-table-device)

- **F1** Firmware change ⇒ owner device simulator re-synced (`ship-device-sim.sh`).

---

## Promoted from findings.jsonl

<!-- The reviewer proposes promotions in its PROMOTE section; the orchestrating agent (with the
     user's OK) appends them here as G1, G2, … with the date and the finding ids that justified it. -->

- **G1 Gate matcher changes are corpus-diffed, not spot-tested** (2026-11-09; `gate-fail-open-unresolved-push-dir`,
  `gh-api-write-detection-gaps`). Any change to how `qrate_review.py`/`machine.py` parse commands or resolve a
  repo/dir must run the OLD and NEW gate over a GENERATED corpus: every deny case with read-looking suffixes
  (`--jq GET`, `--template HEAD`, `-q GET`), quoted pure-punctuation values before the write flags (`'{}'`,
  `';'`, `'()'`, `'|'`), `$(…)`/backtick wraps, and percent-encoded and alias variants. Every
  old-DENY → new-ALLOW needs real-shell/real-gh evidence (a fake binary showing the env, pwd and args the child
  sees) or it is a P1.
- **G2 gh alias handling is tested at set AND run time** (2026-11-09; `gate-gh-alias-indirection`): `$N`
  placeholders, multi-word names, `alias set x -` (stdin), `!` and `--shell`, `alias import`.
- **G3 Fail closed on what can't be resolved** (2026-11-09; `gate-fail-open-unresolved-push-dir`): non-existent,
  empty, subshell, `cd -`/`popd`, conditional and UNRESOLVED dirs/targets count as QRate; never derive a gh
  endpoint/subcommand from a fixed argument position; keep a whole-command fail-closed fallback for anything the
  parser can't read.
- **G4 Every exit is locked while a write is in flight** (2026-11-09; `busy-flow-abort-via-ui-switch`,
  `dialog-dismissible-while-busy`). When a flow can be mid-write (claim, save, send to a device, payment),
  EVERY route that closes, unmounts or switches it — X, Esc, scrim, Done/Cancel, Back/stepper, route or tab
  pickers, links that navigate or unmount the parent — is disabled for that window, and the lock is keyed on
  the WRITE only (not on long waits the user must be able to cancel). Enumerate the exits in the review;
  one missed exit is the bug.
- **G5 Async flows re-check that they are still current after every await** (2026-11-09;
  `async-flow-missing-generation-check`, `generation-guard-self-invalidated`). A cancellable async flow
  (connect, scan, poll, upload) captures a generation/attempt id and checks it after EACH await — on the
  success path AND in every catch/finally — before touching state, opening resources or reporting an error.
  The id that answers "was I abandoned?" must not be bumped by the flow's own failure handler; who clears a
  busy flag is decided by a separate per-attempt id. Each guard needs a test that is red without it.
- **G6 Every App-Doc selector has a unit test that renders it** (2026-11-10;
  `app-doc-selector-contract-without-unit-test`, recurring). App-Doc `execution.ts` is the SAGE-AI
  contract: any `data-testid` that a commit adds to or changes in an App-Doc procedure's `selectors` (and
  any id a canary or E2E spec asserts) must have, in the same commit, a unit test that mounts the page or
  component and finds that id — including its gated/disabled states. A manual browser run is not evidence;
  only a test keeps the contract honest when the control is later moved or renamed.
- **G7 A recommendation fallback applies the same eligibility as the primary path** (2026-11-11;
  `served-fallback-ranker-ignores-course`, recurring). Any fallback that answers a Sage / recommendation ask
  from a different source than the stored buckets (`rank()`/`candidates()`, a relaxed or widened query, a
  "served now" re-rank) must apply the SAME course, combo and restriction eligibility as `build_buckets`:
  protein groups are mains and starters only, a course ask answers only that course, restrictions are never
  relaxed. The diff needs a test in which an off-course dish (a protein bread, side or dessert; a main for a
  "desserts" ask) is on the menu and is never picked, and the fallback must not present a widened answer under
  the plain, un-relaxed lead.
- **G8 An E2E never passes without exercising its journey** (2026-11-11; `e2e-conditional-early-return`,
  `e2e-fixture-feature-flag-off`, recurring). A new or changed spec must not go green by annotating and
  returning, or by skipping a step, when its precondition data or flag is absent. Either seed what it needs
  (self-contained, ids recorded the moment each create returns, cleaned up in afterAll), pin a fixture that
  has it, or route-mock the reads — and then ASSERT the precondition with a message that names the fixture
  gap (`expect(count, 'no sub-categories on the seeded menu').toBeGreaterThan(0)`), after waiting for a
  terminal render state (not during a loading skeleton). Check the fixture's feature flags (e.g. Farm + Oak)
  before asserting a flag-gated surface.
  **Retargeting a spec counts as changing it** (2026-11-13, Avi): a rewrite that points an existing spec
  at a new control must not carry forward its old annotate-and-return escapes — remove them in the same
  commit or turn each into a hard `expect(..., 'fixture gap: …')`.
- **G9 App-Doc prose moves with the control** (2026-11-11; `app-doc-prose-stale-after-ui-change`,
  recurring). When a commit moves, hides or removes a visible owner-page element, grep ALL of App-Doc
  (`execution.ts`, `manifest.ts` and the `page.tsx` prose) for every phrase that described its OLD place
  and every variant of it ("title row", "beside the (page) title", "under the title", "status row",
  "toolbar") — not only its `data-testid` — and fix each one. Bump `DOC_VERSION` and add a CHANGELOG line
  in the same commit.
- **G10 A side-write inside an editor must rebase what Save compares against** (2026-11-12;
  `save-baseline-stale-after-side-write`, recurring). When a window writes something on the side (edit or
  delete a library entry, rename a shared resource) while still offering Save, the snapshot Save diffs
  against — in the window AND in the host that opened it — must be patched by the SAME rule the server write
  used, applied to the CURRENT state (functional `setState`), and only for writes that landed. Otherwise
  Save replays the old value and undoes the side-write. Require a test that does BOTH steps in one
  render — side-write, then Save — and asserts the side-written value is not written back (mutation-check
  it: remove the rebase, the test must go red).
- **G11 Esc / outside-click guards are tested against the REAL popovers** (2026-11-12, Avi). A window that
  closes on Esc or outside click must leave Esc to whatever inside it owns it (an open menu, listbox,
  combobox, a search box with text, a nested window) — and the test must open the REAL popover component
  (not a stub div) and press Esc / mousedown on it, asserting only the innermost layer closes.
- **G12 A restaurant-wide write is decided on the UNFILTERED list of every kind** (2026-11-12, Avi;
  `beverage-subcategory-persisted-as-food`, `filtered-view-drives-global-write`). A rename / merge / delete
  that the server applies to every matching row (e.g. the library category rename) must compute "is it
  empty", the item count, the destinations and name-uniqueness from ALL items of every kind with no search
  applied — never from the panel's current kind or search — and must never target a synthetic bucket
  (the "Other" row for uncategorised items).
- **G13 An Owner App-Doc bump is checked against upstream's `DOC_VERSION`** (2026-11-15, Avi;
  `app-doc-version-collision`). Owner App-Doc bump ⇒ compare `DOC_VERSION` with current `origin/main` before
  PASS; if upstream bumped too, the builder rebases + regenerates both `app-doc-manifest.json` before review.
