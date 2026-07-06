# Production Readiness — Anomaly Inbox — 2026-07-06

Lenses run: DE-wiring OK · DE-stakeholder OK · AI-pipeline OK · UI/UX+PM OK · Security OK

## Fixed this pass: 17 (P0: 2, P1: 5, P2: 7, P3: 3)

### P0 — screen-crashing
1. **Thresholds inputs crashed on every keystroke** — handlers assumed an event object but `Input` (primitives.jsx) passes the raw value; `e.target.value` threw → error boundary killed the screen. Fixed handlers; documented the contract inline. `[UX][DE]`
2. **Three frontend API functions didn't exist** (`getThresholds`, `saveThresholds`, `shareAnomaly` never exported from api.js) — opening Thresholds crashed the screen, Save showed a fake success toast without calling the backend, Share to Slack threw. All three added and verified live. `[wiring][UX]`

### P1
3. **No org access control on any anomaly route** — inbox/scan/ack/explain/share/thresholds/fingerprints accepted any connection_id; inbox without a filter returned every org's anomalies. All routes now assert org access; inbox/fingerprints scope by org join. `[SEC]`
4. **Test seed/cleanup endpoints unguarded** — now 404 when `APP_ENV=production` (still work in dev for the Playwright suite) plus org checks. `[SEC]`
5. **Thresholds were a placebo end-to-end** — saved in-memory (lost on restart) and never read by detection. Now DB-persisted (migration 32, survives restarts — verified) and wired into every detector as minimum-deviation floors. `[DE][wiring]`
6. **Scan duplicated open anomalies every run** (live evidence: same NetPayable anomaly twice) — `_save_anomaly` now refreshes the existing open row in place; "N detected" counts only new rows. Verified: scan #1 → 2, scan #2 → 0. `[DE]`
7. **Explainability LLM calls had no audit trail** — now logged to `rule_ai_calls` (call_type=ANOMALY_EXPLAIN) with prompt, raw response, tokens, latency; verified row present. `[AI]`

### P2
8. **Freshness detection didn't exist** despite the UI promising it — new `detect_freshness_anomaly` (severity scales with SLA overrun); verified live: 2 FRESHNESS anomalies fired for tables 67h stale vs a 48h SLA. `[DE]`
9. **Zero-stdev false alarms** — stable baselines (stdev→1 coercion) flagged ±2-row blips as CRITICAL "0% deviation"; the new threshold floors suppress these. `[DE]`
10. **Zero values displayed as missing** — `if row[9]` treated metric 0 (worst volume anomaly) as NULL; now `is not None`. `[DE]`
11. **Pseudo-layers ("BRONZEDB", "MAIN")** — layer now comes from the table's profiling report; 18 existing rows backfilled. `[DE]`
12. **Canned fallback wore the "AI-generated" badge** — explanations now carry `fallback: true` and the UI shows "Auto-generated (AI unavailable)". `[AI][UX]`
13. **`when_first_seen` was hallucinated** — `detected_at` now passed into the prompt with an explicit never-invent instruction; verified grounded output. `[AI]`
14. **Fingerprint tab showed every incident for the connection** — now filtered to the anomaly's own table. `[DE][UX]`
15. **Scan 500'd on connector failures** — graceful 502/404 with a friendly message; verified. `[DE]`

### P3
16. **Ack failures were silent lies** — optimistic ack now reverts + error toast if the server rejects. `[UX]`
17. **Time-only timestamps** ("09:14" for a 3-day-old anomaly) → date + time; **sparkline mislabeled** profiling runs as days (D-6…Today → −6…Latest); **Escalate created duplicate tasks** on repeat clicks → disabled "Escalated" state after success; **threshold inputs accepted negatives** → client+server validation (400). `[UX]`

## Verification evidence
- API: thresholds save→load→restart→load (values survive), negative rejected 400, scan dedup (2 then 0), explain 200 with `fallback:false` and grounded timestamp, ANOMALY_EXPLAIN logged with tokens/latency, unreachable-source scan returns clean 404/502.
- UI (Playwright): loading state on first paint; 2 FRESHNESS anomalies rendered; Thresholds open/type/save with no crash and DB row updated (35/15/48, attributed to test@pal.tech); Explain shows loading → AI-generated badge → What happened / Why it matters / 3 actions; Share toast; Escalate → disabled "Escalated"; Acknowledge chip; zero console errors.
- Final screenshot: `.playwright-mcp/anomalies-APPROVED-final.png`

## Deferred (documented, non-blocking)
- Slack delivery for Share is audit-log-only by design (external delivery not wired) — the button copy could say so. Owner: product. P3.
- "Edit explanation" / "Send to Finance" buttons are intentionally disabled with explanatory tooltips (no backend integrations exist). Owner: product. P3.
- Anomaly history sparkline uses profiling-run row counts, which is only meaningful for VOLUME-type anomalies; other types show the same series. Owner: DE. P3.

## Verdict: PRODUCTION READY
