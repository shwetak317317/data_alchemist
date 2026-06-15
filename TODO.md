# Data Alchemist — Progress Tracker

> Last updated: 2026-06-15

---

## Legend
- ✅ Done
- 🔄 In progress
- ⬜ Pending
- ❌ Blocked / known issue

---

## Infrastructure & Deployment

| # | Task | Status | Notes |
|---|------|--------|-------|
| I-1 | Docker Compose — postgres + backend + frontend | ✅ | `docker compose up --build` works |
| I-2 | Debian 12 (bookworm) pinned base image | ✅ | Fixes `apt-key: not found` on trixie |
| I-3 | ODBC Driver 18 for SQL Server in Docker | ✅ | Modern GPG method in Dockerfile |
| I-4 | bcrypt version warning (`__about__` missing) | ✅ | Pinned `bcrypt==4.0.1` |
| I-5 | DATABASE_URL uses service name `postgres` | ✅ | Fixed from `localhost` |
| I-6 | All 9 DB schemas auto-applied at startup | ✅ | Including `09_users.sql` |

---

## Authentication

| # | Task | Status | Notes |
|---|------|--------|-------|
| A-1 | Login page — Email/password (PostgreSQL users table) | ✅ | `POST /api/auth/login` with bcrypt |
| A-2 | Register page — create local account | ✅ | `POST /api/auth/register`, redirects to login on success |
| A-3 | Microsoft Entra ID SSO (PKCE, no client secret) | ✅ | Full PKCE flow with `domain_hint=pal.tech` |
| A-4 | MS SSO demo mode when Azure not configured | ✅ | Falls back to demo login |
| A-5 | Azure App Registration setup | ⬜ | Need `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` in `.env` |
| A-6 | Greeting uses logged-in user's name | ✅ | Reads `sessionStorage("dt_user")` |

---

## SQL Server Connection Wizard

| # | Task | Status | Notes |
|---|------|--------|-------|
| C-1 | SQL Server Auth (username/password) in wizard | ✅ | |
| C-2 | Windows Auth option | ✅ | |
| C-3 | Azure AD auth option | ✅ | |
| C-4 | Database field is optional | ✅ | Connects to login's default DB when blank |
| C-5 | Real error message from pyodbc shown on screen | ✅ | test() now raises; API returns `str(e)` |
| C-6 | Failing step shown with red X icon | ✅ | Last step turns red on failure |
| C-7 | Error reason shown in monospace box | ✅ | ODBC error string displayed below steps |
| C-8 | Retry button re-runs the test in-place | ✅ | `retryKey` increments to re-trigger useEffect |
| C-9 | Back to credentials button on failure | ✅ | Visible when testSuccess === false |
| C-10 | Optional field badge shown in form | ✅ | Database and Instance show "optional" tag |
| C-11b | Schema selection step shows REAL schemas from test | ✅ | `result.schemas` returned by test endpoint, pills for any name |
| C-12 | Select all / Deselect all in schema step | ✅ | Helper buttons in step 3 |
| C-11 | Credentials encrypted (Fernet/AES-256) | ✅ | In `connections.py` |

---

## Backend API

| # | Task | Status | Notes |
|---|------|--------|-------|
| B-1 | `POST /api/connections/test` — step-by-step trace | ✅ | 6 named steps, real error on fail |
| B-2 | `POST /api/connections` — save connection | ✅ | |
| B-3 | `GET /api/connections` — list connections | ✅ | |
| B-4 | `DELETE /api/connections/{id}` | ✅ |
| B-4b | `PATCH /api/connections/{id}` — update name / schemas_scope | ✅ |
| B-4c | `GET /api/connections/{id}/schemas` — live schema list + current scope | ✅ | |
| B-5 | `POST /api/profiling/run` — SSE stream | ✅ | |
| B-6 | `GET /api/metadata/dictionary` | ✅ | |
| B-7 | `POST /api/metadata/dictionary/{id}/decide` | ✅ | |
| B-8 | `GET /api/metadata/cdes` | ✅ | |
| B-9 | `POST /api/rules/recommend` | ✅ | |
| B-10 | `POST /api/rules/nl` — NL → DQ rule | ✅ | |
| B-11 | `PATCH /api/rules/{id}` — approve/reject | ✅ | |
| B-12 | `POST /api/execution/run` | ✅ | |
| B-13 | `GET /api/execution/results/{run_id}` | ✅ | |
| B-14 | `POST /api/anomalies/scan` | ✅ | |
| B-15 | `GET /api/anomalies/inbox` | ✅ | |
| B-16 | `POST /api/anomalies/{id}/explain` | ✅ | |
| B-17 | `GET /api/dashboard/summary` | ✅ | |
| B-18 | `POST /api/simulation/inject` — SSE stream | ✅ | |
| B-19 | `GET /api/auth/microsoft/url` | ✅ | |
| B-20 | `POST /api/auth/microsoft/token` | ✅ | |
| B-21 | `POST /api/auth/register` | ✅ | |
| B-22 | `POST /api/auth/login` | ✅ | |
| B-23 | `GET /api/intel/advisory` | ✅ | Returns mock data |
| B-24 | `GET /api/intel/receipt` | ✅ | Returns mock data |

---

## Frontend Screens (14 screens)

| # | Screen | API wired? | Known issues | Status |
|---|--------|-----------|--------------|--------|
| S-1 | Home / Workspace | ✅ Partial | Activity feed still hardcoded | 🔄 |
| S-2 | Profiling | ✅ SSE | Layer casing mismatch possible | ✅ |
| S-3 | Metadata / CDEs | ✅ | `column_id` now mapped from API | ✅ |
| S-4 | Rule Studio | ✅ Partial | Per-rule run uses hardcoded FAILING data | 🔄 |
| S-5 | DQ Execution | ✅ | Run header now dynamic from runMeta | ✅ |
| S-6 | Anomaly Inbox | ✅ | AI explanation now shown when available | ✅ |
| S-7 | Impact Graph | Static | `edgePath` null guard added | ✅ |
| S-8 | Trust Dashboard | ✅ Partial | ruleFailTrend chart still hardcoded | 🔄 |
| S-9 | Pre-run Advisory | ✅ | Using DTApi.getAdvisory now | ✅ |
| S-10 | Trust Receipt | ✅ | Using DTApi.getReceipt now | ✅ |
| S-11 | Scenario Simulator | ✅ SSE | heal() null guard added | ✅ |
| S-12 | Task Board | ✅ | key={task.id\|\|i} fixed | ✅ |
| S-13 | Daily Summary | Static | All issues/decisions hardcoded | ⬜ |
| S-14 | Connections | ✅ | "Use this", "Edit schemas" panel, auto-select first on load | ✅ |

---

## Known Issues / Remaining Work

| # | Issue | Priority | Notes |
|---|-------|----------|-------|
| K-1 | Gemini API key format `AQ.` — not standard `AIza...` | HIGH | LLM features may silently fail |
| K-2 | Home activity feed hardcoded (not from API) | MEDIUM | Add `GET /api/dashboard/activity` endpoint |
| K-3 | Rule Studio per-rule run uses hardcoded FAILING map | MEDIUM | Wire to `POST /api/execution/run` for single rule |
| K-4 | Trust Dashboard ruleFailTrend chart hardcoded | LOW | Backend returns trend data but not wired |
| K-5 | Daily Summary screen fully hardcoded | LOW | Aggregate from existing APIs |
| K-6 | Azure App Registration not yet done | BLOCKER for SSO | See README → Microsoft SSO Setup |
| K-7 | Profiling layer casing — API returns lowercase, UI expects UPPER | LOW | Add `.toUpperCase()` in mapping |
| K-8 | Impact Graph is fully static (no API) | LOW | Would need lineage graph backend |

## Recently Fixed (2026-06-15)
- **Active connection default** — sidebar showed "RetailCo · Snowflake" hardcoded; now shows "Demo mode" when nothing connected
- **Sidebar user** — was hardcoded "Ravi Kumar"; now reads `sessionStorage(dt_user)` set at login
- **TopBar breadcrumb** — was hardcoded "RetailCo"; now shows active connection name or "DataTrust"
- **Auto-select first connection** — on app load + connections screen load, auto-selects first active connection if none set
- **"Use this" button** — per connection card; calls `setActiveConn` and updates sidebar immediately
- **"Edit schemas" panel** — inline schema selector per connection card; fetches live schemas from `GET /api/connections/{id}/schemas` and saves via `PATCH /api/connections/{id}`

---

## Steps from Original Plan

| Step | Description | Status |
|------|-------------|--------|
| 1 | Project scaffold | ✅ |
| 2 | Metadata DB (9 schemas) | ✅ |
| 3 | LiteLLM wrapper | ✅ |
| 4 | Connector framework | ✅ |
| 5 | Connections API + wizard | ✅ |
| 6 | Profiling Agent + API | ✅ |
| 7 | Wire profiling UI | ✅ |
| 8 | Metadata Agent + API | ✅ |
| 9 | Rule Agent + API | ✅ |
| 10 | Execution Agent + API | ✅ |
| 11 | Anomaly Agent + API | ✅ |
| 12 | Explainability Agent | ✅ |
| 13 | Trust Dashboard API | ✅ |
| 14 | Scenario Simulator API (SSE) | ✅ |
| 15 | Monitoring loop + Task Board | ✅ |
| 16 | Remaining UI screens wired | ✅ |
| 17 | End-to-end test with real SQL Server | ⬜ Need SQL Server credentials |
