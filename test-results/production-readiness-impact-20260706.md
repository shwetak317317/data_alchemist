# Production Readiness — Impact Graph — 2026-07-06

Lenses run: DE-wiring OK · DE-stakeholder OK · AI-pipeline OK (no changes needed) · UI/UX+PM OK · Security OK

Anchor scenario: "An anomaly fired on a table at 2 a.m. — what feeds it (root cause direction), what does it feed (blast radius), and how bad is it?"

## Fixed this pass: 8 (P0: 1, P1: 2, P2: 3, P3: 2)

### P0
1. **Screen crashed on load with any active connection** — SEVEN of the thirteen DTApi functions the screen calls were never exported from api.js (`discoverLineage`, `listSuggestedEdges`, `approveLineageEdge`, `rejectLineageEdge`, `getImpactNarrative`, `getLineageRootCauses`, `getLineageHealth`). The LineageHealthCard effect threw a TypeError on mount → error boundary killed the whole screen; Discovery, the suggested-edge review queue, the AI impact narrative, root-cause ranking, and lineage coverage were all unreachable. The backend for every one of these existed and was solid. All seven exports added; every flow verified live. `[wiring][UX]`

### P1
2. **No org access control on any of the 16 lineage routes** — any authenticated user could read, seed, discover, or DELETE another organisation's lineage nodes/edges by id. All routes now assert org access (connection-scoped directly; node/edge routes via ownership lookup). `[SEC]`
3. **Unknown table returned the ENTIRE graph as "impact"** — `GET /lineage/{table_fqn}`'s fallback made a table with no lineage look like it impacts everything (a false blast radius, the worst possible failure for an impact endpoint). Now returns an honest empty graph. `[DE]`

### P2 (scenario-driven UX)
4. **Node panel now answers the 2 a.m. question directly** — new "FED BY (n) — root-cause direction" and "FEEDS INTO (n) — blast radius" sections with health-colored, clickable neighbor chips (click jumps the panel to that table). Previously the only way to see a node's neighbors was tracing bezier curves by eye. Verified live. `[UX][DE]`
5. **"View Report" now drills into the selected table** (sets the active table before navigating to Profiling) instead of dumping the user at the top of the Profiling screen. `[UX]`
6. **Coverage math verified live**: seeding 2 tables + adding 1 edge moved Lineage coverage to "100% — 2 of 2 known tables", sourced from `connection_tables`, per connection. `[DE]`

### P3
7. Seed failure used a native `alert()` → now the app's toast. `[UX]`
8. Edge-add flow verified end-to-end (cycle rejection message surfaces directly; select-based source/target; path list updates live). `[UX]`

## AI lens — PASS, no changes
`lineage_narrative.py` is the model implementation for this codebase: LLM never invents graph structure (given the real BFS downstream slice), severity computed deterministically (not by the model), Pydantic-validated bullets, 10s timeout, honest `generated_via: template` fallback surfaced as a "fallback" chip in the UI, structured logging with prompt version + tokens + latency. Verified live: narrative generated via LLM with severity chip.

## Verification evidence (live, zero console errors)
- Impact screen loads with coverage card (previously: guaranteed crash).
- Seed → 2 nodes render in tiered canvas; Add Edge customers→orders → lineage path renders, coverage 100%.
- Node panel: FED BY (1) with main.customers chip / FEEDS INTO (0); Explain impact → LLM narrative + severity.
- Discovery drawer: runs without crash; honest per-source results ("0 FK edges (0 schemas scanned)", "Query-log discovery not yet implemented for platform 'duckdb'").
- Final screenshot: `.playwright-mcp/impact-APPROVED-final.png`

## Follow-up completed same day
- **Cross-module incident loop shipped**: every anomaly card now has a "View impact" action that opens the Impact Graph with that table's node preselected and auto-scrolls the FED BY / FEEDS INTO panel into view; if the table has no lineage node yet, an honest toast says so and points at Discover/seed. Verified live end-to-end (anomaly → impact → panel in viewport, zero console errors).

## Deferred (documented, non-blocking)
- Query-log lineage discovery not implemented for DuckDB (supported platforms report honestly; DuckDB has no persistent query log to mine). Owner: DE. P3.
- BFS traversals are query-per-node (fine at current graph sizes; batch if graphs reach thousands of nodes). Owner: DE. P4.

## Verdict: PRODUCTION READY
