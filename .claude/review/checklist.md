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
  verified (run the targeted suite if it takes < ~3 min, otherwise say NOT VERIFIED). No
  `test.skip`, `it.skip`, `xit`, `@pytest.mark.skip`. *Why: CI red burns a deploy cycle; skips are banned.*
- **A3 Piped exit codes.** No `cmd | tail -N && git push` / `pytest | tail` gating anything.
  *Why: `tail`'s exit code masks the test failure (memory `pipe_tail_masks_test_failure`).*
- **A4 Does the diff match the stated intent?** Unrelated hunks, stray debug code, files from a
  parallel session swept into the commit (shared git index). *Why: concurrent agents share one index.*
- **A5 Error paths.** Swallowed exceptions, `catch {}` / bare `except:`, best-effort helpers whose
  failure is only `console.warn`-ed on a path that matters.

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

## C. Webapps (owner / admin / patron / waiter / wine / landing)

- **C1 Shared types from `@qrate/shared`**, never local `@/types` for shared models (owner).
- **C2 `data-testid` on new interactive elements**; E2E selectors use testids/roles, never text/CSS.
- **C3 E2E specs follow the 10 rules** in `deployment-traps.md` (trailing-slash URL regex, no CSS
  `[value=]` on controlled inputs, no `**/` in JSDoc, unconditional sync-points, guard optional data).
- **C4 E2E tables ≥ 9900**; owner E2E pinned to Farm+Oak; cleanup restores shared state.
- **C5 Fonts self-hosted** — no `next/font/google` or Google `/l/font?kit=` (CodeBuild flake).
- **C6 Submodule pointer.** `packages/shared` bump is intentional and the turbo input override still exists.

## D. Cross-repo contracts

- **D1 Serve/status state machine** (core + waiter + canary) changes together — `groupKeyForItem`,
  "Enter in POS"/"Mark Served", serve testids. Canary follow-up required.
- **D2 Deploy order** stated: core `[DEPLOY FIRST]` → webapps `[DEPLOY SECOND]`. A webapp change that
  calls a new core route must not ship before core reaches the env.
- **D3 WS `ServerMessage` union is closed** — a new message type needs both ends.

## E. Canaries (qrate-canary)

- **E1** Asserts the app's REAL shape (read the component/route), pinned to its OWN artifact id.
- **E2** No vacuous assertions; cleanup asserted; no retries on stateful journeys.
- **E3** Schedule rows have `extraEnv`; never armed before an on-demand green; never touches real POS.

## F. Firmware (qrate-table-device)

- **F1** Firmware change ⇒ owner device simulator re-synced (`ship-device-sim.sh`).

---

## Promoted from findings.jsonl

<!-- The reviewer proposes promotions in its PROMOTE section; the orchestrating agent (with the
     user's OK) appends them here as G1, G2, … with the date and the finding ids that justified it. -->
