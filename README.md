# Data Alchemist — Agentic Data Quality & Trust Platform

> *Move enterprise data quality from reactive checks to proactive, agentic trust.*

Built for the **Agentic Data Quality and Trust Solution** innovation challenge. Data Alchemist is a fully agentic, workflow-driven DQ platform that profiles data, enriches metadata, recommends rules, detects anomalies, and explains issues in business language — with humans in control at every step.

---

## Demo Flow (End-to-End Story)

| Step | Screen | What it shows |
|------|--------|---------------|
| 1 | Connect | Register a SQL Server / Snowflake / Databricks connection via the wizard |
| 2 | Profiling | Agentic profiling streams live progress over SSE → risk report with scores |
| 3 | Metadata | AI-generated business descriptions; promote columns to CDEs |
| 4 | Rule Studio | NL → DQ rule conversion; approve / edit / reject recommendations |
| 5 | Execution | Run all active rules; view per-layer scores and failed records |
| 6 | Anomaly Inbox | Volume / segment / source / distribution anomalies with business explanation |
| 7 | Impact Graph | Downstream cascade — one NULL column traced to every dashboard and ML model |
| 8 | Trust Dashboard | Executive / Technical / Governance tabs with trend lines and CDE health |
| 9 | Pre-run Advisory | Predict today's trust score *before* the pipeline runs |
| 10 | Simulator | **Live scenario demo** — type any issue, system classifies, injects, detects, explains in < 90 s |
| 11 | Task Board | Human-in-the-loop task tracking across all phases |
| 12 | Daily Summary | One-page data trust summary: score, top issues, decisions, recommendations |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (port 80)                       │
│         React / Babel SPA  ·  14 screens  ·  no build step  │
└────────────────────┬────────────────────────────────────────┘
                     │  /api/* (proxied by nginx)
┌────────────────────▼────────────────────────────────────────┐
│              FastAPI backend  (port 8000)                    │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  LangGraph   │  │   LiteLLM    │  │   APScheduler    │  │
│  │   Agents     │  │  (any LLM)   │  │  (monitoring)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                 │                                  │
│  ┌──────▼─────────────────▼──────────────────────────────┐  │
│  │           Connector Registry                          │  │
│  │  SQL Server · Snowflake · Databricks · Postgres · DuckDB  │
│  └───────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│              PostgreSQL  (port 5432)                        │
│              Metadata store — connections, rules,           │
│              profiling reports, audit trail, CDEs           │
└─────────────────────────────────────────────────────────────┘
```

### Agent pipeline (LangGraph)

```
Profiling Agent  →  Metadata Agent  →  Rule Agent  →  Execution Agent
                                                              ↓
                         Explainability Agent  ←  Anomaly Agent
```

Each agent is a stateful LangGraph graph. Real-time progress streams to the UI via **Server-Sent Events (SSE)**.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Babel (browser-transpiled, no build step) |
| Backend | Python 3.11 + FastAPI |
| Agent orchestration | LangGraph |
| LLM abstraction | **LiteLLM** — swap Claude → GPT-4o → Gemini → Ollama via one config line |
| Default LLM | `claude-sonnet-4-6` |
| Connectors | SQL Server (pyodbc), Snowflake, Databricks, PostgreSQL, DuckDB |
| Metadata store | PostgreSQL (Docker) |
| Real-time streaming | Server-Sent Events |
| Scheduler | APScheduler |
| Credential encryption | Fernet (AES-128) |
| Deployment | Docker Compose |

---

## Quick Start

### Prerequisites

- Docker Desktop running
- An LLM API key (Anthropic, OpenAI, Azure, or a local Ollama instance)
- A SQL Server / Snowflake / Databricks / PostgreSQL instance to connect (optional — the UI runs on mock data without one)

### 1. Clone and configure

```bash
git clone <repo-url>
cd "Data Alchemist"
cp .env.example .env
```

Edit `.env`:

```env
# Set LLM_PROVIDER to pick the model — no code or yaml change needed, and
# NO restart-time config file to keep in sync. One env var switches every
# agent (profiling, rules, anomaly explain, simulator, advisory, receipt).
LLM_PROVIDER=anthropic                # anthropic | openai | gemini | azure | ollama

ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL_NAME=claude-sonnet-4-6

# Or point LLM_PROVIDER=ollama at a local/open-weight model via a LiteLLM
# proxy — zero per-token cost, same code path, same prompts. This is how the
# reference deployment runs day-to-day (see AI Usage & Cost panel below).
# OLLAMA_BASE_URL=http://localhost:3300
# OLLAMA_MODEL=qwen3.5:27b

# Encryption key for stored connector credentials (change this)
ENCRYPTION_KEY=your-32-char-secret-key-here
```

Full provider list (Gemini, OpenAI, Azure) with the exact variable names is in `.env.example` — copy it and uncomment the block for your provider.

### 2. Start all services

```bash
docker compose up --build
```

Opens three containers:
- `postgres` — metadata store (`:5432`)
- `backend` — FastAPI with all agents (`:8000`)
- `frontend` — nginx serving the SPA (`:80`)

### 3. Open the app

```
http://localhost
```

The connect wizard launches automatically. Enter your database credentials to go live, or click **Skip** to explore with built-in demo data.

---

## Connecting to a Database

The connection wizard supports:

| Platform | Auth types |
|----------|-----------|
| **SQL Server** | SQL Server Auth (username/password), Windows Auth, Azure AD |
| Snowflake | Username/password, Key pair, OAuth 2.0 |
| Databricks | Personal Access Token, OAuth |
| PostgreSQL | Username/password |
| DuckDB | File path or in-memory |

Credentials are encrypted with Fernet before storage. The raw password is never logged or returned by the API.

---

## Project Structure

```
Data Alchemist/
├── DataTrust.html              # SPA entry point
├── app/                        # Frontend (React/Babel, 14 screens)
│   ├── api.js                  # Fetch wrapper for all API calls
│   ├── data.js                 # Mock data (fallback when no backend)
│   ├── shell.jsx               # App shell, routing, context store
│   ├── auth.jsx                # Connect wizard
│   ├── primitives.jsx          # Shared UI components
│   ├── screens_home.jsx        # Workspace home / KPI dashboard
│   ├── screens_profiling.jsx   # Agentic profiling + SSE progress
│   ├── screens_metadata.jsx    # Data dictionary enrichment + CDEs
│   ├── screens_rules.jsx       # Rule Studio + NL→DQ converter
│   ├── screens_execution.jsx   # DQ execution results
│   ├── screens_anomalies.jsx   # Anomaly inbox + explainability
│   ├── screens_impact.jsx      # Downstream impact graph
│   ├── screens_dashboard.jsx   # Trust dashboard (Exec/Tech/Governance)
│   ├── screens_intel.jsx       # Pre-run advisory + trust receipt
│   ├── screens_simulator.jsx   # Live scenario simulator + task board
│   └── screens_connections.jsx # Connection manager
│
├── backend/
│   ├── main.py                 # FastAPI app, router registration
│   ├── requirements.txt
│   └── app/
│       ├── agents/             # LangGraph agent graphs
│       │   ├── profiling_agent.py
│       │   ├── rule_agent.py
│       │   ├── execution_agent.py
│       │   ├── anomaly_agent.py (via anomaly_service)
│       │   └── explainability_agent.py
│       ├── api/                # FastAPI routers (one per domain)
│       │   ├── connections.py  · profiling.py  · metadata.py
│       │   ├── rules.py        · execution.py  · anomalies.py
│       │   ├── dashboard.py    · tasks.py       · simulation.py
│       ├── connectors/         # Pluggable data platform connectors
│       │   ├── base.py         # Abstract BaseConnector
│       │   ├── registry.py     # ConnectorRegistry factory
│       │   ├── sqlserver.py    · snowflake.py · databricks.py
│       │   └── postgres.py     · duckdb.py
│       ├── core/
│       │   ├── config.py       # pydantic-settings + llm_config.yaml loader
│       │   ├── llm.py          # LiteLLM wrapper (chat / stream)
│       │   └── metadata_db.py  # SQLAlchemy engine + schema auto-apply
│       ├── models/             # Pydantic request/response models
│       └── services/           # Business logic (profiling, anomaly, scoring, audit)
│
├── llm_config.yaml             # LLM provider + model config
├── .env.example                # Environment variable template
└── docker-compose.yml          # postgres + backend + frontend (nginx)
```

---

## API Reference

All routes are prefixed with `/api`. Full interactive docs at `http://localhost:8000/docs`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/connections` | List saved connections |
| POST | `/connections` | Create and save a connection |
| POST | `/connections/test` | Test credentials without saving |
| DELETE | `/connections/{id}` | Remove a connection |
| GET | `/profiling/datasets` | List tables for a connection |
| POST | `/profiling/run` | Run profiling agent (SSE stream) |
| GET | `/metadata/dictionary` | List data dictionary entries |
| POST | `/metadata/dictionary/{id}/approve` | Approve a column description |
| GET | `/metadata/cdes` | List Critical Data Elements |
| GET | `/rules` | List DQ rules |
| POST | `/rules/nl` | Convert natural language to a DQ rule |
| POST | `/rules/recommend` | AI rule recommendations from profiling |
| PATCH | `/rules/{id}` | Approve / edit / reject a rule |
| POST | `/execution/run` | Execute all active rules |
| GET | `/execution/results/{run_id}` | Get execution results |
| GET | `/anomalies/inbox` | Open anomalies |
| POST | `/anomalies/{id}/acknowledge` | Acknowledge and suppress |
| POST | `/anomalies/{id}/explain` | Generate business explanation |
| GET | `/dashboard/summary` | Overall trust score + layer health |
| GET | `/dashboard/trends` | 14-day trust score history |
| GET | `/dashboard/cdes` | CDE health status |
| POST | `/simulation/inject` | Inject a scenario and stream detection events (SSE) |
| GET | `/simulation/scenarios` | List available scenario templates |
| GET/POST/PATCH | `/tasks` | Human task board CRUD |

---

## Live Scenario Simulation

The **Live Scenario Simulator** is the centrepiece demo feature. Type any data issue in plain English:

> *"revenue is not loading for today's orders"*
> *"order volume dropped overnight by 60%"*
> *"Northeast region stops sending data entirely"*
> *"ghost status codes appearing in silver layer"*
> *"CRM feed hasn't arrived"*

The system:
1. Classifies the scenario into one of 5 issue types
2. Streams a real-time detection timeline via SSE from the backend
3. Drops the trust score progressively as each failure is detected
4. Generates a business-readable alert with root cause, impact, and recommended actions
5. Animates trust score recovery after remediation is applied

Works end-to-end with the backend connected, or falls back to local animation in demo mode.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key (`*` one LLM key required) |
| `OPENAI_API_KEY` | Yes* | OpenAI API key |
| `AZURE_API_KEY` | Yes* | Azure OpenAI key |
| `AZURE_API_BASE` | — | Azure endpoint URL |
| `ENCRYPTION_KEY` | Yes | 32-char key for credential encryption |
| `DATABASE_URL` | — | PostgreSQL DSN (default: Docker Compose postgres) |
| `LLM_PROVIDER` | — | `anthropic` \| `openai` \| `gemini` \| `azure` \| `ollama` — switches every agent's model with zero code change |
| `SLACK_WEBHOOK_URL` | — | Slack webhook for CRITICAL alerts |
| `AZURE_TENANT_ID` | — | pal.tech Azure AD tenant GUID (enables SSO) |
| `AZURE_CLIENT_ID` | — | App Registration client ID (enables SSO) |
| `AZURE_REDIRECT_URI` | — | OAuth redirect URI (default: `http://localhost`) |
| `AZURE_DOMAIN_HINT` | — | Pre-selects tenant in Microsoft login (default: `pal.tech`) |
| `APP_ENV` | — | `development` / `production` |
| `LOG_LEVEL` | — | `INFO` / `DEBUG` / `WARNING` |

---

## Medallion Architecture Support

Data Alchemist operates natively across all four Medallion layers:

```
RAW  →  BRONZE  →  SILVER  →  GOLD
```

Rules, profiling reports, anomalies, and trust scores are all tracked per layer. The execution results page shows per-layer quality scores side-by-side.

---

## Human-in-the-Loop Design

Every AI suggestion requires explicit human action before it takes effect:

- **Metadata agent** generates descriptions → steward approves / edits / rejects each column
- **Rule agent** recommends rules → engineer approves / edits / snoozes / rejects each rule
- **NL → DQ conversion** generates a rule expression → engineer reviews before saving
- **Anomaly explainability** generates a business narrative → steward accepts, edits, or escalates
- **Pre-run advisory** predicts risk → engineer decides to hold, proceed, or alert the owner
- **Task board** captures all human decisions with a full audit trail

---

## Microsoft SSO Setup (pal.tech)

Data Alchemist supports single sign-on via **Microsoft Entra ID** for `@pal.tech` accounts using OAuth2 PKCE (no client secret needed in the browser).

### Step 1 — Register the app in Azure Portal

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → **New registration**
2. Set:
   - **Name**: `Data Alchemist`
   - **Supported account types**: `Accounts in this organizational directory only (pal.tech only)`
   - **Redirect URI**: Platform = `Single-page application (SPA)`, URI = `http://localhost` (add `http://localhost:80` if needed)
3. Click **Register**
4. On the app's **Overview** page, copy:
   - **Application (client) ID** → `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → `AZURE_TENANT_ID`

### Step 2 — Configure API permissions

In the app registration → **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated**:
- `openid`, `profile`, `email`, `User.Read`

Click **Grant admin consent**.

### Step 3 — Set environment variables

In `.env`:
```
AZURE_TENANT_ID=<paste tenant GUID>
AZURE_CLIENT_ID=<paste client ID>
AZURE_REDIRECT_URI=http://localhost
AZURE_DOMAIN_HINT=pal.tech
```

### How it works

When SSO is configured, clicking **Continue with Microsoft (pal.tech)** on the login page:
1. Browser generates a PKCE `code_verifier` and `code_challenge` (SHA-256, no client secret)
2. Redirects to `login.microsoftonline.com` with `domain_hint=pal.tech` (pre-selects pal.tech tenant)
3. After authentication, Microsoft redirects back with `?code=…`
4. Frontend calls `POST /api/auth/microsoft/token` with the code + verifier
5. Backend exchanges for an `id_token`, decodes the JWT, returns `{name, email}`
6. User lands in the platform

When `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` are not set, the button falls back to **demo mode** (instant login with `demo@pal.tech`).

---

## Troubleshooting

**Backend won't start**
- Check `.env` has `ENCRYPTION_KEY` set to exactly 32 characters
- Ensure PostgreSQL container is healthy: `docker compose ps`

**"No module named pyodbc"**
- The SQL Server ODBC driver must be installed in the Docker image. The `backend/Dockerfile` installs `msodbcsql18` during build.

**LLM errors / 401**
- Verify `LLM_PROVIDER` in `.env` matches the API key you actually set (e.g. `LLM_PROVIDER=anthropic` needs `ANTHROPIC_API_KEY`)
- For Ollama: ensure the LiteLLM proxy is reachable at `OLLAMA_BASE_URL` and the model is registered there

**Frontend shows mock data only**
- Normal behaviour when no backend is running — all screens initialise from `window.DT` demo data and try the API on mount
- Open browser devtools → Network tab to check if `/api/*` calls are reaching the backend

**SSE stream not working**
- Ensure nginx `proxy_buffering off` is set in `nginx.conf` (already configured)
- Safari requires `EventSource`; the SPA uses `fetch` + `ReadableStream` for SSE, which works in all modern browsers

---

## Innovation Challenge Checklist

- [x] Agentic profiling with LangGraph — not a static query
- [x] AI-generated data dictionary enrichment
- [x] CDE identification and promotion workflow
- [x] NL → DQ rule conversion (LiteLLM)
- [x] Human-in-the-loop validation at every stage
- [x] DQ execution with per-layer scoring + AI-generated remediation suggestions per failure
- [x] Multi-level anomaly detection (volume, segment, source, distribution) + institutional-memory fingerprint library
- [x] Business-language explainability (LiteLLM)
- [x] Downstream impact cascade graph — interactive, dbt-style, with column-level lineage and JSON edit/export
- [x] Executive + Technical + Governance trust dashboards
- [x] Pre-run advisory — auto-generated from live signals (failures, volume drift, day-of-week anomaly patterns, past-incident fingerprints), not a static prediction
- [x] Data trust receipt — per-table, per-column "can I use this right now" verdict generated on demand
- [x] Workspace Home "needs your attention" queue — ranked, cross-module triage (anomalies + failing rules + overdue tasks) in one place
- [x] Task board — full lifecycle (status/priority/owner/due-date/delete), auto-linked back to the anomaly that created it
- [x] Daily summary — AI-written end-of-day narrative grounded in that day's measured facts, cached once per day
- [x] **AI usage & cost transparency panel** — every LLM call's tokens, latency, estimated cost, and AI-vs-fallback rate, aggregated on the Governance tab (not just backend logs)
- [x] **Live scenario simulation** — type any issue, system reacts in real time, sandboxed (never touches real scores/inbox/history)
- [x] Full audit trail of every human decision
- [x] Configurable LLM via `LLM_PROVIDER` in `.env` (Claude / GPT-4o / Gemini / Azure / local Ollama — zero code change, runs at $0/token on local models)
- [x] Docker Compose single-command deployment
- [x] SQL Server as primary connector + Snowflake / Databricks / PostgreSQL / DuckDB
- [x] Multi-tenant from the schema up — every connection, rule, and audit row is org-scoped (`org_id`), not a single-tenant demo hack

### Rubric alignment (for reviewers)

| Judging dimension | Where to look |
|---|---|
| Working Solution Maturity | Run the full demo flow above end-to-end on a live connection — nothing is mocked once a connection is attached |
| AI Application Quality | Trust Dashboard → Governance tab → **AI usage & cost transparency** — real token/latency/fallback-rate numbers, not a claim |
| Reusability & Accelerator Potential | `app/connectors/` — add a platform by implementing 5 abstract methods; `app/prompts/*.yaml` — every prompt is versioned and swappable independent of code |
| Demo & Storytelling Quality | Simulator → any scenario → Daily Summary — the same incident flows through detection, explanation, and an AI-written recap automatically |
| Innovation & Differentiation | Impact Graph blast-radius diagrams inside the Simulator, anomaly fingerprint institutional memory, and the Trust Receipt "nutrition label" |
| Feasibility & Scalability | `docker-compose up --build` is the entire deployment; connector pattern and org-scoping are already enterprise-shaped, not retrofitted |
