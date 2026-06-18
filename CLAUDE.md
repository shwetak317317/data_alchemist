# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Quick Start

**Data Alchemist** is an agentic data quality and trust platform. It consists of:
- **Frontend**: React 18 + Babel (browser-transpiled SPA, no build step)
- **Backend**: Python 3.11 + FastAPI with LangGraph agents
- **Metadata DB**: PostgreSQL (Docker)
- **LLM**: LiteLLM (swappable: Claude, GPT-4o, Gemini, Ollama)

### Run Everything
```bash
docker compose up --build
```
Opens:
- Frontend: http://localhost (nginx reverse proxy on port 80)
- Backend API: http://localhost:8000/docs (interactive Swagger)
- PostgreSQL: localhost:5432

### Key Configuration
- `.env` — LLM API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, AZURE_API_KEY), encryption key, database credentials
- `llm_config.yaml` — LLM provider and model selection (no code changes needed to swap models)
- `backend/requirements.txt` — Python dependencies
- `docker-compose.yml` — service orchestration (postgres, backend, frontend)

### Stopping Services
```bash
docker compose down
```

---

## Architecture

### High-Level Flow

```
Browser (React SPA)
    ↓
nginx (reverse proxy, port 80)
    ↓
FastAPI backend (port 8000)
    ↓ SSE streams for long-running agents
    ├─ LangGraph agents (profiling, rules, execution, anomaly, explainability)
    ├─ LiteLLM (abstraction for Claude/GPT/Gemini/Ollama)
    └─ Connector registry (SQL Server, Snowflake, Databricks, Postgres, DuckDB)
    ↓
PostgreSQL (port 5432) — stores connections, rules, reports, audit trail
```

### Frontend Architecture

**Single-page app (14 screens), no build step** — React JSX code is transpiled in the browser by Babel:

1. **DataTrust.html** — Entry point; imports scripts in order:
   - Lucide icons, React 18, Babel
   - `app/api.js` — thin fetch wrapper for all `/api/*` calls
   - `app/primitives.jsx` — shared UI components (Button, Card, Input, Table, etc.)
   - `app/auth.jsx` — login/register screens
   - 14 `screens_*.jsx` files — one per workflow screen
   - `app/shell.jsx` — app shell, routing, sidebar, context store

2. **State management**: React Context (window.DTContext) holds:
   - Current route, active connection, user info
   - All navigation happens via `go(screenId)` function

3. **API communication**: `window.DTApi` exposes all backend calls:
   - `listConnections()`, `testConnection()`, `createConnection()`
   - `streamProfiling({connectionId, schemaName, tableName, onProgress, onReport, onError})` — SSE
   - `listRules()`, `recommendRules()`, `nlToRule()`
   - etc. (see `app/api.js`)

4. **Demo mode fallback**: When backend is unavailable, all screens render with mock data from `app/data.js`. Useful for UI development without running Docker.

### Backend Architecture

**FastAPI app with LangGraph agents, pluggable connectors, and encrypted credential storage.**

```
backend/
├── main.py                          # App entry point, router registration, lifespan
├── app/
│   ├── agents/
│   │   ├── profiling_agent.py       # LangGraph: fetch schema → compute stats → score
│   │   ├── rule_agent.py            # LangGraph: recommend DQ rules from profiling
│   │   ├── execution_agent.py       # LangGraph: run all active rules, compute scores
│   │   ├── anomaly_agent.py         # (via anomaly_service) detect volume/distribution anomalies
│   │   └── explainability_agent.py  # (via service) generate business-language explanations
│   ├── api/                         # FastAPI routers, one per domain
│   │   ├── connections.py           # POST /api/connections, GET, DELETE, PATCH, test
│   │   ├── profiling.py             # POST /api/profiling/run (SSE), GET /profiling/report/*
│   │   ├── metadata.py              # GET/POST data dictionary, CDE management
│   │   ├── rules.py                 # GET/POST/PATCH DQ rules, NL→rule conversion
│   │   ├── execution.py             # POST /api/execution/run, GET results
│   │   ├── anomalies.py             # GET /api/anomalies/inbox, POST explain
│   │   ├── dashboard.py             # GET summary, trends, CDE health
│   │   ├── tasks.py                 # Task board CRUD
│   │   ├── simulation.py            # POST /api/simulation/inject (SSE)
│   │   ├── intel.py                 # GET advisory, receipt
│   │   ├── lineage.py               # GET downstream impact
│   │   └── auth.py                  # Login, register, Microsoft SSO
│   ├── connectors/
│   │   ├── base.py                  # BaseConnector abstract interface
│   │   ├── registry.py              # get_connector(platform, config) factory
│   │   ├── sqlserver.py, snowflake.py, databricks.py, postgres.py, duckdb.py
│   ├── core/
│   │   ├── config.py                # Settings (from .env + llm_config.yaml)
│   │   ├── llm.py                   # LiteLLM chat() / stream_chat() wrappers
│   │   └── metadata_db.py           # SQLAlchemy engine, schema auto-apply at startup
│   ├── models/                      # Pydantic request/response schemas
│   ├── services/                    # Business logic (profiling, anomaly, audit)
│   └── db/schemas/                  # 18 SQL files auto-applied at startup
├── requirements.txt
├── Dockerfile
└── llm_config.yaml
```
### Workflow
1. Login


### Connector Pattern

All connectors implement `BaseConnector` (in `app/connectors/base.py`):

```python
class BaseConnector(ABC):
    def test(self) -> bool: ...              # Health check
    def list_schemas(self) -> list[str]: ...
    def list_tables(self, schema: str) -> list[TableSchema]: ...
    def describe_table(self, schema: str, table: str) -> TableSchema: ...
    def query(self, sql: str, params=None) -> QueryResult: ...
```

Factory usage:
```python
from app.connectors.registry import get_connector
connector = get_connector("snowflake", {"account": "...", "user": "..."})
result = connector.query("SELECT * FROM table LIMIT 10")
```

### Agent Pattern (LangGraph)

Each agent is a stateful StateGraph that emits progress events via SSE. Example: **Profiling Agent**

```
fetch_schema → compute_null_stats → compute_distinct → compute_formats
→ compute_numerics → detect_duplicates → score_table → identify_risks
→ generate_summary
```

Each node:
1. Receives the current state (dict with connection, schema, table, connector, progress events)
2. Performs one step of work
3. Returns updated state
4. Emits a `ProfilingProgressEvent` for the frontend to display

Frontend streams via SSE:
```javascript
streamProfiling({
  connectionId: "...",
  schemaName: "...",
  tableName: "...",
  onProgress: (event) => updateProgressBar(event),
  onReport: (report) => displayReport(report),
  onError: (msg) => showError(msg),
})
```

### LLM Abstraction (LiteLLM)

All agents use the `app.core.llm` module:

```python
from app.core.llm import chat, stream_chat

# Synchronous
response = chat([
    {"role": "system", "content": "You are a data quality expert."},
    {"role": "user", "content": "Recommend rules for this table..."}
])

# Streaming
for chunk in stream_chat(messages, temperature=0.1):
    print(chunk, end="", flush=True)
```

**Model is swapped via `llm_config.yaml`** — no code changes:

```yaml
model: claude-sonnet-4-6        # or: gpt-4o, gemini/gemini-1.5-pro, ollama/mistral
max_tokens: 4096
temperature: 0.1
api_key_env: ANTHROPIC_API_KEY  # Which env var holds the API key
```

If `api_key_env` is not set, the code falls back to checking provider-specific keys in order.

### Metadata Database

18 SQL schemas auto-applied at startup (`backend/app/core/metadata_db.py`):

| Schema | Purpose |
|--------|---------|
| `connections` | Data platform credentials (Fernet-encrypted) |
| `data_dictionary` | Column metadata + business descriptions |
| `dq_rules` | DQ rules (status, approval, SLA) |
| `dq_run_results` | Per-rule execution logs |
| `anomaly_log` | Volume, segment, distribution anomalies |
| `audit_trail` | All human decisions (approvals, rejections) |
| `profiling_reports` | Cached reports with scores + column stats |
| `task_board` | Human tasks (actions needed per anomaly) |
| `users` | Login credentials (bcrypt) |
| `column_stats`, `cde_registry`, `dq_runs`, `trust_history`, `lineage`, `simulation`, `intel` | Supporting tables |

---

## Common Commands

### Backend Development (Python)

**Run backend locally** (without Docker):
```bash
cd backend
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...  # or your LLM key
export ENCRYPTION_KEY=change-me-32-chars-secret-key-here
python -m uvicorn main:app --reload --port 8000
```
(Requires PostgreSQL running on localhost:5432 or set DATABASE_URL env var)

**Add a new connector**:
1. Create `backend/app/connectors/myplatform.py` extending `BaseConnector`
2. Implement all 5 abstract methods
3. Register in `backend/app/connectors/registry.py` — add to `_REGISTRY` dict
4. Test via `POST /api/connections/test` with platform="myplatform"

**Add a new API route**:
1. Create `backend/app/api/myroute.py` with a router:
   ```python
   from fastapi import APIRouter
   router = APIRouter(prefix="/api/myroute", tags=["myroute"])
   @router.get("/endpoint")
   def my_endpoint(): ...
   ```
2. Register in `backend/main.py` — `app.include_router(myroute.router)`
3. Docs auto-update at http://localhost:8000/docs

**Add a new LangGraph agent**:
1. Define a `TypedDict` state schema (see `profiling_agent.py` for pattern)
2. Create node functions that take state and return updated state
3. Build a `StateGraph`, add nodes, add edges, compile to `.compile()`
4. Call from an API route, stream events back via SSE

### Frontend Development (React/JSX)

**No build step** — edit `app/screens_*.jsx` directly; browser transpiles via Babel.

**Run with Docker but modify frontend live**:
```bash
docker compose up  # starts all services
# Edit app/*.jsx in your editor
# Browser auto-reloads on file change (mounted volume in docker-compose.yml)
```

**Test a screen in isolation**:
1. Open DevTools Console
2. Check `window.DTApi` for available functions
3. Call API functions manually: `await window.DTApi.listConnections()`
4. Inspect network tab to see actual requests

**Fallback to demo mode** (no backend needed):
- Stop the backend service in docker-compose
- Frontend will render from `app/data.js` mock data
- Useful for UI-only development

**Add a new screen**:
1. Create `app/screens_myscreen.jsx`:
   ```jsx
   window.DTScreens.myscreen = () => {
     const { /* from useApp */ } = useApp();
     return <div>...</div>;
   };
   ```
2. Add entry to `NAV` array in `app/shell.jsx`
3. Screen is immediately routable via `go("myscreen")`

### Testing

Login For Testing - '{"email":"test@pal.tech","password":"Test1234!"}
No formal test suite currently. For manual testing:

**Profile a table** (end-to-end):
1. Start all services: `docker compose up --build`
2. Go to http://localhost → Connections → Create
3. Enter SQL Server/Snowflake/Databricks credentials
4. Go to Profiling → select schema + table → Run
5. Watch SSE progress stream in real time
6. View final report with scores

**Test a connector**:
```bash
cd backend
python3 << 'PYEOF'
from app.connectors.registry import get_connector
c = get_connector("snowflake", {
    "account": "...",
    "user": "...",
    "password": "...",
})
print(c.list_schemas())
c.close()
PYEOF
```

---

## Key Implementation Details

### Credential Encryption

Credentials stored in `connections.config_encrypted` using Fernet (AES):

```python
from cryptography.fernet import Fernet
import hashlib, base64
key_bytes = settings.encryption_key.encode()
digest = hashlib.sha256(key_bytes).digest()
fernet = Fernet(base64.urlsafe_b64encode(digest))
encrypted = fernet.encrypt(json.dumps(creds).encode()).decode()
```

`ENCRYPTION_KEY` must be exactly 32 characters in `.env`. Change this in production.

### SSE (Server-Sent Events) Streaming

Used for long-running operations (profiling, execution, simulation). Frontend consumes via `fetch()` + `ReadableStream`:

```javascript
fetch('/api/profiling/run', { method: 'POST', body: JSON.stringify(...) })
  .then(res => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    // ... read chunks, parse JSON lines
  })
```

Backend streams via `StreamingResponse`:
```python
def stream_generator():
    yield json.dumps({"type": "progress", "step": "...", "pct": 10}) + "\n"
    # ... more events
    yield json.dumps({"type": "report", "data": report.dict()}) + "\n"

return StreamingResponse(stream_generator(), media_type="application/x-ndjson")
```

nginx config has `proxy_buffering off` to enable real-time streaming.

### Human-in-the-Loop Pattern

Every AI suggestion requires explicit human action:

1. **Metadata agent** generates descriptions → steward approves/edits via `POST /api/metadata/dictionary/{id}/decide`
2. **Rule agent** recommends rules → engineer approves/rejects via `PATCH /api/rules/{id}`
3. **NL → DQ rule** generates expression → engineer reviews before saving
4. **Anomaly explainability** generates narrative → steward accepts/escalates via task board

All decisions logged to `audit_trail` table for compliance.

### Medallion Architecture Support

Profiling, rules, and anomalies are all tracked per layer (RAW, BRONZE, SILVER, GOLD). Layer is:
1. Inferred from schema name (e.g., `raw_orders` → RAW)
2. Set explicitly in connection config `layer_map` (schema → layer)
3. Fallback: UNKNOWN

Execution results page shows per-layer quality scores side-by-side.

### Mock Data Fallback

When backend is unavailable or demo connection is used, frontend renders from `app/data.js`. This is intentional — allows UI demo without needing real database. Update `DT` mock data for testing new screens.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "ENCRYPTION_KEY must be 32 chars" | Edit `.env`: `ENCRYPTION_KEY=your-32-character-secret-key-xyz` |
| Backend won't start (Docker) | `docker compose logs backend` to see logs; check `.env` has all required vars |
| "No module named pyodbc" | Dockerfile installs SQL Server ODBC driver; ensure `--build` flag: `docker compose up --build` |
| LLM 401 errors | Verify API key in `.env` matches the `api_key_env` in `llm_config.yaml` |
| Frontend shows demo data only | Normal when backend unavailable; check DevTools → Network tab for `/api/*` errors |
| SSE not streaming (frontend hangs) | Check nginx `proxy_buffering off` in `nginx.conf` (already set); verify backend is running |
| PostgreSQL connection refused | Ensure postgres container is healthy: `docker compose ps` → postgres should be "up" |

---

## Important Files & Their Role

| File | Purpose |
|------|---------|
| `.env` | API keys, encryption key, database URL — never commit with real secrets |
| `llm_config.yaml` | LLM provider + model selection (change this to swap Claude ↔ GPT) |
| `docker-compose.yml` | Service orchestration; postgres, backend, frontend networking |
| `nginx.conf` | Reverse proxy config; maps `/api/*` to backend, enables SSE |
| `backend/main.py` | FastAPI app, router registration, startup schema migration |
| `backend/app/core/config.py` | Settings loader (reads .env + llm_config.yaml) |
| `backend/app/core/llm.py` | LiteLLM wrapper (all agents call this) |
| `backend/app/connectors/registry.py` | Connector factory; maps platform name → connector class |
| `app/api.js` | Frontend API client; thin fetch wrapper for all backend calls |
| `app/shell.jsx` | App shell, routing, sidebar, context; heart of SPA |
| `DataTrust.html` | Entry point; imports all scripts in order |

---

## Platform Support Matrix

| Platform | Auth Types | Status |
|----------|-----------|--------|
| SQL Server | SQL auth, Windows auth, Azure AD | Supported |
| Snowflake | Username/password, key pair, OAuth | Supported |
| Databricks | PAT, OAuth | Supported |
| PostgreSQL | Username/password | Supported |
| DuckDB | File path (or in-memory) | Supported |

Adding a new platform: implement `BaseConnector`, register in `registry.py`, update `SUPPORTED_PLATFORMS` list.

---

## Microsoft Entra ID SSO (Optional)

If `AZURE_TENANT_ID` and `AZURE_CLIENT_ID` are configured:
1. Frontend shows "Continue with Microsoft (pal.tech)" button
2. Initiates PKCE flow (no client secret needed in browser)
3. `POST /api/auth/microsoft/token` exchanges code for JWT
4. Backend decodes token, returns user name + email

When not configured, falls back to demo mode (instant login with `demo@pal.tech`).

Setup: Register app in Azure AD → App registrations → New registration → Copy tenant ID + client ID → set in `.env`.
