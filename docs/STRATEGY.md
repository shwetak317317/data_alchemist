# Agentic Data Quality & Trust Solution — Full Project Plan

> **Perspective**: Senior Data Engineer / Head of Data Engineering
> This plan is written from the ground up — first acknowledging what we suffer through manually,
> then designing the AI-assisted system that eliminates those pain points, layer by layer.

---

## PART 1 — THE MANUAL REALITY: WHAT A SENIOR DE ACTUALLY FACES TODAY

### 1.1 A Typical Day Without This System

```
07:45  Slack ping — "Sales dashboard is wrong again"
08:00  Start digging. Which table? Which pipeline run? Which source?
09:30  Found it — a null foreign key cascaded through three joins silently
10:00  Fix deployed. Now check if yesterday's run was also affected
11:00  Backfill three days of Gold layer data manually
13:00  Write post-mortem. Add a one-off check to the pipeline manually
14:00  Repeat tomorrow for a different table.
```

This is not exaggeration. This is Tuesday.

---

### 1.2 Manual Challenges by Layer

#### RAW / LANDING Layer
| Challenge | Pain |
|---|---|
| No schema enforcement at ingest | Silently wrong data lands every day |
| No volume checks | A source sends 0 rows — nobody knows |
| No format validation | Dates arrive as strings; discovered in Gold |
| No source-arrival monitoring | Late feeds break SLA silently |
| Profiling done manually per request | Takes 2–4 hours per dataset |

#### BRONZE Layer (Cleaned, typed, deduplicated)
| Challenge | Pain |
|---|---|
| Dedup logic written per pipeline | No standard; every engineer does it differently |
| No automated null/completeness checks | Business columns silently empty |
| Type casting errors hidden | Cast failures silently coerce or drop rows |
| No lineage tracking | Can't trace a bad record back to source |

#### SILVER Layer (Conformed, joined, enriched)
| Challenge | Pain |
|---|---|
| Referential integrity never checked at runtime | Orphan records join silently as NULLs |
| Business rules encoded in SQL only | No documentation, no audit trail |
| No threshold monitoring | Revenue column drops 40% — seen next morning |
| No cross-table consistency checks | Same customer, different name across tables |

#### GOLD / SERVING Layer (Aggregated, business-ready)
| Challenge | Pain |
|---|---|
| Dashboard numbers wrong — root cause unknown | Hours of backward drilling |
| No quality score exposed to consumers | Business has no signal until something breaks |
| No anomaly summary for stakeholders | "Trust us" is not a strategy |
| SLA reporting relies on tribal knowledge | Only 2 engineers know the pipeline |

---

### 1.3 The Core Manual Bottlenecks

```
1.  PROFILING     — Manual, done once, never updated
2.  RULE WRITING  — SQL scripts per engineer, no standard library
3.  MONITORING    — Cron jobs checking row counts at best
4.  ANOMALY       — Discovered by a broken dashboard, not a detector
5.  EXPLAINABILITY— "Check the logs" is the only answer
6.  HUMAN REVIEW  — Slack thread, no workflow, no audit trail
7.  DOCUMENTATION — Confluence page nobody updates
8.  LINEAGE       — Draw.io diagram from 2022
```

---

## PART 2 — HOW AI CHANGES EACH PAIN POINT

| Manual Pain | What AI Does Instead |
|---|---|
| Profile a table manually in 4 hours | Agent profiles in 2 minutes, flags risks automatically |
| Write DQ rules from scratch | Agent recommends rules based on actual data patterns |
| Translate business requirement to SQL | NL → DQ rule in one sentence |
| Hunt down anomalies after dashboard breaks | Anomaly agent detects before downstream impact |
| Write business-readable incident summaries | Explainability agent generates plain-English narrative |
| Tribal knowledge in one engineer's head | AI enriches dictionary, CDEs documented continuously |
| Manual backfill decisions | Agent recommends scope of impact and remediation path |
| No trend visibility | Continuous monitoring with trend lines and degradation alerts |
| Informal Slack review | Structured human-in-the-loop workflow with audit trail |

---

## PART 3 — FULL PROJECT PLAN

---

### ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DATA PLATFORM (Snowflake / Databricks / Fabric)  │
│                                                                          │
│  [RAW / LANDING]  →  [BRONZE]  →  [SILVER]  →  [GOLD / SERVING]        │
│        ↑                ↑              ↑               ↑                │
│        └────────────────┴──────────────┴───────────────┘                │
│                     DQ AGENT LAYER (watches all layers)                  │
└─────────────────────────────────────────────────────────────────────────┘
                              ↕ APIs / Events
┌─────────────────────────────────────────────────────────────────────────┐
│                         AGENTIC ORCHESTRATOR                             │
│  Profiling Agent │ Metadata Agent │ Rule Agent │ Execution Agent         │
│  Anomaly Agent   │ Explainability Agent │ Monitoring Agent               │
└─────────────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────────────┐
│              HUMAN-IN-THE-LOOP UI  (React / Next.js)                    │
│  Review Console │ Rule Studio │ Anomaly Inbox │ Trust Dashboard          │
│  Scenario Simulator │ Task Board (human add tasks at any step)           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## PHASE 0 — FOUNDATION & ENVIRONMENT SETUP

**Goal**: Lay the infrastructure ground before any agent is built.
**Duration**: Week 1–2

### Steps

#### 0.1 Platform & Connectivity
- [ ] Choose data platform: Snowflake / Databricks / Fabric
- [ ] Set up dev, staging, and demo environments
- [ ] Create schema namespaces per layer: `raw`, `bronze`, `silver`, `gold`, `dq_results`, `dq_metadata`
- [ ] Configure service accounts with read access to all layers

#### 0.2 Seed Data Preparation
- [ ] Identify or generate synthetic datasets across domains:
  - `customers` (master data with nulls, duplicates, format issues)
  - `orders` (transactions with orphans, threshold anomalies)
  - `shipments` (with missing source scenarios)
  - `products` (reference data with invalid codes)
  - `finance_daily` (volume and distribution drift scenarios)
- [ ] Inject intentional quality issues at each layer:

  | Layer | Injected Issue |
  |---|---|
  | Raw | Missing daily file from one source system |
  | Bronze | 12% null values in `customer_email`; duplicate `order_id` |
  | Silver | Orphan orders with no matching customer; invalid `status` codes |
  | Gold | Revenue metric 38% below 7-day average; date column drift |

- [ ] Snapshot data at T-7, T-3, T-1, T=today for trend simulation

#### 0.3 Metadata Store Setup
- [ ] Create `dq_metadata` schema with tables:
  - `data_dictionary` — column descriptions, types, business owner
  - `critical_data_elements` — CDE registry with status
  - `dq_rules` — rule definitions, layer, status, approved_by
  - `dq_run_results` — execution log per rule per run
  - `anomaly_log` — detected anomalies with severity and explanation
  - `human_review_queue` — items pending human action
  - `audit_trail` — every human action timestamped

#### 0.4 Tech Stack Decision
- [ ] Backend: Python (FastAPI)
- [ ] Agent framework: LangGraph or CrewAI
- [ ] LLM: Claude (Anthropic API) — for rule generation, NL→DQ, explainability
- [ ] UI: React + Next.js
- [ ] Scheduler: Airflow or Databricks Workflows
- [ ] Notifications: Slack webhook + UI inbox

> 🧑‍💻 **HUMAN CHECKPOINT 0**: Platform connection confirmed, seed data reviewed and approved by team lead before Phase 1 starts.

---

## PHASE 1 — AGENTIC PROFILING ENGINE

**Goal**: Auto-profile any dataset at any layer and surface a structured report.
**Duration**: Week 2–3

### 1.1 Profiling Agent — What It Does
- Connects to any table across Raw → Gold layers
- Computes per-column statistics:
  - Row count, null %, distinct count, cardinality ratio
  - Min / Max / Mean / Median / Std Dev (numerics)
  - Format patterns (strings: email, phone, date, code)
  - Top 10 most frequent values
  - Duplicate record detection (full row + key-based)
- Computes table-level health:
  - Completeness score (% non-null critical columns)
  - Uniqueness score (dedup ratio on primary keys)
  - Consistency score (format conformance %)
  - Freshness score (last updated vs. expected SLA)

### 1.2 Layer-Aware Profiling Rules
| Layer | Extra Checks |
|---|---|
| Raw | Source arrival timestamp, file row count vs. yesterday |
| Bronze | Type cast success rate, dedup effectiveness |
| Silver | Referential integrity (FK existence rate), join success rate |
| Gold | Metric variance vs. 7-day baseline, SLA freshness |

### 1.3 Profiling UI Panel
```
┌─────────────────────────────────────────────────────┐
│  DATASET: silver.orders    RUN: 2024-11-01 08:03    │
│  Layer: SILVER    Rows: 1,842,300    Score: 67/100  │
├─────────────────────────────────────────────────────┤
│  COLUMN          NULL%   DISTINCT   FORMAT   HEALTH │
│  order_id         0.0%   1,842,300   ✓        ✅    │
│  customer_id      0.2%   94,100      ✓        ✅    │
│  order_date       0.0%   364         mixed ⚠️  ⚠️   │
│  revenue         12.4%   —           numeric   ❌    │
│  status           0.0%   9           code      ⚠️   │
├─────────────────────────────────────────────────────┤
│  RISKS FLAGGED:                                      │
│  • revenue has 12.4% nulls — HIGH RISK CDE          │
│  • order_date has mixed formats (YYYY-MM-DD vs MM/DD)│
│  • 3 unknown status codes: ['PNDG','ERR2','VOID_X'] │
│                                                      │
│  [+ Add Note]  [Flag for Review]  [Run Rules →]     │
└─────────────────────────────────────────────────────┘
```

### 1.4 Human-in-the-Loop — Phase 1
- DE/Analyst reviews profiling report
- Can **flag a column** for immediate CDE promotion
- Can **add a manual observation** (e.g., "revenue nulls are expected for returns")
- Can **suppress a risk** with a reason (goes to audit trail)
- Can **inject a custom profiling task** (e.g., "also check zip code format")

> 🧑‍💻 **HUMAN CHECKPOINT 1**: Profiling report reviewed. Human confirms risks, suppresses false positives, adds observations. Approved → triggers Phase 2.

---

## PHASE 2 — METADATA ENRICHMENT & CRITICAL DATA ELEMENTS

**Goal**: Build a living data dictionary and identify CDEs that must be monitored.
**Duration**: Week 3–4

### 2.1 Metadata Agent — What It Does
- Reads profiling output + existing catalog metadata (if any)
- For each column, generates:
  - Business-friendly name
  - Description (what this field means in business context)
  - Suggested data type and format standard
  - Business owner / domain tag
  - Sensitivity tag (PII, financial, operational)
  - CDE candidacy score (0–100)
- Flags columns with no description, ambiguous names, or conflicting types

### 2.2 CDE Identification Logic
AI scores each column on:
- Null risk × Business criticality
- Appears in Gold layer aggregations
- Referenced in 3+ downstream tables
- Flagged in past incidents
- Has a regulatory/compliance tag

Output: ranked CDE candidate list with score and rationale.

### 2.3 Metadata UI Panel
```
┌─────────────────────────────────────────────────────────────────┐
│  DATA DICTIONARY ENRICHMENT — silver.orders                     │
├──────────────┬────────────────────────────┬────────┬───────────┤
│  Column       │ AI-Suggested Description   │ CDE?   │ Action    │
├──────────────┼────────────────────────────┼────────┼───────────┤
│  revenue      │ Net order value after tax  │ ✅ YES │ [✓ Approve│
│               │ and discounts (USD)        │ Score:97│  ✎ Edit] │
├──────────────┼────────────────────────────┼────────┼───────────┤
│  customer_id  │ Unique customer identifier │ ✅ YES │ [✓ Approve│
│               │ linked to CRM master       │ Score:95│  ✎ Edit] │
├──────────────┼────────────────────────────┼────────┼───────────┤
│  promo_code   │ Promotional campaign code  │ ⬜ NO  │ [Promote  │
│               │ applied at checkout        │ Score:41│  to CDE] │
└──────────────┴────────────────────────────┴────────┴───────────┘
│  [+ Add Column Manually]  [Import from Catalog]  [Export Dict] │
└─────────────────────────────────────────────────────────────────┘
```

### 2.4 Human-in-the-Loop — Phase 2
- Steward reviews each AI-suggested description — **Approve / Edit / Reject**
- Steward promotes or demotes CDE candidacy
- Human can **manually add columns** missing from profiling (e.g., derived fields)
- Human can **add business context notes** that feed into rule generation
- Human can **tag sensitivity** (PII override)

> 🧑‍💻 **HUMAN CHECKPOINT 2**: Data dictionary finalized. CDE list approved. Context notes saved. Approved → triggers Phase 3.

---

## PHASE 3 — DQ RULE RECOMMENDATION & RULE STUDIO

**Goal**: Generate a comprehensive, context-aware DQ rule set — with human review at every rule.
**Duration**: Week 4–5

### 3.1 Rule Recommendation Agent — Input Sources
- Profiling statistics (nullability, cardinality, format patterns)
- CDE registry (higher scrutiny rules for CDEs)
- Human context notes from Phase 2
- Historical anomaly log (if available)
- Industry standard rule patterns (finance, e-commerce, health)

### 3.2 Rule Categories Generated Per Layer

| Layer | Rule Types |
|---|---|
| Raw | Source arrival check, row count vs. yesterday ±%, schema match |
| Bronze | Null % below threshold, dedup on PK, type conformance, format regex |
| Silver | FK existence rate, cross-table consistency, status code whitelist |
| Gold | Metric within ±N% of 7-day avg, freshness SLA, CDE non-null |

### 3.3 Rule Recommendation UI — Rule Studio
```
┌──────────────────────────────────────────────────────────────────────┐
│  RULE STUDIO — silver.orders — 14 Rules Recommended                 │
├───┬──────────────────────────────────┬────────┬──────────┬──────────┤
│ # │ Rule Description                 │ Layer  │ Severity │ Action   │
├───┼──────────────────────────────────┼────────┼──────────┼──────────┤
│ 1 │ revenue must not be NULL         │ Silver │ CRITICAL │ ✓ Approve│
│   │ (CDE — 12.4% nulls detected)     │        │          │ ✎ Edit   │
│   │                                  │        │          │ ✗ Reject │
├───┼──────────────────────────────────┼────────┼──────────┼──────────┤
│ 2 │ order_date format must match     │ Silver │ HIGH     │ ✓ Approve│
│   │ YYYY-MM-DD (mixed formats found) │        │          │ ✎ Edit   │
├───┼──────────────────────────────────┼────────┼──────────┼──────────┤
│ 3 │ status must be in approved list  │ Silver │ HIGH     │ ✓ Approve│
│   │ ['OPEN','CLOSED','CANCELLED'...] │        │          │ ✎ Edit   │
├───┼──────────────────────────────────┼────────┼──────────┼──────────┤
│ 4 │ customer_id FK must exist in     │ Silver │ CRITICAL │ ✓ Approve│
│   │ bronze.customers                 │        │          │ ✎ Edit   │
└───┴──────────────────────────────────┴────────┴──────────┴──────────┘
│  [+ Add Rule Manually]  [Convert from Natural Language]             │
│  [Bulk Approve All LOW]  [Export Rule Set]                          │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.4 Natural Language → DQ Rule Converter
Any user types a plain-English expectation:

```
User types:
"Revenue should never be negative and should not exceed $50,000 for a single order"

AI generates:
  Rule Name   : revenue_range_check
  Layer       : silver.orders
  Expression  : revenue >= 0 AND revenue <= 50000
  Severity    : HIGH
  CDE impact  : YES (revenue is CDE)
  Explanation : Negative revenue indicates a data entry error or
                uncorrected return record. Orders above $50K are
                statistically anomalous for this domain.

  [Approve & Add]  [Edit Expression]  [Reject]
```

### 3.5 Human-in-the-Loop — Phase 3
- Every rule requires explicit **Approve / Edit / Reject**
- Bulk approve allowed only for LOW severity, non-CDE rules
- Human can **add any custom rule** at any time from the Rule Studio
- Human can **set rule priority** and **snooze** a rule (with expiry date)
- All decisions logged to audit trail with approver name + timestamp

> 🧑‍💻 **HUMAN CHECKPOINT 3**: Full rule set reviewed and approved. At least one NL→rule conversion demonstrated. Rule set activated → triggers Phase 4.

---

## PHASE 4 — DQ EXECUTION ENGINE

**Goal**: Run all approved rules across all layers, produce scored results.
**Duration**: Week 5–6

### 4.1 Execution Agent — What It Does
- Pulls all APPROVED rules from `dq_rules` table
- Executes rules per layer in order (Raw → Bronze → Silver → Gold)
- For each rule produces:
  - PASS / FAIL status
  - Fail count and fail % 
  - Sample failed records (top 20)
  - Quality score contribution
  - Severity-weighted impact score

### 4.2 Execution Results Schema
```sql
dq_run_results (
  run_id, run_timestamp, layer, table_name,
  rule_id, rule_name, status,         -- PASS / FAIL / ERROR
  total_records, failed_records, fail_pct,
  quality_score,                      -- 0-100 per rule
  severity,                           -- CRITICAL / HIGH / MEDIUM / LOW
  sample_failed_records,              -- JSON array, top 20
  remediation_suggestion              -- AI-generated
)
```

### 4.3 Execution Results UI
```
┌───────────────────────────────────────────────────────────────────┐
│  DQ EXECUTION RESULTS — Run #1042 — 2024-11-01 08:15             │
│  Layer: SILVER    Table: orders    Overall Score: 71 / 100 ⚠️     │
├────────────────────┬─────────┬──────────┬──────────┬─────────────┤
│  Rule              │ Status  │ Fail Cnt │ Fail %   │ Severity    │
├────────────────────┼─────────┼──────────┼──────────┼─────────────┤
│  revenue_not_null  │ ❌ FAIL │ 228,445  │ 12.4%    │ 🔴 CRITICAL │
│  order_date_format │ ❌ FAIL │ 14,201   │  0.77%   │ 🟠 HIGH     │
│  status_whitelist  │ ❌ FAIL │  3,102   │  0.17%   │ 🟠 HIGH     │
│  customer_fk_check │ ✅ PASS │  0       │  0.00%   │ —           │
│  revenue_range     │ ✅ PASS │  0       │  0.00%   │ —           │
├────────────────────┴─────────┴──────────┴──────────┴─────────────┤
│  [View Failed Records]  [Download CSV]  [Trigger Remediation]     │
│  [+ Add Rule for This Issue]  [Snooze Rule]  [Escalate]          │
└───────────────────────────────────────────────────────────────────┘
```

### 4.4 Human-in-the-Loop — Phase 4
- Human can **drill into failed records** for any rule
- Human can **mark a failure as expected** (with justification → audit trail)
- Human can **escalate** a CRITICAL failure to a named owner
- Human can **add a new rule** directly from a failed record pattern
- Human can **trigger a partial backfill** scope recommendation

> 🧑‍💻 **HUMAN CHECKPOINT 4**: Execution results reviewed. Critical failures escalated or acknowledged. Remediation decisions logged.

---

## PHASE 5 — ANOMALY DETECTION ENGINE

**Goal**: Detect issues that rule checks alone cannot — volume, distribution, source, and segment anomalies.
**Duration**: Week 6–7

### 5.1 Anomaly Types by Layer

| Anomaly Type | Layer | Detection Method |
|---|---|---|
| Source non-arrival | Raw | Expected file timestamp check |
| Volume spike / drop | Raw → Gold | Row count vs. 7-day rolling average ± 2σ |
| Distribution drift | Bronze → Silver | Statistical comparison (KL divergence / IQR) |
| Segment degradation | Silver | Quality score per partition (region, date, category) |
| Metric threshold breach | Gold | Business KPI vs. threshold (rule-defined) |
| Cross-table mismatch | Silver | Same entity, conflicting values across tables |
| Freshness SLA breach | All | Last updated vs. expected update time |

### 5.2 Anomaly Detection UI — Anomaly Inbox
```
┌───────────────────────────────────────────────────────────────────────┐
│  ANOMALY INBOX — 4 Active Anomalies                                  │
├───┬──────────────────────────────────────┬───────────┬───────────────┤
│ ! │ Anomaly                              │ Layer     │ Detected      │
├───┼──────────────────────────────────────┼───────────┼───────────────┤
│ 🔴│ silver.orders: row count dropped 61% │ Silver    │ 2 mins ago    │
│   │ from 1.84M → 716K vs. yesterday      │           │               │
│   │ [Investigate] [Acknowledge] [Explain]│           │               │
├───┼──────────────────────────────────────┼───────────┼───────────────┤
│ 🟠│ gold.revenue_daily: revenue 38%      │ Gold      │ 14 mins ago   │
│   │ below 7-day average ($1.2M vs $1.9M) │           │               │
│   │ [Investigate] [Acknowledge] [Explain]│           │               │
├───┼──────────────────────────────────────┼───────────┼───────────────┤
│ 🟠│ raw.crm_extract: file not arrived    │ Raw       │ 32 mins ago   │
│   │ Expected by 06:00 — now 08:17        │           │               │
├───┼──────────────────────────────────────┼───────────┼───────────────┤
│ 🟡│ silver.orders: status='ERR2' appears │ Silver    │ 1 hr ago      │
│   │ in Northeast segment only (982 rows) │           │               │
└───┴──────────────────────────────────────┴───────────┴───────────────┘
│  [Run Full Anomaly Scan]  [Set Thresholds]  [Configure Alerts]       │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.3 Human-in-the-Loop — Phase 5
- Human **investigates** any anomaly (opens drill-down with sample data)
- Human can **acknowledge** with a note (suppresses alert for N hours)
- Human can **escalate** to pipeline owner with one click
- Human can **add a new anomaly rule** (e.g., "alert me if Northeast row count < 1000")
- Human can configure alert thresholds dynamically per dataset

> 🧑‍💻 **HUMAN CHECKPOINT 5**: Anomaly inbox reviewed. Each anomaly triaged: acknowledged, escalated, or converted to a new rule.

---

## PHASE 6 — EXPLAINABILITY LAYER

**Goal**: Convert every technical failure and anomaly into a plain-English business narrative.
**Duration**: Week 7

### 6.1 Explainability Agent — What It Does
For every issue (rule failure + anomaly), the agent generates:
- **What happened** (technical summary)
- **Where** (layer, table, column, segment)
- **When** (timestamp, trend — first seen / recurring)
- **Why it matters** (business impact)
- **How bad** (severity, affected record count, % of total)
- **Recommended action** (what DE/steward should do next)

### 6.2 Example Explanations

**For a CRITICAL null failure:**
```
📋 DATA TRUST ALERT — silver.orders — revenue

WHAT HAPPENED
228,445 order records (12.4% of today's load) are missing a revenue value.
This is significantly higher than the 7-day average null rate of 0.8%.

WHERE
Layer: Silver | Table: orders | Column: revenue | Date: 2024-11-01

WHY IT MATTERS
Revenue is a Critical Data Element feeding the Daily Finance Dashboard,
the Monthly P&L Report, and three ML models in production. Null revenue
values will cause these reports to undercount total sales and may trigger
incorrect model predictions.

LIKELY ROOT CAUSE
The spike coincides with today's CRM source extract arriving 2 hours late.
The Bronze pipeline ran before the extract completed, resulting in incomplete
revenue population for orders placed between 23:00–01:00 last night.

RECOMMENDED ACTION
1. Confirm CRM extract is now complete (check raw.crm_extract file size)
2. Re-run Bronze pipeline for orders table (date partition: 2024-10-31)
3. Re-run Silver pipeline for the same partition
4. Validate revenue null% returns to < 1%
```

### 6.3 Explainability UI
```
┌──────────────────────────────────────────────────────────────────┐
│  EXPLAIN THIS ISSUE                                              │
│  Issue: revenue_not_null FAIL — silver.orders — 12.4% null      │
├──────────────────────────────────────────────────────────────────┤
│  🔴 CRITICAL | CDE IMPACTED | FINANCE + ML AFFECTED             │
│                                                                  │
│  What happened:  228,445 records have null revenue today,        │
│                  vs avg 0.8% over past 7 days.                  │
│                                                                  │
│  Root cause:     CRM source arrived 2 hrs late. Bronze ran       │
│                  before extract completed.                       │
│                                                                  │
│  Business impact: Finance Dashboard undercounts ~$4.2M in sales.│
│                   3 ML models affected.                          │
│                                                                  │
│  Recommended actions:                                            │
│  → Re-run Bronze pipeline (2024-10-31 partition)                │
│  → Re-run Silver pipeline                                        │
│  → Validate fix within 30 minutes                               │
│                                                                  │
│  [Accept & Assign]  [Modify Explanation]  [Share to Slack]      │
└──────────────────────────────────────────────────────────────────┘
```

---

## PHASE 7 — TRUST DASHBOARD & REPORTING

**Goal**: Give every user type a single pane of glass for data trust.
**Duration**: Week 7–8

### 7.1 Dashboard Views

#### Executive / Business View
- Overall Data Trust Score (0–100) with trend line
- Top 3 issues in plain English
- Impacted business areas (Finance, Operations, Analytics, AI)
- Last 30 days: score history, resolved vs. open issues

#### Technical / DE View
- Per-layer quality scores (Raw → Bronze → Silver → Gold)
- Rule pass/fail rates per table
- CDE health status
- Anomaly timeline
- Failed record volume trend

#### Steward / Governance View
- CDE monitoring status
- Dictionary completeness %
- Rule coverage (% columns with at least one rule)
- Audit trail of all human decisions

### 7.2 Dashboard Layout (Technical View)
```
┌────────────┬────────────┬────────────┬────────────┐
│ RAW Score  │ BRONZE     │ SILVER     │ GOLD       │
│  88 / 100  │  79 / 100  │  67 / 100  │  71 / 100  │
│  ✅ Healthy │  ⚠️ Warn   │  ❌ Issues │  ⚠️ Warn   │
└────────────┴────────────┴────────────┴────────────┘
┌──────────────────────────┬─────────────────────────┐
│  OPEN ISSUES (7)         │  ANOMALIES (4)          │
│  2 Critical              │  1 Volume Drop          │
│  3 High                  │  1 Metric Deviation     │
│  2 Medium                │  1 Source Late          │
│                          │  1 Segment Anomaly      │
└──────────────────────────┴─────────────────────────┘
┌──────────────────────────────────────────────────────┐
│  QUALITY SCORE TREND — LAST 14 DAYS                  │
│  100 ┤                                               │
│   80 ┤    ╭───╮   ╭──╮                               │
│   60 ┤────╯   ╰───╯  ╰──── TODAY                    │
│   40 ┤                                               │
└──────────────────────────────────────────────────────┘
```

---

## PHASE 8 — CONTINUOUS MONITORING LOOP

**Goal**: Run everything on a schedule — with smart triggers, not just cron.
**Duration**: Week 8

### 8.1 Monitoring Schedule
| Trigger | Frequency | Scope |
|---|---|---|
| Source arrival check | Every 15 min | Raw layer |
| Bronze DQ run | On pipeline completion | Bronze tables |
| Silver DQ run | On pipeline completion | Silver tables |
| Gold DQ run | Daily post-Gold refresh | Gold tables |
| Full anomaly scan | Daily 06:00 | All layers |
| CDE health check | Daily | CDE registry |
| Trend / drift check | Weekly | All tables |

### 8.2 Alert Routing
- CRITICAL → Slack + UI inbox + email to data owner
- HIGH → UI inbox + Slack
- MEDIUM → UI inbox only
- LOW → Logged silently, visible in dashboard

### 8.3 Human-in-the-Loop — Phase 8
- Human can **add a new scheduled check** from the UI at any time
- Human can **pause monitoring** for a table (e.g., during a planned migration)
- Human can **adjust alert thresholds** per dataset without code changes
- Human can **request an on-demand full scan** at any time

---

## PHASE 9 — LIVE SCENARIO SIMULATION ENGINE

**Goal**: Prove the system reacts to fresh issues in real time. The "must-have" demo capability.
**Duration**: Week 8–9

### 9.1 How It Works
```
REVIEWER provides a scenario (text)
        ↓
SYSTEM parses scenario → identifies: layer, table, issue type, severity
        ↓
DATA INJECTION: team or script introduces the issue into the dataset
        ↓
MONITORING AGENT detects the change within 60–120 seconds
        ↓
ANOMALY AGENT classifies and scores the issue
        ↓
EXPLAINABILITY AGENT generates a business narrative
        ↓
UI SURFACES the detection live on the demo screen
        ↓
HUMAN acknowledges, explains, and initiates remediation
```

### 9.2 Pre-Built Scenario Scripts
Teams prepare these scenarios ahead of demo day:

| Scenario | What Gets Injected | Expected Detection |
|---|---|---|
| "Revenue data is missing for yesterday" | Set revenue = NULL for all rows where order_date = T-1 | CRITICAL null rule fail + anomaly alert |
| "Orders dropped overnight" | Delete 60% of today's Bronze orders rows | Volume anomaly: -60% vs baseline |
| "New invalid status code appeared" | Insert 5,000 rows with status = 'GHOST' | Whitelist rule failure + segment anomaly |
| "CRM feed stopped arriving" | Remove today's raw file arrival timestamp | Source non-arrival alert |
| "Northeast region data is corrupted" | Null out zip_code for region = 'Northeast' | Segment-level anomaly alert |

### 9.3 Scenario Simulation UI
```
┌──────────────────────────────────────────────────────────────────────┐
│  🎬 LIVE SCENARIO SIMULATOR                                          │
├──────────────────────────────────────────────────────────────────────┤
│  Reviewer Scenario Input:                                            │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ "Imagine revenue data was not loaded for today's orders"       │ │
│  └────────────────────────────────────────────────────────────────┘ │
│  [Inject Scenario]                                                   │
├──────────────────────────────────────────────────────────────────────┤
│  SYSTEM REACTION (LIVE)                                              │
│                                                                      │
│  ⏱ 00:00  Scenario injected → revenue set to NULL for T=today       │
│  ⏱ 00:43  Monitoring agent triggered DQ execution                   │
│  ⏱ 01:12  ❌ CRITICAL ALERT: revenue_not_null FAILED                │
│           228,445 records | 12.4% null | Silver layer               │
│  ⏱ 01:15  🔴 Anomaly detected: null rate 15x above baseline         │
│  ⏱ 01:18  📋 Explanation generated:                                 │
│           "Today's revenue data is missing for 12.4% of orders,    │
│            impacting Finance Dashboard and 3 ML models. Likely     │
│            caused by incomplete pipeline run. Recommend re-run."   │
│                                                                      │
│  [Acknowledge]  [Assign to DE]  [View Failed Records]               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## PHASE 10 — HUMAN TASK BOARD (CROSS-PHASE)

**Goal**: Allow humans to inject tasks, notes, or custom steps at ANY point in any phase.
**This is a persistent capability across all phases — not a separate phase.**

### 10.1 The Task Board

Every phase surfaces a **Task Board** where any user can:
- Add a custom task ("re-check the finance schema after the migration tonight")
- Assign it to a person
- Tag it to a phase and layer
- Set priority and due date
- Track completion

```
┌─────────────────────────────────────────────────────────────────────┐
│  HUMAN TASK BOARD                               [+ Add Task]        │
├──────┬─────────────────────────────────┬─────────┬────────┬────────┤
│ Prio │ Task                            │ Phase   │ Owner  │ Status │
├──────┼─────────────────────────────────┼─────────┼────────┼────────┤
│  🔴  │ Validate revenue backfill       │ Phase 4 │ Ravi   │ Open   │
│  🟠  │ Check CRM SLA with source team  │ Phase 5 │ Priya  │ Open   │
│  🟡  │ Add zip_code format rule        │ Phase 3 │ System │ Done   │
│  🟢  │ Review Gold dashboard w/ Finance│ Phase 7 │ All    │ Open   │
└──────┴─────────────────────────────────┴─────────┴────────┴────────┘
```

### 10.2 Human Override at Any Step

At any point, a human can:
| Override Type | Where | What Happens |
|---|---|---|
| Add profiling column | Phase 1 | Agent re-profiles with new column included |
| Correct a CDE decision | Phase 2 | CDE registry updated; all downstream rules re-evaluated |
| Edit a recommended rule | Phase 3 | Rule updated with edit reason in audit trail |
| Mark a failure as expected | Phase 4 | Failure suppressed; logged with justification |
| Add an anomaly threshold | Phase 5 | New threshold activated immediately |
| Rewrite an explanation | Phase 6 | Human version stored; AI version archived |
| Pause a monitoring job | Phase 8 | Monitoring paused with resume timestamp |

---

## PHASE SUMMARY & TIMELINE

```
Week 1–2   | Phase 0  | Foundation, environment, seed data
Week 2–3   | Phase 1  | Profiling Agent + UI
Week 3–4   | Phase 2  | Metadata Enrichment + CDE Registry + UI
Week 4–5   | Phase 3  | Rule Recommendation + NL→DQ + Rule Studio UI
Week 5–6   | Phase 4  | DQ Execution Engine + Results UI
Week 6–7   | Phase 5  | Anomaly Detection + Anomaly Inbox UI
Week 7     | Phase 6  | Explainability Layer + Explanation UI
Week 7–8   | Phase 7  | Trust Dashboard (3 views)
Week 8     | Phase 8  | Continuous Monitoring Loop
Week 8–9   | Phase 9  | Live Scenario Simulation Engine
All Phases | Phase 10 | Human Task Board (persistent)
```

---

## HUMAN CHECKPOINT SUMMARY

| Checkpoint | Phase | What Human Does |
|---|---|---|
| HCP-0 | Foundation | Approves platform, confirms seed data |
| HCP-1 | Profiling | Reviews report, flags risks, suppresses false positives |
| HCP-2 | Metadata | Approves dictionary, confirms CDEs, adds context |
| HCP-3 | Rules | Approves/edits/rejects every rule, demos NL→DQ |
| HCP-4 | Execution | Reviews failures, escalates criticals, marks expected |
| HCP-5 | Anomaly | Triages anomaly inbox, acknowledges or escalates |
| HCP-6 | Explain | Reviews business narratives, edits if needed |
| HCP-7 | Dashboard | Validates all three views with stakeholders |
| HCP-8 | Monitoring | Configures schedules, alert routes, thresholds |
| HCP-9 | Simulation | Reacts live on stage to reviewer's scenario |

---

## NON-NEGOTIABLES

1. **Every agent output requires a human checkpoint before activating downstream**
2. **Every human decision is logged to the audit trail** (who, what, when, why)
3. **No rule auto-activates without explicit approval**
4. **Anomaly detection must span all 4 layers, not just Silver or Gold**
5. **Live scenario simulation must be wired — not mocked — before demo day**
6. **Explainability must be in business language, not log output**
7. **The human can add a task or override at literally any step in the workflow**

---

> "The data engineer's job is not to find fires faster. It is to build a system that never lets fires start unseen."
