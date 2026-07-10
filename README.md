# Data Alchemist — Agentic Data Quality & Trust Platform

Data Alchemist profiles data, recommends and executes data-quality rules, detects and explains anomalies, and tracks a trust score end-to-end across a warehouse — with an LLM assisting at specific, well-scoped points and a human approving anything that changes system state. It is a full-stack application (React SPA + FastAPI + PostgreSQL), not a notebook or a proof-of-concept script.

---

## Contents

- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Connecting to a database](#connecting-to-a-database)
- [Project structure](#project-structure)
- [API reference](#api-reference)
- [Data model](#data-model)
- [Live Scenario Simulator](#live-scenario-simulator)
- [Environment variables](#environment-variables)
- [Medallion architecture support](#medallion-architecture-support)
- [Human-in-the-loop design](#human-in-the-loop-design)
- [Microsoft SSO setup](#microsoft-sso-setup-paltech)
- [Troubleshooting](#troubleshooting)
- [Current capabilities](#current-capabilities)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser — React 18 SPA, Babel-transpiled in-browser, no build   │
│  14 navigable views across 11 screen files                        │
└───────────────────────────┬────────────────────────────────────────┘
                            │ /api/* — proxied by nginx (proxy_buffering off, SSE-safe)
┌───────────────────────────▼────────────────────────────────────────┐
│  FastAPI backend (:8000) — 12 routers, 94 REST endpoints          │
│                                                                    │
│   ┌────────────────────┐   ┌─────────────────────────────────┐    │
│   │  Profiling Agent    │   │  LiteLLM gateway                │    │
│   │  (LangGraph          │──▶  Anthropic·OpenAI·Azure·Gemini  │    │
│   │   StateGraph,        │   │  ·Ollama — one env var swaps    │    │
│   │   11 nodes, SSE)     │   │  the model everywhere           │    │
│   └────────────────────┘   └────────────────┬────────────────┘    │
│   Rule recommendation, NL→SQL, anomaly &      │                    │
│   rule-failure explainability call the same   │                    │
│   gateway directly — no LangGraph involved     │                    │
│                                                 │                    │
│   Rule execution & scoring are pure SQL —     │                    │
│   deliberately no LLM in that path             │                    │
│                                                 ▼                    │
│   ┌───────────────────────────────────────────────────────────┐    │
│   │  Connector registry — BaseConnector interface              │    │
│   │  SQL Server · Snowflake · Databricks · PostgreSQL · DuckDB │    │
│   └───────────────────────────────────────────────────────────┘    │
└───────────────────────────┬────────────────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────────────────┐
│  PostgreSQL (:5432) — metadata store, 36 versioned migrations,    │
│  30 tables. Every table but one is scoped by connection_id;       │
│  connections themselves are scoped by org_id.                     │
└──────────────────────────────────────────────────────────────────┘
```

### On "agents"

Only the **Profiling Agent** (`backend/app/agents/profiling_agent.py`) is a genuine LangGraph `StateGraph` — an 11-node pipeline (`fetch_schema → compute_null_stats → compute_distinct → check_referential_integrity → check_key_duplicates → compute_formats → compute_numerics → detect_duplicates → score_table → identify_risks → generate_summary`) that streams progress to the UI over Server-Sent Events.

`rule_agent.py`, `execution_agent.py`, and `explainability_agent.py` are named `_agent` for consistency but are direct service modules, not graphs:

- **Rule recommendation** (`rule_agent.py`) — the LLM proposes rules or a natural-language→SQL conversion; before either reaches a human reviewer, they pass 7 deterministic static-analysis checks (inverted null checks, uncorrelated `EXISTS`, malformed boolean combinations, unverified table/column references, and more).
- **Execution** (`execution_agent.py`) — runs already-approved rules as parameterized SQL and computes a weighted quality score. **No LLM call anywhere in this path**, by design — the auditable execution path stays fully deterministic.
- **Explainability** (`explainability_agent.py`) — converts anomaly and rule-failure records into plain-English narratives. Every call is logged (model, tokens, cost) to `ai_usage_log`.

Metadata enrichment (AI-suggested column descriptions) and anomaly detection live in `api/metadata.py` and `services/anomaly_service.py` respectively — they call the LLM gateway directly and don't warrant a dedicated agent file.

---

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18 + Babel, browser-transpiled | No bundler, no build step — edit a `.jsx` file, reload the browser |
| Reverse proxy | nginx | `proxy_buffering off` for SSE |
| Backend | Python 3.11 + FastAPI | 12 routers, 94 endpoints, OpenAPI docs auto-generated at `/docs` |
| Agent orchestration | LangGraph | Used for the Profiling Agent's 11-node pipeline only |
| LLM abstraction | LiteLLM | Swap Anthropic ⇄ OpenAI ⇄ Azure OpenAI ⇄ Gemini ⇄ Ollama via `LLM_PROVIDER` — zero code change |
| Model tiering | `LLM_FAST_MODEL` | Optional cheaper/faster model for closed classification tasks (e.g. the simulator's scenario classifier) — falls back to the main model when unset |
| Metadata store | PostgreSQL | 36 versioned migrations, auto-applied at startup |
| Connectors | SQL Server, Snowflake, Databricks, PostgreSQL, DuckDB | Common 5-method `BaseConnector` interface |
| Auth | bcrypt + JWT, or Microsoft Entra ID (OAuth2 + PKCE) | Both paths supported simultaneously |
| Credential storage | Fernet symmetric encryption | Encrypted at rest, decrypted only in-process, never logged or returned by any API |
| Deployment | Docker Compose | `postgres`, `backend`, `frontend` services |

---

## Quick start

### Prerequisites

- Docker Desktop running
- An LLM API key (Anthropic, OpenAI, Azure OpenAI, Gemini) — or a local/self-hosted model via an Ollama + LiteLLM proxy
- A SQL Server / Snowflake / Databricks / PostgreSQL instance to connect (optional — every screen also works against the bundled DuckDB demo data)

### 1. Clone and configure

```bash
git clone <repo-url>
cd "Data Alchemist"
cp .env.example .env
```

Edit `.env`:

```env
# One variable selects the provider for every agent/service in the app —
# no code change, no restart-time config file to keep in sync.
LLM_PROVIDER=anthropic                # anthropic | openai | gemini | azure | ollama

ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL_NAME=claude-sonnet-4-6

# Optional: a cheaper/faster model for closed classification-only calls.
# Must be the same provider as LLM_PROVIDER (shares its API key).
# LLM_FAST_MODEL=claude-haiku-4-5

# Encryption key for stored connector credentials — change this.
ENCRYPTION_KEY=your-32-char-secret-key-here
```

The full provider list (Gemini, OpenAI, Azure, Ollama) with exact variable names is in `.env.example`.

### 2. Start all services

```bash
docker compose up --build
```

Starts three containers: `postgres` (`:5432`), `backend` (`:8000`), `frontend` (`:80`, nginx serving the SPA and proxying `/api/*`).

### 3. Open the app

```
http://localhost
```

Sign in or register, then either attach a real connection through the wizard or use the bundled DuckDB demo connection to explore every screen with real (if synthetic) data.

---

## Connecting to a database

| Platform | Auth types |
|---|---|
| SQL Server | SQL auth, Windows auth, Azure AD |
| Snowflake | Username/password, key pair, OAuth |
| Databricks | Personal access token, OAuth |
| PostgreSQL | Username/password |
| DuckDB | File path or in-memory |

Credentials are Fernet-encrypted before they reach the metadata store. The raw secret is never logged and never returned by any API response.

Adding a new platform means implementing the 5-method `BaseConnector` interface (`test`, `list_schemas`, `list_tables`, `describe_table`, `query`) and registering it in `app/connectors/registry.py` — no changes anywhere in the agent, API, or UI layers.

---

## Project structure

```
Data Alchemist/
├── DataTrust.html                  # SPA entry point — script load order matters here
├── app/                             # Frontend — React/Babel, no build step
│   ├── api.js                       # Fetch wrapper for every /api/* call
│   ├── primitives.jsx                # Shared UI components (Button, Card, Table, ...)
│   ├── shell.jsx                    # App shell, routing, sidebar NAV, context store
│   ├── auth.jsx                     # Login / register / Microsoft SSO
│   ├── screens_home.jsx             # Workspace home — cross-module "needs attention" queue
│   ├── screens_profiling.jsx        # Profiling workspace: run picker, report, risk cards
│   ├── screens_metadata.jsx         # Data dictionary enrichment + CDE promotion
│   ├── screens_rules.jsx            # Rule Studio — recommend, NL→SQL, approve/reject
│   ├── screens_execution.jsx        # DQ execution results, per-layer scores
│   ├── screens_anomalies.jsx        # Anomaly inbox + explainability
│   ├── screens_impact.jsx           # Lineage / downstream impact graph
│   ├── screens_dashboard.jsx        # Trust Dashboard (score, CDE health, AI usage/cost)
│   ├── screens_intel.jsx            # Registers BOTH Pre-run Advisory and Trust Receipt
│   ├── screens_simulator.jsx        # Registers Scenario Simulator, Task Board, Daily Summary
│   └── screens_connections.jsx      # Connection manager
│
├── backend/
│   ├── main.py                      # FastAPI app, router registration, startup migration
│   ├── requirements.txt
│   └── app/
│       ├── agents/
│       │   ├── profiling_agent.py    # The one true LangGraph StateGraph (11 nodes)
│       │   ├── rule_agent.py         # LLM rule recommendation + 7 static-analysis guardrails
│       │   ├── execution_agent.py    # Deterministic rule execution — no LLM
│       │   └── explainability_agent.py  # LLM narratives for anomalies/rule failures
│       ├── api/                     # One FastAPI router per domain (12 total, 94 endpoints)
│       │   ├── connections.py · profiling.py · metadata.py · rules.py
│       │   ├── execution.py · anomalies.py · dashboard.py · tasks.py
│       │   ├── simulation.py · auth.py · intel.py · lineage.py
│       ├── connectors/
│       │   ├── base.py               # Abstract BaseConnector + quote_ident()/table_ref()
│       │   ├── registry.py           # Platform string → connector class factory
│       │   └── sqlserver.py · snowflake.py · databricks.py · postgres.py · duckdb.py
│       ├── core/
│       │   ├── config.py             # pydantic-settings — .env is the single source of config
│       │   ├── llm.py                # LiteLLM wrapper — chat() / stream_chat(), provider routing
│       │   └── metadata_db.py        # SQLAlchemy engine + schema auto-apply at startup
│       ├── models/                   # Pydantic request/response schemas
│       ├── prompts/                  # Versioned YAML prompt templates, one per module
│       └── services/                 # Business logic, no LLM-agent framing needed
│           ├── profiling_service.py    # Per-column stats, sample rows, duplicate/orphan detection
│           ├── anomaly_service.py      # Volume/distribution/segment/freshness detection
│           ├── audit_service.py        # Writes every human decision to audit_trail
│           ├── ai_usage_service.py     # Best-effort LLM call ledger (model, tokens, cost)
│           ├── lineage_discovery.py    # FK + query-log based edge inference
│           ├── lineage_narrative.py    # AI downstream-impact narratives
│           └── simulation_classify.py  # LLM classification for the scenario simulator
│
├── backend/db/schemas/*.sql          # 36 numbered, auto-applied migrations
├── llm_config.yaml                   # Legacy config path — .env / LLM_PROVIDER is authoritative
├── .env.example
└── docker-compose.yml                # postgres + backend + frontend (nginx)
```

---

## API reference

All routes are prefixed with `/api`. Full interactive docs (all 94 endpoints, with request/response schemas) are always available at `http://localhost:8000/docs`. The table below covers the routes you'll touch most often — it is not exhaustive.

| Method | Path | Description |
|---|---|---|
| GET/POST | `/connections` | List / create a connection |
| POST | `/connections/{id}/test` | Test connectivity for a saved connection |
| GET | `/profiling/datasets` | List tables available to profile |
| POST | `/profiling/run` | Run the profiling agent (SSE stream) — full or windowed scan |
| GET | `/profiling/report/by-table/{table_fqn}` | Latest persisted report for a table |
| POST | `/profiling/risks/{risk_id}/suppress` | Human suppresses a flagged risk |
| GET | `/metadata/dictionary` | List data dictionary entries |
| POST | `/metadata/dictionary/{id}/{decision}` | Steward approves/edits/rejects an AI suggestion |
| GET | `/rules` | List DQ rules |
| POST | `/rules/nl` | Convert natural language to a DQ rule |
| POST | `/rules/recommend` | AI rule recommendations from the latest profiling report |
| PATCH | `/rules/{id}` | Approve / edit / reject / retire a rule |
| POST | `/execution/run` | Execute all active rules for a connection/layer/table |
| GET | `/anomalies/inbox` | Open anomalies for a connection |
| POST | `/anomalies/{id}/explain` | Generate an AI root-cause explanation |
| GET | `/dashboard/summary` | Trust score and headline KPIs |
| GET | `/dashboard/ai-usage` | AI usage/cost ledger — real numbers, not an estimate |
| POST | `/simulation/inject` | Inject a sandboxed what-if scenario |
| GET/POST/PATCH | `/tasks` | Task board CRUD |

---

## Data model

30 tables across 36 versioned migrations (`backend/db/schemas/*.sql`, applied automatically at startup, in order). Two tenancy boundaries exist:

- **`org_id`** on `connections`, `users`, and `audit_trail` — the outer tenant boundary.
- **`connection_id`** — the inner scope. 28 of 29 satellite tables carry it as a foreign key (the sole exception is `simulation_scenarios`, a shared built-in library, not per-connection data).

Key tables by area: `profiling_reports` / `column_stats` / `profiling_risks` (profiling), `dq_rules` / `dq_run_results` / `dq_runs` / `rule_ai_calls` (rules & execution), `anomaly_log` / `anomaly_fingerprints` / `anomaly_thresholds` / `trust_score_history` (anomalies & trust), `lineage_nodes` / `lineage_edges` / `lineage_column_edges` (lineage), `simulation_scenarios` / `simulation_runs` (simulator), `intel_advisories` / `intel_receipts` (pre-run intelligence), `data_dictionary` / `cde_registry` / `audit_trail` / `task_board` / `ai_usage_log` (governance).

---

## Live Scenario Simulator

Type a data incident in plain English:

> *"Nightly OMS feed 3 hours late, half the rows loaded"*
> *"email column in customers 40% NULL after the CRM change"*
> *"Northeast region went to zero in fact_sales"*

The simulator classifies the scenario (5 built-in types, with an honest "unknown" path that LLM-synthesizes a grounded label rather than force-fitting a wrong category), streams a detection timeline over SSE, and generates a business-readable narrative grounded in the connection's real profiling and lineage data.

**Sandbox guarantee:** the simulator never writes to shared or real tables (`anomaly_log`, `trust_score_history`) or mutates global app state — every run is scoped to local component state and its own `simulation_runs` row.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `LLM_PROVIDER` | Yes | `anthropic` \| `openai` \| `gemini` \| `azure` \| `ollama` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `AZURE_API_KEY` | One of these | Matching the selected provider |
| `AZURE_API_BASE` | If `azure` | Azure OpenAI endpoint URL |
| `LLM_FAST_MODEL` | No | Cheaper/faster model for classification-only calls; same provider as `LLM_PROVIDER` |
| `ENCRYPTION_KEY` | Yes | Exactly 32 characters — encrypts stored connector credentials |
| `DATABASE_URL` | No | PostgreSQL DSN (defaults to the Docker Compose `postgres` service) |
| `SLACK_WEBHOOK_URL` | No | Slack webhook for critical alerts |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` | No | Enables Microsoft Entra ID SSO |
| `AZURE_REDIRECT_URI` | No | OAuth redirect URI (default `http://localhost`) |
| `AZURE_DOMAIN_HINT` | No | Pre-selects a tenant on the Microsoft login page |
| `APP_ENV` | No | `development` / `production` |
| `LOG_LEVEL` | No | `INFO` / `DEBUG` / `WARNING` |

---

## Medallion architecture support

Profiling, rules, anomalies, and trust scores are all tracked per layer:

```
RAW → BRONZE → SILVER → GOLD
```

Layer is resolved from the connection's `layer_map` config, falling back to a schema-name heuristic (e.g. `raw_orders` → `RAW`) when unset. The execution results page shows per-layer quality scores side by side.

---

## Human-in-the-loop design

Every AI output requires an explicit human action before it changes anything — 7+ distinct decision gates across the platform:

- **Rule Studio** — approve / edit / reject / retire an AI-recommended or NL-converted rule
- **Metadata dictionary** — approve / edit / reject an AI-suggested column description; bulk-decide
- **Profiling risks** — suppress / unsuppress / add a note to a flagged risk
- **Anomaly inbox** — acknowledge with a note; generate an explanation on demand, not automatically
- **Impact Graph** — approve / reject an AI-suggested lineage edge
- **Task Board** — every human decision above can spawn a task, tracked to completion

Every one of these writes to the immutable `audit_trail` table with before/after value snapshots.

---

## Microsoft SSO setup (pal.tech)

Data Alchemist supports single sign-on via Microsoft Entra ID using OAuth2 Authorization Code + PKCE — no client secret in the browser.

### 1. Register the app in Azure Portal

1. [portal.azure.com](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → **New registration**
2. Name: `Data Alchemist`. Supported account types: this organization only. Redirect URI: platform = **Single-page application (SPA)**, URI = `http://localhost`.
3. From the **Overview** page, copy **Application (client) ID** → `AZURE_CLIENT_ID` and **Directory (tenant) ID** → `AZURE_TENANT_ID`.

### 2. Configure API permissions

**API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated**: `openid`, `profile`, `email`, `User.Read`. Grant admin consent.

### 3. Set environment variables

```env
AZURE_TENANT_ID=<tenant GUID>
AZURE_CLIENT_ID=<client ID>
AZURE_REDIRECT_URI=http://localhost
AZURE_DOMAIN_HINT=pal.tech
```

### How it works

Browser generates a PKCE `code_verifier`/`code_challenge` → redirects to `login.microsoftonline.com` with `domain_hint` pre-selecting the tenant → Microsoft redirects back with `?code=…` → frontend calls `POST /api/auth/microsoft/token` with the code + verifier → backend exchanges for an `id_token`, decodes it, returns `{name, email}`.

When `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` are unset, the SSO button is hidden and local email/password auth is the only path.

---

## Troubleshooting

**Backend won't start** — check `.env` has `ENCRYPTION_KEY` set to exactly 32 characters; confirm the `postgres` container is healthy with `docker compose ps`.

**"No module named pyodbc"** — the SQL Server ODBC driver must be present in the image; ensure you built with `docker compose up --build` (not a cached image).

**LLM errors / 401** — verify `LLM_PROVIDER` matches the API key you actually set (e.g. `LLM_PROVIDER=anthropic` needs `ANTHROPIC_API_KEY`). For Ollama, confirm the LiteLLM proxy is reachable at `OLLAMA_BASE_URL` and the model is registered there.

**SSE stream not working** — confirm `proxy_buffering off` is set in `nginx.conf` (it is, by default); the SPA uses `fetch` + `ReadableStream`, which works in all modern browsers.

**A windowed profiling scan on a quiet table** — this is expected to return zero rows and a 100% score for that window; it does not mean the table itself is empty. The AI summary is written to say so explicitly.

---

## Current capabilities

- Agentic profiling (LangGraph, 11 checks per run): nulls, whole-row and key-based duplicates, referential orphans, schema drift against the prior run, format and numeric distribution — plus partition-aware/incremental scans (last 24h/7d/30d, since-last-run, or a custom window)
- AI-recommended and natural-language-authored DQ rules, gated by 7 static-analysis checks and human approval before activation
- Deterministic rule execution and per-layer weighted scoring — no LLM in that path
- Volume / distribution / segment / freshness anomaly detection with AI root-cause narratives and a recurring-incident fingerprint library
- Downstream impact graph with declared-FK and query-log-inferred lineage, at table and column granularity
- Trust Dashboard with score trend, CDE health, and a real AI usage/cost transparency panel (not an estimate — every call is logged)
- Pre-run advisory (predicted trust score before a pipeline runs) and a per-query Trust Receipt
- Sandboxed scenario simulator for "what if" incident rehearsal, isolated from all real scores/inbox/history
- Task board with full lifecycle tracking, auto-linked back to the rule/anomaly/CDE that created it
- Full audit trail of every human decision, with before/after value snapshots
- LLM provider swap (Anthropic / OpenAI / Azure OpenAI / Gemini / local Ollama) via one environment variable, zero code change
- Two-tier tenancy (`org_id` over `connection_id`) verified across 28 of 29 satellite tables
- Five live database connectors behind one `BaseConnector` interface — SQL Server, Snowflake, Databricks, PostgreSQL, DuckDB

### Where to look, by evaluation dimension

| Dimension | Where to look |
|---|---|
| Working solution maturity | Run the full flow on a live connection — nothing is mocked once a connection is attached |
| AI application quality | Trust Dashboard → AI usage & cost panel; Rule Studio → generate a rule and see the 7 guardrail checks reject a bad one |
| Reusability & accelerator potential | `app/connectors/` — add a platform in 5 methods; `app/prompts/*.yaml` — every prompt is versioned independent of code |
| Demo & storytelling | Simulator → any scenario → Daily Summary — one incident flows through detection, explanation, and an AI-written recap |
| Feasibility & scalability | `docker compose up --build` is the entire deployment; the connector pattern and two-tier tenancy are already enterprise-shaped |
