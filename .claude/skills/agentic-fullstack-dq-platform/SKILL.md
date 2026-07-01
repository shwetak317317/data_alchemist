---
name: agentic-fullstack-dq-platform
description: >
  Use when building, testing, reviewing, or completing any module of a fullstack
  Python + AI data-quality platform. Drives a screenshot-diagnose-fix loop per module
  until zero functional/accuracy/UI problems remain. Covers nav-bar modules, backend
  API, DB layer, AI pipeline, frontend. Run before writing code.
---

# Agentic Fullstack DQ Platform — Production Skill (Compact)

Orchestrate 5 subagents in sequence + review loops. No module ships until every
agent signs off and the screenshot loop is clean. Live data only — no stubs/mocks
in production. Everything on screen must come from the live DB or live AI pipeline.

## Axioms (non-negotiable)
1. Live data only — no `DEMO_DATA`, `mockData`, lorem-ipsum, hardcoded values.
2. Zero orphaned UI — every element wired to a real query/inference, or removed + `TODO:WIRE`.
3. DB is source of truth — all displayed state persisted, scoped by `connection_id` FK, zero cross-contamination on connection switch.
4. Playwright is the acceptance gate — screenshot + assert, no exceptions.
5. Structured logging on every route/job/AI call/DB write; errors surface in UI, never swallowed.
6. Think like the data engineer who owns the SLA: "Would I bet a pipeline SLA on this number?"

## Agent Roster

**1. BA/DE (stakeholder)** — maps each module to: data source tables, primary metric,
"healthy" definition. Writes `docs/DATA_CONTRACT.md` (every UI field → exact DB column;
unmapped fields flagged `MISSING`). Lists all `connection_id`-scoped tables. Signs off
when contracts are complete.

**2. Tester (Playwright)** — trusts nothing pre-verified.
- *Smoke run*: navigate every module route, full-page screenshot, assert no
  `[object Object]`/`undefined`/`NaN`/`null`, no stuck spinner (10s), correct title/breadcrumb.
- *Data presence*: each module shows ≥1 real data item or genuine empty state.
- *Connection toggle*: switch A→B→A, assert values change then restore; fail if any
  value is identical across all connections (static-data leak).
- *Regression diff*: after each fix, re-screenshot, diff against last-passing set.
- Locators: `getByRole`/`getByLabel`/`getByText` first; never `waitForTimeout`.

**3. Data Injector** — activates only when Tester flags an empty screen that should
have data. Writes idempotent `dbscripts/ingest_<module>.py --connection-id <id>`,
using the app's own DB session factory, realistic varied values, UTC timestamps,
rollback on error. Hands back to Tester.

**4. Developer** — production code only.
- Pre-code: read `DATA_CONTRACT.md`, confirm endpoints/components/FKs match it.
- Kill static data: `grep -r "DEMO\|mockData\|fake\|dummy\|lorem\|placeholder\|hardcoded" --include="*.py" --include="*.ts*" --include="*.js*" -l` → replace every hit with a real call.
- API standard: accept `connection_id`; return `{data, meta:{connection_id, generated_at, row_count}}`; errors as `{error:{code, message, detail}}`; log entry+exit+exceptions.
- Frontend standard: loading/populated/error states always; optimistic-clear→fetch→populate on connection switch (no stale flash); no hardcoded badges/scores.
- DB persistence: every UI surface → matching table with `connection_id` FK
  (`trust_scores`, `issues`, `anomalies`, `layer_scores`, `column_profiles`, `dq_rules`,
  `dq_executions`, `anomaly_inbox`, `activity_log`, `workflow_runs` — add more as needed).
  All tables: `created_at`/`updated_at` defaults, FK `ON DELETE CASCADE`.
- AI integration: never hardcode AI text; persist prompt+response to `ai_inferences`;
  cache-first read with TTL; graceful "Advisory unavailable — retry" on failure.
- Logging: structured JSON via `StructuredLogger`; mandatory events:
  `api.request`, `api.response`, `db.query`, `ai.call`, `ingest.script`, `test.result`.

**5. Reviewer** — last gate, skeptical by default.
- Zero static-data hits (re-run Dev's grep).
- Loading+error states verified under throttled network.
- `connection_id` indexed; no N+1 (batch/JOIN instead).
- AI output cross-checked against DB; reject if it cites numbers not in DB or >5% off.
- Connection isolation manually verified, documented.
- Logs tailed during full walkthrough — every action logs.
- Deliberate API failure → UI shows friendly error, not blank/stack trace.
- Smallest-details audit: breadcrumbs, "last run" timestamps, status chips, badge
  counts, deltas, layer-card counts, activity timestamps, workflow stage statuses —
  all must be live-DB-driven, nothing hardcoded.
- Module is DONE only when: tests ≥95% consistent, no mocks, all contract fields
  populated, isolation verified, logging verified, error states verified, AI accuracy
  verified, details audit clean, final screenshot set committed.

## The Loop (per module)

```
1. Screenshot the module (Playwright, full-page, all states: loaded/empty/error).
2. Diagnose: functional bugs, accuracy mismatches (AI vs DB), static/mock data,
   missing wiring, broken connection isolation, console/log errors.
3. Fix: route to the correct agent (Data Injector for missing data, Developer for
   wiring/bugs, BA/DE if the data contract itself is wrong).
4. Re-screenshot. Diff against previous pass.
5. Diagnose again — confirm old problems gone AND no new problems introduced.
6. Repeat steps 3–5 until screenshot/UI shows zero problems.
7. Reviewer runs the full production-readiness gate. If rejected → back to step 3
   with the specific rejection reason. If approved → tag module DONE.
```
Do not batch modules — finish one completely before starting the next.

## Anti-Rationalization (reject these excuses)
"Looks right visually" → not a test, run the assertion.
"I'll persist it later" → later = never, wire it now.
"Mock is temporary" → delete today, write the ingest script.
"Logging after" → log before shipping.
"Tested manually" → put it in the Playwright suite.
"AI is probably accurate" → run the accuracy check, log the result.
"Minor UI detail" → fix it, nothing's too small.
"Error state out of scope" → users hit errors day 1, add it now.

## Folder/Config Conventions
- `dbscripts/ingest_<module>.py` — one per module, idempotent, `--connection-id`, structured logs, exit 0/1.
- `tests/<module-slug>.spec.ts` — one Playwright spec per module.
- `docs/DATA_CONTRACT.md` — single source of UI-field → DB-column mapping.
- `screenshots/final/<module>-<timestamp>.png` — committed on DONE.

## Final Quality Bar (all YES before shipping a module)
Every number from DB? Connection switch changes every scoped value? Every table has
`connection_id` FK? Every route logs entry/exit? Every AI output has an `ai_inferences`
row? API failure shows a real error in UI? Playwright passes incl. screenshots?
Details audit clean? Ingest scripts committed/idempotent? Zero mockData/DEMO/hardcoded
in the diff?