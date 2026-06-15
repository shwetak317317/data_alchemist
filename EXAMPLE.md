# EXAMPLE WALKTHROUGH — Agentic DQ Trust System
## Domain: RetailCo E-Commerce Platform
### As experienced by: Ravi (Senior Data Engineer), Priya (Data Steward), Sunita (Finance Analyst)

---

## PART A — DATABASE SCHEMA ASSUMPTION

### Platform: Snowflake (Medallion Architecture)
### Domain: E-Commerce — Orders, Customers, Products, Shipments, Finance

---

### LAYER 0 — RAW (Source Extracts, No Transformation)

```sql
-- Arrives daily as CSV extracts from 3 source systems
-- CRM System  → raw.crm_customers
-- OMS System  → raw.oms_orders, raw.oms_order_items
-- WMS System  → raw.wms_shipments
-- Finance ERP → raw.erp_payments, raw.erp_refunds

raw.crm_customers
  _source_file        VARCHAR     -- 'crm_customers_20241101.csv'
  _arrived_at         TIMESTAMP   -- when file landed in S3
  _row_number         INTEGER     -- original file row
  customer_id         VARCHAR     -- raw, untrusted
  full_name           VARCHAR
  email               VARCHAR
  phone               VARCHAR
  signup_date         VARCHAR     -- raw string, not typed
  region              VARCHAR
  loyalty_tier        VARCHAR

raw.oms_orders
  _source_file        VARCHAR
  _arrived_at         TIMESTAMP
  _row_number         INTEGER
  order_id            VARCHAR
  customer_id         VARCHAR
  order_date          VARCHAR     -- raw string
  status              VARCHAR
  total_amount        VARCHAR     -- raw string, not typed
  discount_code       VARCHAR
  channel             VARCHAR     -- 'WEB','APP','STORE'

raw.oms_order_items
  _source_file        VARCHAR
  _arrived_at         TIMESTAMP
  order_id            VARCHAR
  product_id          VARCHAR
  quantity            VARCHAR     -- raw string
  unit_price          VARCHAR     -- raw string
  line_discount       VARCHAR

raw.wms_shipments
  _source_file        VARCHAR
  _arrived_at         TIMESTAMP
  shipment_id         VARCHAR
  order_id            VARCHAR
  carrier             VARCHAR
  tracking_number     VARCHAR
  shipped_date        VARCHAR     -- raw string
  delivered_date      VARCHAR
  delivery_status     VARCHAR

raw.erp_payments
  _source_file        VARCHAR
  _arrived_at         TIMESTAMP
  payment_id          VARCHAR
  order_id            VARCHAR
  payment_method      VARCHAR
  payment_amount      VARCHAR     -- raw string
  payment_date        VARCHAR
  payment_status      VARCHAR

raw.erp_refunds
  _source_file        VARCHAR
  _arrived_at         TIMESTAMP
  refund_id           VARCHAR
  order_id            VARCHAR
  refund_amount       VARCHAR
  refund_date         VARCHAR
  refund_reason       VARCHAR
```

---

### LAYER 1 — BRONZE (Typed, Deduplicated, Source-Stamped)

```sql
bronze.customers
  customer_id         VARCHAR       NOT NULL  -- PK
  full_name           VARCHAR
  email               VARCHAR
  phone               VARCHAR
  signup_date         DATE                    -- typed from raw string
  region              VARCHAR
  loyalty_tier        VARCHAR
  _source             VARCHAR       -- 'crm'
  _ingested_at        TIMESTAMP
  _file_name          VARCHAR
  _is_duplicate       BOOLEAN       -- dedup flag
  _dedup_key          VARCHAR       -- hash of (email, phone)

bronze.orders
  order_id            VARCHAR       NOT NULL  -- PK
  customer_id         VARCHAR       NOT NULL  -- FK → bronze.customers
  order_date          DATE                    -- typed
  status              VARCHAR
  total_amount        DECIMAL(18,2)           -- typed
  discount_code       VARCHAR
  channel             VARCHAR
  _source             VARCHAR
  _ingested_at        TIMESTAMP
  _is_duplicate       BOOLEAN
  _cast_errors        VARIANT       -- JSON: which fields failed cast

bronze.order_items
  item_id             VARCHAR       NOT NULL  -- surrogate PK
  order_id            VARCHAR       NOT NULL  -- FK → bronze.orders
  product_id          VARCHAR
  quantity            INTEGER
  unit_price          DECIMAL(18,2)
  line_discount       DECIMAL(18,2)
  line_total          DECIMAL(18,2) -- computed: qty * unit_price - discount
  _ingested_at        TIMESTAMP

bronze.shipments
  shipment_id         VARCHAR       NOT NULL
  order_id            VARCHAR       NOT NULL
  carrier             VARCHAR
  tracking_number     VARCHAR
  shipped_date        DATE
  delivered_date      DATE
  delivery_status     VARCHAR
  _ingested_at        TIMESTAMP

bronze.payments
  payment_id          VARCHAR       NOT NULL
  order_id            VARCHAR       NOT NULL
  payment_method      VARCHAR
  payment_amount      DECIMAL(18,2)
  payment_date        DATE
  payment_status      VARCHAR
  _ingested_at        TIMESTAMP

bronze.refunds
  refund_id           VARCHAR       NOT NULL
  order_id            VARCHAR       NOT NULL
  refund_amount       DECIMAL(18,2)
  refund_date         DATE
  refund_reason       VARCHAR
  _ingested_at        TIMESTAMP
```

---

### LAYER 2 — SILVER (Conformed, Joined, Business Rules Applied)

```sql
silver.orders_enriched
  order_id              VARCHAR       NOT NULL  -- PK
  customer_id           VARCHAR       NOT NULL  -- FK → silver.customers_master
  order_date            DATE          NOT NULL
  status                VARCHAR       NOT NULL  -- enforced whitelist
  gross_amount          DECIMAL(18,2) NOT NULL  -- CDE
  discount_amount       DECIMAL(18,2)
  net_revenue           DECIMAL(18,2) NOT NULL  -- CDE: gross - discount
  channel               VARCHAR
  region                VARCHAR                 -- joined from customer
  loyalty_tier          VARCHAR
  item_count            INTEGER
  has_shipment          BOOLEAN
  has_payment           BOOLEAN
  payment_method        VARCHAR
  is_returned           BOOLEAN
  refund_amount         DECIMAL(18,2)
  days_to_deliver       INTEGER                 -- computed
  _dq_score             DECIMAL(5,2)            -- per-record DQ score
  _last_validated_at    TIMESTAMP

silver.customers_master
  customer_id           VARCHAR       NOT NULL  -- PK
  full_name             VARCHAR
  email                 VARCHAR       NOT NULL  -- CDE
  phone                 VARCHAR
  signup_date           DATE
  region                VARCHAR
  loyalty_tier          VARCHAR                 -- BRONZE/SILVER/GOLD/PLATINUM
  lifetime_orders       INTEGER
  lifetime_revenue      DECIMAL(18,2) -- CDE
  last_order_date       DATE
  _dq_score             DECIMAL(5,2)

silver.product_catalog
  product_id            VARCHAR       NOT NULL  -- PK
  product_name          VARCHAR
  category              VARCHAR
  subcategory           VARCHAR
  brand                 VARCHAR
  unit_cost             DECIMAL(18,2)
  list_price            DECIMAL(18,2)
  is_active             BOOLEAN
  _dq_score             DECIMAL(5,2)
```

---

### LAYER 3 — GOLD (Aggregated, Business-Ready Metrics)

```sql
gold.daily_revenue_summary
  report_date           DATE          NOT NULL  -- PK
  total_orders          INTEGER                 -- CDE
  total_gross_revenue   DECIMAL(18,2) NOT NULL  -- CDE
  total_net_revenue     DECIMAL(18,2) NOT NULL  -- CDE
  total_discounts       DECIMAL(18,2)
  total_refunds         DECIMAL(18,2)
  avg_order_value       DECIMAL(18,2)
  orders_by_channel     VARIANT                 -- JSON breakdown
  orders_by_region      VARIANT
  return_rate_pct       DECIMAL(5,2)
  _computed_at          TIMESTAMP
  _source_run_id        VARCHAR

gold.customer_segments
  segment_date          DATE
  region                VARCHAR
  loyalty_tier          VARCHAR
  active_customers      INTEGER
  new_customers         INTEGER
  churned_customers     INTEGER
  avg_lifetime_revenue  DECIMAL(18,2)
  _computed_at          TIMESTAMP

gold.product_performance
  report_date           DATE
  product_id            VARCHAR
  units_sold            INTEGER
  gross_revenue         DECIMAL(18,2)
  return_units          INTEGER
  return_rate_pct       DECIMAL(5,2)
  _computed_at          TIMESTAMP
```

---

### DQ METADATA SCHEMA

```sql
dq_metadata.data_dictionary
  column_id             VARCHAR       -- PK: table_name.column_name
  table_name            VARCHAR
  layer                 VARCHAR       -- RAW/BRONZE/SILVER/GOLD
  column_name           VARCHAR
  business_name         VARCHAR       -- human-readable
  description           VARCHAR
  data_type             VARCHAR
  format_standard       VARCHAR       -- e.g. 'YYYY-MM-DD', 'EMAIL'
  is_pii                BOOLEAN
  is_cde                BOOLEAN
  cde_score             DECIMAL(5,2)
  business_owner        VARCHAR
  approved_by           VARCHAR
  approved_at           TIMESTAMP

dq_metadata.dq_rules
  rule_id               VARCHAR       -- PK
  rule_name             VARCHAR
  rule_description      VARCHAR
  table_name            VARCHAR
  layer                 VARCHAR
  column_name           VARCHAR
  rule_expression       VARCHAR       -- SQL expression
  rule_type             VARCHAR       -- NULL_CHECK/RANGE/FORMAT/FK/VOLUME/CUSTOM
  severity              VARCHAR       -- CRITICAL/HIGH/MEDIUM/LOW
  is_cde_rule           BOOLEAN
  status                VARCHAR       -- DRAFT/APPROVED/ACTIVE/SNOOZED/RETIRED
  approved_by           VARCHAR
  approved_at           TIMESTAMP
  snooze_until          TIMESTAMP
  created_by            VARCHAR       -- 'AI_AGENT' or username

dq_metadata.dq_run_results
  run_id                VARCHAR
  run_timestamp         TIMESTAMP
  rule_id               VARCHAR
  table_name            VARCHAR
  layer                 VARCHAR
  status                VARCHAR       -- PASS/FAIL/ERROR
  total_records         INTEGER
  failed_records        INTEGER
  fail_pct              DECIMAL(5,2)
  quality_score         DECIMAL(5,2)
  severity              VARCHAR
  sample_failed_records VARIANT       -- JSON top 20
  remediation_suggestion VARCHAR
  acknowledged_by       VARCHAR
  acknowledged_at       TIMESTAMP

dq_metadata.anomaly_log
  anomaly_id            VARCHAR
  detected_at           TIMESTAMP
  layer                 VARCHAR
  table_name            VARCHAR
  anomaly_type          VARCHAR
  description           VARCHAR
  severity              VARCHAR
  metric_value          DECIMAL
  baseline_value        DECIMAL
  deviation_pct         DECIMAL
  business_explanation  VARCHAR
  status                VARCHAR       -- OPEN/ACKNOWLEDGED/RESOLVED
  resolved_by           VARCHAR
  resolved_at           TIMESTAMP

dq_metadata.audit_trail
  event_id              VARCHAR
  event_timestamp       TIMESTAMP
  user_name             VARCHAR
  event_type            VARCHAR       -- APPROVE/EDIT/REJECT/SUPPRESS/ESCALATE
  entity_type           VARCHAR       -- RULE/CDE/ANOMALY/TASK
  entity_id             VARCHAR
  old_value             VARIANT
  new_value             VARIANT
  reason                VARCHAR
```

---

## PART B — COMPLETE WALKTHROUGH WITH UI SCREENS

### Context
- **Date**: Tuesday, 5 November 2024
- **Pipeline ran**: 06:00 AM — Bronze + Silver + Gold loaded
- **Ravi** (Sr. DE) opens the DQ Trust System at 08:00 AM
- **Priya** (Data Steward) joins at 09:30 AM
- **Sunita** (Finance) raises a concern at 10:15 AM

---

## SCREEN 1 — LOGIN & WORKSPACE HOME

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  🔷 DataTrust                          Ravi Kumar  ▾   Notifications (3) 🔔 ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Home   Profiling   Rules   Anomalies   Dashboard   Simulate   Tasks        ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  Good morning, Ravi.  Last pipeline run: 06:03 AM ✅  Next run: 18:00 PM    ║
║                                                                              ║
║  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             ║
║  │  OVERALL TRUST  │  │  OPEN ISSUES    │  │  ANOMALIES      │             ║
║  │                 │  │                 │  │                 │             ║
║  │     69 / 100    │  │  ❌  3 Critical │  │  🔴 1 Volume    │             ║
║  │   ▼ -8 pts      │  │  ⚠️  4 High     │  │  🟠 1 Source    │             ║
║  │   vs yesterday  │  │  ℹ️  2 Medium   │  │  🟡 2 Segment   │             ║
║  └─────────────────┘  └─────────────────┘  └─────────────────┘             ║
║                                                                              ║
║  LAYER SCORES                                                                ║
║  ┌──────────┬──────────┬──────────┬──────────┐                             ║
║  │  RAW     │  BRONZE  │  SILVER  │  GOLD    │                             ║
║  │  82/100  │  75/100  │  61/100  │  68/100  │                             ║
║  │  ⚠️Warn  │  ⚠️Warn  │  ❌Issue │  ⚠️Warn  │                             ║
║  └──────────┴──────────┴──────────┴──────────┘                             ║
║                                                                              ║
║  RECENT ACTIVITY                                                             ║
║  08:03  ❌ CRITICAL: silver.orders_enriched — net_revenue null (11.2%)      ║
║  07:58  🔴 ANOMALY: silver.orders_enriched row count dropped 58%            ║
║  07:45  ⚠️ HIGH: bronze.orders — 847 cast errors on total_amount            ║
║  07:01  ℹ️ MED:  raw.wms_shipments — file arrived 55 min late               ║
║                                                                              ║
║  [Go to Anomaly Inbox →]     [Open Today's DQ Run →]    [+ Add Task]        ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

**Ravi says**: "Eight point drop overnight. That silver score is red. Let me start with profiling to understand what's new today."

---

## SCREEN 2 — DATASET SELECTOR (Profiling Entry Point)

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  PROFILING — Select Dataset                                                  ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  Platform: ● Snowflake  ○ Databricks  ○ Fabric                             ║
║  Environment: ● Production  ○ Staging                                        ║
║                                                                              ║
║  SEARCH TABLE  [silver.orders_enriched________________] [Profile Now]        ║
║                                                                              ║
║  — OR BROWSE —                                                               ║
║                                                                              ║
║  ▼ RAW (6 tables)                                                            ║
║    raw.crm_customers        Last profiled: Yesterday  Score: 88  ✅          ║
║    raw.oms_orders           Last profiled: Yesterday  Score: 91  ✅          ║
║    raw.wms_shipments        Last profiled: 2 hrs ago  Score: 79  ⚠️          ║
║                                                                              ║
║  ▼ BRONZE (5 tables)                                                         ║
║    bronze.orders            Last profiled: 2 hrs ago  Score: 75  ⚠️          ║
║    bronze.customers         Last profiled: Yesterday  Score: 84  ✅          ║
║                                                                              ║
║  ▼ SILVER (3 tables)                 ← Ravi clicks here                     ║
║    silver.orders_enriched   Last profiled: 2 hrs ago  Score: 61  ❌          ║
║    silver.customers_master  Last profiled: Yesterday  Score: 80  ✅          ║
║    silver.product_catalog   Last profiled: Yesterday  Score: 92  ✅          ║
║                                                                              ║
║  ▼ GOLD (3 tables)                                                           ║
║    gold.daily_revenue_summary  Last profiled: 1 hr ago  Score: 68  ⚠️       ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

**Ravi clicks** `silver.orders_enriched` → [Profile Now]

---

## SCREEN 3 — PROFILING AGENT RUNNING (Live Progress)

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  🔄 PROFILING IN PROGRESS — silver.orders_enriched                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  ██████████████████████░░░░░  78%   Estimated: 18 seconds remaining         ║
║                                                                              ║
║  ✅  Row count & volume scan            (1,842,300 rows detected)            ║
║  ✅  Schema validation                  (17 columns matched expected)        ║
║  ✅  Null analysis per column           (3 columns flagged)                  ║
║  ✅  Cardinality & distinct analysis    (completed)                          ║
║  ✅  Format pattern detection           (2 columns with mixed formats)       ║
║  🔄  Duplicate detection               (running on order_id + customer_id)  ║
║  ⏳  Statistical distribution           (waiting)                            ║
║  ⏳  Cross-layer FK validation          (waiting)                            ║
║  ⏳  Volume delta vs. yesterday         (waiting)                            ║
║  ⏳  Risk scoring                       (waiting)                            ║
║                                                                              ║
║  [Cancel]                                                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

*15 seconds later — profiling completes.*

---

## SCREEN 4 — PROFILING REPORT (Full Output)

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  PROFILING REPORT — silver.orders_enriched                                  ║
║  Run: 2024-11-05 08:04 AM    Rows: 1,842,300    Score: 61 / 100  ❌         ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  TABLE SUMMARY                                                               ║
║  ┌────────────────────────┬────────────────────────────────────────────┐    ║
║  │ Metric                 │ Value                                      │    ║
║  ├────────────────────────┼────────────────────────────────────────────┤    ║
║  │ Total Rows             │ 1,842,300  (↓ 58% vs yesterday 4,385,100) │    ║
║  │ Duplicate order_id     │ 0          ✅                              │    ║
║  │ Fully null rows        │ 0          ✅                              │    ║
║  │ Last updated           │ 06:03 AM  (SLA: before 07:00) ✅          │    ║
║  │ Completeness score     │ 72%  ❌                                    │    ║
║  │ Uniqueness score       │ 100% ✅                                    │    ║
║  │ Validity score         │ 84%  ⚠️                                    │    ║
║  └────────────────────────┴────────────────────────────────────────────┘    ║
║                                                                              ║
║  COLUMN HEALTH                                                               ║
║  ┌─────────────────┬──────┬──────────┬──────────┬──────────┬────────────┐  ║
║  │ Column          │ Null%│ Distinct │ Format   │ CDE?     │ Health     │  ║
║  ├─────────────────┼──────┼──────────┼──────────┼──────────┼────────────┤  ║
║  │ order_id        │  0%  │ 1,842,300│ UUID ✅  │ NO       │ ✅ HEALTHY │  ║
║  │ customer_id     │  0.1%│ 912,441  │ UUID ✅  │ NO       │ ✅ HEALTHY │  ║
║  │ order_date      │  0%  │ 364      │ DATE ✅  │ NO       │ ✅ HEALTHY │  ║
║  │ status          │  0%  │ 7        │ mixed ⚠️ │ NO       │ ⚠️ WARN   │  ║
║  │ gross_amount    │  0%  │ 184,221  │ DEC ✅   │ ✅ CDE   │ ✅ HEALTHY │  ║
║  │ discount_amount │  8.2%│ 2,341    │ DEC ✅   │ NO       │ ⚠️ WARN   │  ║
║  │ net_revenue     │ 11.2%│ 184,010  │ DEC ✅   │ ✅ CDE   │ ❌ CRIT   │  ║
║  │ channel         │  0%  │ 3        │ OK ✅    │ NO       │ ✅ HEALTHY │  ║
║  │ region          │  3.1%│ 8        │ OK ✅    │ NO       │ ⚠️ WARN   │  ║
║  │ loyalty_tier    │  4.7%│ 4        │ OK ✅    │ NO       │ ⚠️ WARN   │  ║
║  │ has_payment     │  0%  │ 2        │ BOOL ✅  │ NO       │ ✅ HEALTHY │  ║
║  │ is_returned     │  0%  │ 2        │ BOOL ✅  │ NO       │ ✅ HEALTHY │  ║
║  │ refund_amount   │ 91.3%│ 8,441    │ DEC ✅   │ NO       │ ✅ OK*    │  ║
║  │ days_to_deliver │ 14.8%│ 45       │ INT ✅   │ NO       │ ⚠️ WARN   │  ║
║  │ _dq_score       │  0%  │ 892      │ DEC ✅   │ NO       │ ✅ HEALTHY │  ║
║  └─────────────────┴──────┴──────────┴──────────┴──────────┴────────────┘  ║
║  * refund_amount 91.3% null is EXPECTED (most orders are not returned)      ║
║                                                                              ║
║  🔴 RISKS FLAGGED BY AGENT (4)                                               ║
║  ┌─────────────────────────────────────────────────────────────────────┐    ║
║  │ R1 [CRITICAL] net_revenue is NULL for 206,338 records (11.2%)      │    ║
║  │    This is a CDE. Yesterday's null rate was 0.3%. 37x increase.    │    ║
║  │    [Flag for Review ✓]  [Add Note]  [Suppress with reason]         │    ║
║  │                                                                     │    ║
║  │ R2 [CRITICAL] Row count 58% below yesterday (1.84M vs 4.39M)      │    ║
║  │    Possible incomplete pipeline run or source data truncation.     │    ║
║  │    [Flag for Review ✓]  [Add Note]  [Suppress with reason]         │    ║
║  │                                                                     │    ║
║  │ R3 [HIGH]     status column contains unknown values:               │    ║
║  │               'PEND_REVIEW' (1,204 rows), 'RTN_INIT' (882 rows)   │    ║
║  │               These are not in the approved status whitelist.      │    ║
║  │    [Flag for Review ✓]  [Add Note]  [Suppress with reason]         │    ║
║  │                                                                     │    ║
║  │ R4 [MEDIUM]   days_to_deliver null 14.8% — likely unshipped orders │    ║
║  │               Normal if order_date = today. Check distribution.    │    ║
║  │    [Flag for Review ✓]  [Add Note]  [Suppress with reason]         │    ║
║  └─────────────────────────────────────────────────────────────────────┘    ║
║                                                                              ║
║  [Proceed to Metadata Enrichment →]   [Run Rules on This Table]             ║
║  [Export Report]  [Share to Slack]   [+ Add Profiling Task]                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

### 💬 HUMAN QUERY — Ravi adds a note on R4

**Ravi types in the Add Note box for R4:**
> "days_to_deliver null is expected for same-day orders placed today (order_date = 2024-11-05). Suppress this risk for today's run only. Reason: business logic — delivery date not yet known at order time."

**System response:**
```
  ✅ Note saved. R4 suppressed for run date 2024-11-05.
  Suppression logged to audit trail: Ravi Kumar | 08:06 AM | reason provided.
  R4 will reactivate automatically in tomorrow's run.
```

---

### 💬 HUMAN QUERY — Ravi flags R1 and R2 as critical

**Ravi clicks [Flag for Review] on R1 and R2.**
**Then types in the task board:**
> "net_revenue nulls 11.2% — check if Bronze pipeline for orders ran before OMS extract completed today. Also check if row count drop is source-side."

```
  ✅ R1 flagged as CRITICAL — assigned to Ravi Kumar.
  ✅ R2 flagged as CRITICAL — assigned to Ravi Kumar.
  Task added to Task Board: "Investigate net_revenue null spike + row count drop"
```

---

## SCREEN 5 — DATA DICTIONARY & METADATA ENRICHMENT

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  METADATA ENRICHMENT — silver.orders_enriched                               ║
║  AI has generated descriptions for 15/17 columns. 2 need review.           ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  ┌───────────────┬──────────────────────────────────────┬──────┬─────────┐  ║
║  │ Column        │ AI Description                       │ CDE  │ Action  │  ║
║  ├───────────────┼──────────────────────────────────────┼──────┼─────────┤  ║
║  │ net_revenue   │ Net order revenue after discounts    │ ✅97 │ ✓ Appr  │  ║
║  │               │ and before refunds (USD). Primary    │      │ ✎ Edit  │  ║
║  │               │ metric for Finance P&L reporting.    │      │ ✗ Rejct │  ║
║  ├───────────────┼──────────────────────────────────────┼──────┼─────────┤  ║
║  │ gross_amount  │ Total order value before any         │ ✅94 │ ✓ Appr  │  ║
║  │               │ discounts are applied (USD).         │      │ ✎ Edit  │  ║
║  ├───────────────┼──────────────────────────────────────┼──────┼─────────┤  ║
║  │ status        │ Current lifecycle state of the       │ ⬜41 │ ✓ Appr  │  ║
║  │               │ order. Expected values: OPEN,        │      │ ✎ Edit  │  ║
║  │               │ PROCESSING, SHIPPED, DELIVERED,      │      │ Promote │  ║
║  │               │ CANCELLED, RETURNED.                 │      │ to CDE  │  ║
║  ├───────────────┼──────────────────────────────────────┼──────┼─────────┤  ║
║  │ discount_code │ Promotional voucher code applied     │ ⬜28 │ ✓ Appr  │  ║
║  │               │ at checkout. May be null if no       │      │ ✎ Edit  │  ║
║  │               │ promotion was used.                  │      │         │  ║
║  ├───────────────┼──────────────────────────────────────┼──────┼─────────┤  ║
║  │ _dq_score     │ ⚠️ NEEDS REVIEW: Internal metadata  │ ⬜12 │ ✎ Edit  │  ║
║  │               │ column — no business description     │      │ ✗ Rejct │  ║
║  │               │ generated. Confirm if this should    │      │         │  ║
║  │               │ be visible to business users.        │      │         │  ║
║  └───────────────┴──────────────────────────────────────┴──────┴─────────┘  ║
║                                                                              ║
║  CDEs CONFIRMED (4):  net_revenue  gross_amount  email  lifetime_revenue    ║
║  PENDING REVIEW (2):  status (promote?), _dq_score (internal only?)        ║
║                                                                              ║
║  PII TAGS:  email ✅ PII | full_name ✅ PII | phone ✅ PII                  ║
║                                                                              ║
║  [Bulk Approve All ✓ AI Descriptions]   [+ Add Column Manually]            ║
║  [Import from Data Catalog]             [Export Data Dictionary]            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

### 💬 HUMAN QUERY — Priya (Data Steward) edits net_revenue description

**Priya clicks [✎ Edit] on net_revenue.**
> "Change description to: Net order value after discounts applied, before refunds. Used in P&L, Finance Dashboard, and 3 ML revenue prediction models. Do not use gross_amount as a substitute."

**System response:**
```
  ✅ Description updated by Priya Sharma | 09:34 AM
  Audit: previous description archived. New description saved.
  [net_revenue] CDE score remains 97. Finance and ML tags added.
```

---

### 💬 HUMAN QUERY — Priya promotes status to CDE

**Priya clicks [Promote to CDE] on status.**
> "Reason: Unknown status codes in production have caused fulfilment SLA breaches twice this quarter. This column needs stricter monitoring."

```
  ✅ status promoted to CDE (score: 87) by Priya Sharma | 09:36 AM
  5 new HIGH-severity rules will be auto-suggested for status in Rule Studio.
  CDE registry updated. Audit trail logged.
```

---

## SCREEN 6 — RULE STUDIO

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  RULE STUDIO — silver.orders_enriched                                       ║
║  19 rules recommended by AI.  3 already active from previous run.          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  FILTER: [All Layers ▾] [All Severity ▾] [All Status ▾]    [+ Add Rule]   ║
║                                                                              ║
║  ┌────┬───────────────────────────────────────┬────────┬──────────┬───────┐ ║
║  │ #  │ Rule                                  │ Layer  │ Severity │ By    │ ║
║  ├────┼───────────────────────────────────────┼────────┼──────────┼───────┤ ║
║  │  1 │ net_revenue must NOT be NULL          │ Silver │ CRITICAL │  AI   │ ║
║  │    │ (CDE — 11.2% null spike today)        │        │          │       │ ║
║  │    │ Expression: net_revenue IS NOT NULL   │        │          │       │ ║
║  │    │  [✓ Approve]  [✎ Edit]  [✗ Reject]   │        │          │       │ ║
║  ├────┼───────────────────────────────────────┼────────┼──────────┼───────┤ ║
║  │  2 │ net_revenue must be >= 0              │ Silver │ HIGH     │  AI   │ ║
║  │    │ Expression: net_revenue >= 0          │        │          │       │ ║
║  │    │  [✓ Approve]  [✎ Edit]  [✗ Reject]   │        │          │       │ ║
║  ├────┼───────────────────────────────────────┼────────┼──────────┼───────┤ ║
║  │  3 │ status must be in approved list       │ Silver │ CRITICAL │  AI   │ ║
║  │    │ ('OPEN','PROCESSING','SHIPPED',       │        │          │       │ ║
║  │    │  'DELIVERED','CANCELLED','RETURNED',  │        │          │       │ ║
║  │    │  'REFUNDED')                          │        │          │       │ ║
║  │    │  [✓ Approve]  [✎ Edit]  [✗ Reject]   │        │          │       │ ║
║  ├────┼───────────────────────────────────────┼────────┼──────────┼───────┤ ║
║  │  4 │ gross_amount must be > 0              │ Silver │ HIGH     │  AI   │ ║
║  │    │ (CDE — no zero-value orders expected) │        │          │       │ ║
║  │    │  [✓ Approve]  [✎ Edit]  [✗ Reject]   │        │          │       │ ║
║  ├────┼───────────────────────────────────────┼────────┼──────────┼───────┤ ║
║  │  5 │ customer_id must exist in             │ Silver │ CRITICAL │  AI   │ ║
║  │    │ silver.customers_master               │        │          │       │ ║
║  │    │ (referential integrity check)         │        │          │       │ ║
║  │    │  [✓ Approve]  [✎ Edit]  [✗ Reject]   │        │          │       │ ║
║  ├────┼───────────────────────────────────────┼────────┼──────────┼───────┤ ║
║  │  6 │ net_revenue daily total must not      │ Gold   │ HIGH     │  AI   │ ║
║  │    │ deviate > 30% from 7-day rolling avg  │        │          │       │ ║
║  │    │  [✓ Approve]  [✎ Edit]  [✗ Reject]   │        │          │       │ ║
║  ├────┼───────────────────────────────────────┼────────┼──────────┼───────┤ ║
║  │  7 │ raw.oms_orders file must arrive       │  Raw   │ HIGH     │  AI   │ ║
║  │    │ by 05:30 AM daily                     │        │          │       │ ║
║  │    │  [✓ Approve]  [✎ Edit]  [✗ Reject]   │        │          │       │ ║
║  ├────┼───────────────────────────────────────┼────────┼──────────┼───────┤ ║
║  │ .. │ ... 12 more rules (MEDIUM / LOW) ...  │        │          │       │ ║
║  └────┴───────────────────────────────────────┴────────┴──────────┴───────┘ ║
║                                                                              ║
║  ┌─────────────────────────────────────────────────────────────────────┐    ║
║  │  🗣  NATURAL LANGUAGE → DQ RULE CONVERTER                          │    ║
║  │  Type a quality expectation in plain English:                       │    ║
║  │  ┌─────────────────────────────────────────────────────────────┐   │    ║
║  │  │ "A single order's net revenue should never exceed $25,000"  │   │    ║
║  │  └─────────────────────────────────────────────────────────────┘   │    ║
║  │  [Convert to Rule →]                                               │    ║
║  └─────────────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

### 💬 HUMAN QUERY — Ravi uses NL→DQ converter

**Ravi types:**
> "A single order's net revenue should never exceed $25,000"

**System generates:**

```
╔══════════════════════════════════════════════════════════════════════╗
║  GENERATED RULE — Review Before Approving                           ║
╠══════════════════════════════════════════════════════════════════════╣
║  Rule Name:   net_revenue_max_threshold                             ║
║  Table:       silver.orders_enriched                                ║
║  Layer:       Silver                                                ║
║  Column:      net_revenue                                           ║
║  Expression:  net_revenue <= 25000                                  ║
║  Severity:    HIGH                                                  ║
║  CDE Impact:  YES — net_revenue is a CDE                            ║
║                                                                     ║
║  WHY THIS RULE MAKES SENSE:                                         ║
║  Analysis of silver.orders_enriched shows 99.97% of orders have    ║
║  net_revenue < $25,000. The top 0.03% (552 orders) above this      ║
║  threshold are either bulk B2B orders (identifiable by channel=CORP)║
║  or likely data entry errors. Recommend excluding CORP channel or  ║
║  confirming the threshold is correct.                               ║
║                                                                     ║
║  SUGGESTED REFINEMENT:                                              ║
║  net_revenue <= 25000 AND channel != 'CORP'                        ║
║  (to exclude legitimate large corporate orders)                     ║
║                                                                     ║
║  [Approve As-Is]  [Approve with Refinement]  [Edit]  [Reject]      ║
╚══════════════════════════════════════════════════════════════════════╝
```

**Ravi clicks [Approve with Refinement].**

```
  ✅ Rule net_revenue_max_threshold approved by Ravi Kumar | 08:14 AM
  Expression: net_revenue <= 25000 AND channel != 'CORP'
  Added to active rule set for silver.orders_enriched.
```

---

### 💬 HUMAN QUERY — Ravi edits the status whitelist rule

**Ravi clicks [✎ Edit] on Rule #3.**
> "Add 'PEND_REVIEW' to the approved list — this is a new status code the OMS team introduced last week for orders under manual review."

**System updates:**

```
  Rule #3 updated:
  Old: status IN ('OPEN','PROCESSING','SHIPPED','DELIVERED','CANCELLED','RETURNED','REFUNDED')
  New: status IN ('OPEN','PROCESSING','SHIPPED','DELIVERED','CANCELLED','RETURNED','REFUNDED','PEND_REVIEW')
  Edited by: Ravi Kumar | 08:16 AM | Reason: new OMS status code per ticket OMS-2241
  Audit trail updated.
  Note: 'RTN_INIT' still NOT in whitelist — will flag as violation.
```

---

## SCREEN 7 — DQ EXECUTION RESULTS

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  DQ EXECUTION — Run #1108 — 2024-11-05  08:22 AM                           ║
║  Scope: ALL LAYERS  |  Rules run: 31  |  Duration: 2m 14s                  ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  LAYER SUMMARY                                                               ║
║  ┌──────────┬────────┬──────────┬──────────┬──────────┐                    ║
║  │ Layer    │ Rules  │ Passed   │ Failed   │ Score    │                    ║
║  ├──────────┼────────┼──────────┼──────────┼──────────┤                    ║
║  │ Raw      │   5    │   4      │  1 ⚠️    │ 82/100   │                    ║
║  │ Bronze   │   8    │   6      │  2 ⚠️    │ 75/100   │                    ║
║  │ Silver   │  14    │   9      │  5 ❌    │ 61/100   │                    ║
║  │ Gold     │   4    │   2      │  2 ⚠️    │ 68/100   │                    ║
║  └──────────┴────────┴──────────┴──────────┴──────────┘                    ║
║                                                                              ║
║  SILVER — silver.orders_enriched — CRITICAL FAILURES                        ║
║  ┌────┬──────────────────────────────┬─────────┬──────────┬────────────┐   ║
║  │ #  │ Rule                         │ Status  │ Fail Cnt │ Fail %     │   ║
║  ├────┼──────────────────────────────┼─────────┼──────────┼────────────┤   ║
║  │  1 │ net_revenue IS NOT NULL      │ ❌ FAIL │ 206,338  │ 11.2%      │   ║
║  │    │ Severity: CRITICAL  CDE: YES │         │          │ ↑ from 0.3%│   ║
║  │    │ [View Records] [Explain] [+Rule] [Escalate]       │            │   ║
║  ├────┼──────────────────────────────┼─────────┼──────────┼────────────┤   ║
║  │  2 │ status IN whitelist          │ ❌ FAIL │ 882      │  0.05%     │   ║
║  │    │ Severity: HIGH   CDE: YES    │         │          │            │   ║
║  │    │ Failing value: 'RTN_INIT'    │         │          │            │   ║
║  │    │ [View Records] [Explain] [+Rule] [Escalate]       │            │   ║
║  ├────┼──────────────────────────────┼─────────┼──────────┼────────────┤   ║
║  │  3 │ gross_amount > 0             │ ❌ FAIL │  147     │  0.008%    │   ║
║  │    │ Severity: HIGH   CDE: YES    │         │          │            │   ║
║  │    │ Values: 0.00 (92), -ve (55)  │         │          │            │   ║
║  │    │ [View Records] [Explain] [+Rule] [Escalate]       │            │   ║
║  ├────┼──────────────────────────────┼─────────┼──────────┼────────────┤   ║
║  │  4 │ net_revenue <= 25000         │ ✅ PASS │    0     │   0%       │   ║
║  ├────┼──────────────────────────────┼─────────┼──────────┼────────────┤   ║
║  │  5 │ customer_id FK exists        │ ✅ PASS │    0     │   0%       │   ║
║  └────┴──────────────────────────────┴─────────┴──────────┴────────────┘   ║
║                                                                              ║
║  RAW LAYER FAILURE                                                           ║
║  Rule: raw.wms_shipments file arrival by 05:30 AM                           ║
║  Status: ❌ FAIL — File arrived at 06:55 AM (85 mins late)                 ║
║                                                                              ║
║  BRONZE LAYER FAILURES                                                       ║
║  Rule: bronze.orders — total_amount cast success rate >= 99%                ║
║  Status: ❌ FAIL — 847 cast errors (0.046%) on total_amount column          ║
║                                                                              ║
║  Rule: bronze.orders — duplicate order_id count = 0                        ║
║  Status: ❌ FAIL — 23 duplicate order_ids found in today's load             ║
║                                                                              ║
║  [Download Full Results CSV]  [Share to Slack]  [Mark All Reviewed]        ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

### 💬 HUMAN QUERY — Ravi drills into net_revenue failed records

**Ravi clicks [View Records] on Rule #1.**

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  FAILED RECORDS — net_revenue IS NOT NULL — 206,338 records                 ║
║  Showing 20 of 206,338                     [Download All]  [Back]          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  order_id        customer_id  order_date   status      gross_amount  net_rev║
║  ─────────────── ──────────── ──────────── ─────────── ────────────  ───────║
║  ORD-2024-88821  CUST-441122  2024-11-05   PROCESSING  142.50        NULL   ║
║  ORD-2024-88822  CUST-002341  2024-11-05   OPEN        89.99         NULL   ║
║  ORD-2024-88823  CUST-998812  2024-11-05   OPEN        204.00        NULL   ║
║  ORD-2024-88824  CUST-112233  2024-11-05   PROCESSING  67.50         NULL   ║
║  ORD-2024-88825  CUST-554411  2024-11-05   OPEN        310.00        NULL   ║
║  ... 206,333 more rows ...                                                   ║
║                                                                              ║
║  PATTERN ANALYSIS:                                                           ║
║  • 100% of null net_revenue rows have order_date = 2024-11-05               ║
║  • gross_amount is populated for all null net_revenue rows ✅                ║
║  • channel distribution: WEB 58%, APP 31%, STORE 11% (normal)               ║
║  • All regions affected proportionally                                       ║
║                                                                              ║
║  🤖 AI INSIGHT:                                                              ║
║  All null net_revenue records are from today (2024-11-05).                  ║
║  gross_amount is populated, meaning source data arrived but the             ║
║  discount calculation step in the Silver pipeline failed or was             ║
║  skipped. This is NOT a source data problem — it is a pipeline step        ║
║  failure in the Silver transformation for order_date = today.              ║
║                                                                              ║
║  [Add Note]  [Mark as Expected]  [Escalate to Pipeline Owner]              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

**Ravi says**: "Ah. gross_amount is fine, net_revenue is null — it's the discount calculation step that broke. Not a source issue."

**Ravi clicks [Escalate to Pipeline Owner] and types:**
> "Silver pipeline discount calc step failed for order_date = 2024-11-05. gross_amount populated but net_revenue = NULL for all today's orders (206K records). Re-run Silver pipeline with fix for discount_amount join."

```
  ✅ Escalated to: Deepa Nair (Silver Pipeline Owner)
  Slack notification sent. Ticket created: DQ-2024-1108-001
  ETA requested: 30 minutes.
```

---

## SCREEN 8 — ANOMALY INBOX

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  ANOMALY INBOX — 4 Active Anomalies       Last scan: 08:22 AM              ║
║  [Run Full Scan Now]   [Configure Thresholds]   [Filter: All ▾]            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🔴 CRITICAL — Volume Anomaly                              08:03 AM         ║
║  silver.orders_enriched: Row count 1,842,300 today                         ║
║  vs 7-day average 4,312,880 (↓ 57.3% — threshold: ±25%)                   ║
║  ─────────────────────────────────────────────────────────────────────────  ║
║  7-day history:  4.4M | 4.2M | 4.5M | 4.1M | 4.3M | 4.4M | TODAY: 1.8M   ║
║                  ████   ████   ████   ████   ████   ████   ██              ║
║  ─────────────────────────────────────────────────────────────────────────  ║
║  [Investigate] [Explain in Business Terms] [Acknowledge] [Escalate]        ║
║                                                                              ║
║  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   ║
║                                                                              ║
║  🟠 HIGH — Source Non-Arrival                              07:01 AM         ║
║  raw.wms_shipments: Expected by 05:30 AM — arrived 06:55 AM (85 min late)  ║
║  Carrier feed from WMS affected: 4 downstream Silver tables                ║
║  ─────────────────────────────────────────────────────────────────────────  ║
║  [Investigate] [Explain in Business Terms] [Acknowledge] [Escalate]        ║
║                                                                              ║
║  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   ║
║                                                                              ║
║  🟡 MEDIUM — Segment Anomaly                               08:05 AM         ║
║  silver.orders_enriched: status = 'RTN_INIT' appears ONLY in               ║
║  region = 'Northeast' (882 rows). Other regions: 0 rows.                   ║
║  Possible regional OMS deployment issue or data truncation.                 ║
║  ─────────────────────────────────────────────────────────────────────────  ║
║  [Investigate] [Explain in Business Terms] [Acknowledge]                   ║
║                                                                              ║
║  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   ║
║                                                                              ║
║  🟡 MEDIUM — Distribution Drift                            08:08 AM         ║
║  gold.daily_revenue_summary: return_rate_pct today = 8.4%                  ║
║  vs 7-day avg = 2.1% (4x increase — IQR threshold breach)                  ║
║  ─────────────────────────────────────────────────────────────────────────  ║
║  [Investigate] [Explain in Business Terms] [Acknowledge]                   ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

### 💬 HUMAN QUERY — Ravi clicks [Explain in Business Terms] on Volume Anomaly

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  📋 BUSINESS EXPLANATION — Volume Anomaly — silver.orders_enriched          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  WHAT HAPPENED                                                               ║
║  Today's order dataset contains 1.84 million records — 57% fewer than the  ║
║  daily average of 4.3 million. In practical terms, over 2.5 million order  ║
║  records that should exist in today's Silver layer are missing.             ║
║                                                                              ║
║  WHERE                                                                       ║
║  Layer: Silver  |  Table: orders_enriched  |  Date: 2024-11-05              ║
║                                                                              ║
║  LIKELY ROOT CAUSE                                                           ║
║  Two contributing factors were identified:                                  ║
║  1. The OMS source extract (raw.oms_orders) arrived at 06:55 AM, 85        ║
║     minutes after the Bronze pipeline started at 05:35 AM. The Bronze      ║
║     pipeline loaded only the partial extract before the rest arrived.       ║
║  2. The Silver net_revenue calculation step failed, causing 206K records   ║
║     to have null net_revenue — those records were filtered out of the      ║
║     Silver output by a downstream data contract filter.                     ║
║                                                                              ║
║  BUSINESS IMPACT                                                             ║
║  • The Finance Daily Revenue Dashboard is currently showing revenue based  ║
║    on only 42% of today's orders. Numbers are significantly understated.   ║
║  • 3 ML models consuming silver.orders_enriched have incomplete training   ║
║    data for today.                                                          ║
║  • The Operations Fulfilment SLA report is also affected.                  ║
║                                                                             ║
║  ESTIMATED REVENUE UNDERCOUNT                                               ║
║  Based on average order value ($87.40), the missing 2.54M orders           ║
║  represent approximately $221.9M in unrecorded gross revenue today.        ║
║                                                                             ║
║  RECOMMENDED ACTIONS                                                         ║
║  1. Confirm OMS extract completed fully (check raw.oms_orders row count    ║
║     vs yesterday — expect ~4.4M rows)                                      ║
║  2. Re-run Bronze orders pipeline for 2024-11-05                           ║
║  3. Fix Silver net_revenue calculation step and re-run Silver pipeline      ║
║  4. Re-run Gold revenue summary for 2024-11-05 after Silver is healthy     ║
║  5. Notify Finance team not to publish today's dashboard until resolved    ║
║                                                                             ║
║  ESTIMATED RESOLUTION TIME:  45–90 minutes                                 ║
║                                                                             ║
║  [Accept & Assign]  [Share to Slack]  [Send to Finance Team]               ║
║  [✎ Edit Explanation]   [Add to Incident Log]                               ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

### 💬 HUMAN QUERY — Sunita (Finance Analyst) raises a concern at 10:15 AM

**Sunita opens the system and types in the Task Board:**
> "The Finance Dashboard is showing total revenue of $160M for today. Yesterday was $378M. Is this a data issue or is business actually down? I need to present to the CFO at 11 AM."

**System routes to Ravi. Ravi responds in the Task Board:**
> "Sunita — yes, confirmed data issue. Pipeline re-run in progress. DO NOT publish the 11 AM report. We expect Silver to be healthy by 10:50 AM. I'll ping you when Gold re-runs. The actual revenue will be in the $360–380M range once fixed."

```
  Task logged: "Block Finance Dashboard publish until pipeline resolved"
  Assigned: Ravi Kumar → Sunita Reddy
  Status: IN PROGRESS
  ETA: 10:50 AM
```

---

## SCREEN 9 — TRUST DASHBOARD (Three Views)

### 9A — EXECUTIVE / BUSINESS VIEW

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  📊 DATA TRUST REPORT — RetailCo Platform — 2024-11-05                     ║
║                    BUSINESS SUMMARY VIEW                                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  OVERALL DATA TRUST SCORE TODAY                                              ║
║  ┌──────────────────────────────────────────────────────────────────────┐   ║
║  │                                                                      │   ║
║  │           69 / 100        ▼ 8 points from yesterday (77)            │   ║
║  │                                                                      │   ║
║  │  ████████████████████████████████████░░░░░░░░░░░░░░                 │   ║
║  │  ◄─────────────── 69% ─────────────►                                │   ║
║  │                                                                      │   ║
║  └──────────────────────────────────────────────────────────────────────┘   ║
║                                                                              ║
║  WHAT THIS MEANS FOR YOUR BUSINESS TODAY                                     ║
║  ┌──────────────────────────────────────────────────────────────────────┐   ║
║  │  ❌ Finance Revenue Dashboard is UNRELIABLE — DO NOT PUBLISH        │   ║
║  │     Revenue is understated by est. $221M due to a pipeline issue.   │   ║
║  │     Fix in progress. Expected resolution: 10:50 AM.                 │   ║
║  │                                                                      │   ║
║  │  ⚠️  Fulfilment SLA Report may be incomplete                        │   ║
║  │     WMS shipment data arrived 85 minutes late today.                │   ║
║  │     Delivery status for some orders may be stale.                   │   ║
║  │                                                                      │   ║
║  │  ⚠️  Northeast Region orders: 882 orders with unknown status        │   ║
║  │     These orders are not tracked correctly in fulfilment.           │   ║
║  │     Operations team has been notified.                               │   ║
║  │                                                                      │   ║
║  │  ✅  Customer Master data: HEALTHY (Score: 80/100)                  │   ║
║  │  ✅  Product Catalog: HEALTHY (Score: 92/100)                       │   ║
║  └──────────────────────────────────────────────────────────────────────┘   ║
║                                                                              ║
║  TRUST SCORE — LAST 14 DAYS                                                  ║
║  100 ┤                                                                       ║
║   90 ┤    ╭──────────────────╮                                               ║
║   80 ┤────╯                  ╰──────────────╮         ╭──────╮              ║
║   70 ┤                                      ╰─────────╯      ╰── TODAY:69  ║
║   60 ┤                                                                       ║
║      Oct 23  Oct 25  Oct 27  Oct 29  Oct 31  Nov 1   Nov 3   Nov 5          ║
║                                                                              ║
║  IMPACTED BUSINESS AREAS         AREAS UNAFFECTED                           ║
║  ❌ Finance Reporting             ✅ Customer Intelligence                   ║
║  ❌ Revenue Analytics             ✅ Product Performance                     ║
║  ⚠️  Operations / Fulfilment      ✅ Marketing Segmentation                  ║
║  ⚠️  ML Revenue Models                                                       ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

### 9B — TECHNICAL / DATA ENGINEER VIEW

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  📊 DATA TRUST REPORT — TECHNICAL VIEW — 2024-11-05  08:22 AM              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  LAYER SCORECARD                                                             ║
║  ┌───────────┬───────┬────────────┬──────────┬────────────┬───────────┐    ║
║  │ Layer     │ Score │ Rules Run  │ Failed   │ Anomalies  │ Trend     │    ║
║  ├───────────┼───────┼────────────┼──────────┼────────────┼───────────┤    ║
║  │ Raw       │ 82    │ 5          │ 1        │ 1 (source) │ ↓ -3 pts  │    ║
║  │ Bronze    │ 75    │ 8          │ 2        │ 0          │ ↓ -5 pts  │    ║
║  │ Silver    │ 61    │ 14         │ 5        │ 2          │ ↓ -16 pts │    ║
║  │ Gold      │ 68    │ 4          │ 2        │ 1          │ ↓ -9 pts  │    ║
║  └───────────┴───────┴────────────┴──────────┴────────────┴───────────┘    ║
║                                                                              ║
║  COLUMN HEALTH — silver.orders_enriched (CDEs highlighted)                  ║
║  ┌───────────────────┬──────────┬──────────┬──────────────────────────┐    ║
║  │ Column            │ CDE      │ Score    │ Status                   │    ║
║  ├───────────────────┼──────────┼──────────┼──────────────────────────┤    ║
║  │ net_revenue       │ ✅ CDE   │  22/100  │ ❌ FAIL — 11.2% null    │    ║
║  │ gross_amount      │ ✅ CDE   │  98/100  │ ✅ Pass                  │    ║
║  │ status            │ ✅ CDE   │  94/100  │ ⚠️  0.05% invalid codes │    ║
║  │ customer_id       │          │  99/100  │ ✅ Pass                  │    ║
║  │ order_date        │          │ 100/100  │ ✅ Pass                  │    ║
║  └───────────────────┴──────────┴──────────┴──────────────────────────┘    ║
║                                                                              ║
║  RULE FAILURE TREND — silver.orders_enriched — LAST 7 DAYS                  ║
║  Failures ┤                                                                  ║
║      10 ┤                                               ████               ║
║       8 ┤                                               ████               ║
║       6 ┤                           ████                ████               ║
║       4 ┤   ████  ████  ████  ████  ████  ████          ████               ║
║       2 ┤   ████  ████  ████  ████  ████  ████          ████               ║
║       0 └───Oct30──Oct31──Nov1──Nov2──Nov3──Nov4──TODAY─────               ║
║  TODAY: 5 failures  (vs 7-day avg: 2.3)                                    ║
║                                                                              ║
║  OPEN ISSUES WITH ASSIGNED OWNERS                                            ║
║  ┌─────────────────────────────────────────────┬────────────┬──────────┐   ║
║  │ Issue                                        │ Owner      │ ETA      │   ║
║  ├─────────────────────────────────────────────┼────────────┼──────────┤   ║
║  │ Re-run Silver pipeline (net_revenue null)    │ Deepa Nair │ 10:50 AM │   ║
║  │ Investigate bronze duplicate orders (23)     │ Ravi Kumar │ Today    │   ║
║  │ Clarify RTN_INIT status code (OMS team)      │ Ravi Kumar │ This week│   ║
║  │ WMS feed SLA — raise with infra team         │ Ravi Kumar │ Today    │   ║
║  └─────────────────────────────────────────────┴────────────┴──────────┘   ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

### 9C — STEWARD / GOVERNANCE VIEW

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  📊 DATA TRUST REPORT — GOVERNANCE VIEW — 2024-11-05                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  CDE HEALTH MONITOR (5 CDEs registered)                                     ║
║  ┌──────────────────────┬──────────────────┬──────────┬──────────────────┐  ║
║  │ CDE                  │ Table            │ Status   │ Last Validated   │  ║
║  ├──────────────────────┼──────────────────┼──────────┼──────────────────┤  ║
║  │ net_revenue          │ silver.orders    │ ❌ FAIL  │ 08:22 AM today  │  ║
║  │ gross_amount         │ silver.orders    │ ✅ PASS  │ 08:22 AM today  │  ║
║  │ status               │ silver.orders    │ ⚠️ WARN  │ 08:22 AM today  │  ║
║  │ email                │ silver.customers │ ✅ PASS  │ Yesterday       │  ║
║  │ lifetime_revenue     │ silver.customers │ ✅ PASS  │ Yesterday       │  ║
║  └──────────────────────┴──────────────────┴──────────┴──────────────────┘  ║
║                                                                              ║
║  DICTIONARY COMPLETENESS                                                     ║
║  ┌───────────────┬──────────────┬───────────────────────────────────────┐   ║
║  │ Layer         │ Completeness │ Bar                                   │   ║
║  ├───────────────┼──────────────┼───────────────────────────────────────┤   ║
║  │ Raw           │ 48%          │ ████████████░░░░░░░░░░░░              │   ║
║  │ Bronze        │ 72%          │ ████████████████████░░░░░             │   ║
║  │ Silver        │ 91%          │ ████████████████████████████░         │   ║
║  │ Gold          │ 83%          │ ████████████████████████░░░░          │   ║
║  └───────────────┴──────────────┴───────────────────────────────────────┘   ║
║                                                                              ║
║  RULE COVERAGE (% of columns with at least 1 active rule)                   ║
║  Raw: 40%  |  Bronze: 65%  |  Silver: 88%  |  Gold: 75%                    ║
║                                                                              ║
║  RECENT AUDIT TRAIL                                                          ║
║  08:16  Ravi Kumar    EDIT    Rule #3 status whitelist — added PEND_REVIEW  ║
║  09:36  Priya Sharma  PROMOTE status → CDE (score 87)                       ║
║  09:34  Priya Sharma  EDIT    net_revenue description updated                ║
║  08:14  Ravi Kumar    APPROVE Rule: net_revenue_max_threshold (NL→DQ)       ║
║  08:06  Ravi Kumar    SUPPRESS R4 days_to_deliver (today only, with reason) ║
║                                                                              ║
║  [View Full Audit Trail]  [Export for Compliance]  [+ Add Governance Note] ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## SCREEN 10 — LIVE SCENARIO SIMULATION

*Reviewer at 11:00 AM says: "Show me what happens if the Northeast region stops sending order data entirely."*

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  🎬 LIVE SCENARIO SIMULATOR                                                 ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  REVIEWER SCENARIO:                                                          ║
║  ┌─────────────────────────────────────────────────────────────────────┐   ║
║  │ "What if the Northeast region stops sending order data entirely?"   │   ║
║  └─────────────────────────────────────────────────────────────────────┘   ║
║  [Inject This Scenario]                                                     ║
║                                                                              ║
║  ──────────────────────────────────────────────────────────────────────     ║
║  LIVE SYSTEM REACTION                                                        ║
║  ──────────────────────────────────────────────────────────────────────     ║
║                                                                              ║
║  ⏱ 00:00  Scenario injected.                                                ║
║           Script: DELETE silver.orders_enriched WHERE region='Northeast'   ║
║           Deleted: 841,200 rows (Northeast = 18.4% of avg daily volume)    ║
║                                                                              ║
║  ⏱ 00:31  Monitoring agent triggered incremental DQ scan                   ║
║                                                                              ║
║  ⏱ 00:58  🔴 ANOMALY DETECTED: Volume — silver.orders_enriched             ║
║           Northeast segment: 0 rows today vs avg 841,200                   ║
║           Severity: CRITICAL  (100% drop in segment)                       ║
║                                                                              ║
║  ⏱ 01:04  🔴 ANOMALY DETECTED: Cross-segment imbalance                     ║
║           Northeast share of total orders: 0% today vs avg 18.4%          ║
║           West + Central showing abnormal share spike as a result          ║
║                                                                              ║
║  ⏱ 01:09  🔴 RULE FAILURE: gold.daily_revenue_summary                      ║
║           net_revenue deviated 22% below 7-day avg                         ║
║           (Northeast contributes ~21% of daily revenue)                    ║
║                                                                              ║
║  ⏱ 01:13  📋 BUSINESS EXPLANATION GENERATED:                               ║
║           ╔═════════════════════════════════════════════════════════════╗  ║
║           ║  CRITICAL DATA TRUST ALERT — Regional Data Loss            ║  ║
║           ║                                                             ║  ║
║           ║  The Northeast region has sent zero orders today,          ║  ║
║           ║  compared to its daily average of 841,000. This is a       ║  ║
║           ║  100% data loss for that region and will cause:            ║  ║
║           ║  • Revenue undercount of approximately $73.5M              ║  ║
║           ║  • Northeast regional KPIs to show as zero                 ║  ║
║           ║  • Customer segmentation to miss 18% of daily customers    ║  ║
║           ║  • Fulfilment SLA for Northeast to appear as 100%          ║  ║
║           ║    (no orders = no SLA breach detected — false positive)  ║  ║
║           ║                                                             ║  ║
║           ║  Root cause: Northeast OMS source feed has not arrived.    ║  ║
║           ║  Downstream: 4 Gold tables, 2 dashboards, 1 ML model.     ║  ║
║           ║  Recommended action: Contact Northeast OMS team            ║  ║
║           ║  immediately and hold Gold re-run until resolved.          ║  ║
║           ╚═════════════════════════════════════════════════════════════╝  ║
║                                                                              ║
║  [Acknowledge Scenario]  [Reset to Clean State]  [Run Another Scenario]    ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## SCREEN 11 — HUMAN TASK BOARD (Full View)

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  HUMAN TASK BOARD                       [+ Add Task]   [Filter: All ▾]     ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  TODAY — OPEN                                                                ║
║  ┌──────┬──────────────────────────────────────────┬────────┬──────────────┐║
║  │ Prio │ Task                                     │ Owner  │ Status       │║
║  ├──────┼──────────────────────────────────────────┼────────┼──────────────┤║
║  │  🔴  │ Re-run Silver pipeline (net_revenue null) │ Deepa  │ IN PROGRESS  │║
║  │      │ Phase 4 | Layer: Silver | ETA: 10:50 AM  │ Nair   │ Started 10:05│║
║  ├──────┼──────────────────────────────────────────┼────────┼──────────────┤║
║  │  🔴  │ Block Finance Dashboard publish           │ Ravi → │ DONE ✅     │║
║  │      │ Until Silver re-run confirmed healthy     │ Sunita │ 10:07 AM    │║
║  ├──────┼──────────────────────────────────────────┼────────┼──────────────┤║
║  │  🟠  │ Investigate 23 duplicate order_ids        │ Ravi   │ OPEN        │║
║  │      │ Phase 4 | Layer: Bronze | Today           │        │             │║
║  ├──────┼──────────────────────────────────────────┼────────┼──────────────┤║
║  │  🟠  │ Confirm RTN_INIT status code with OMS     │ Ravi   │ OPEN        │║
║  │      │ Phase 3 | Is it valid? Add to whitelist?  │        │             │║
║  ├──────┼──────────────────────────────────────────┼────────┼──────────────┤║
║  │  🟠  │ Raise WMS feed SLA issue with infra team  │ Ravi   │ OPEN        │║
║  │      │ Phase 5 | Raw | file arriving 85 min late │        │             │║
║  ├──────┼──────────────────────────────────────────┼────────┼──────────────┤║
║  │  🟡  │ Review return rate spike (8.4% vs 2.1%)   │ Priya  │ OPEN        │║
║  │      │ Phase 5 | Gold | Distribution drift       │        │             │║
║  ├──────┼──────────────────────────────────────────┼────────┼──────────────┤║
║  │  🟢  │ Add rule coverage to Raw layer (40% → 70%)│ Ravi   │ BACKLOG     │║
║  │      │ Phase 3 | Long-term improvement           │        │             │║
║  └──────┴──────────────────────────────────────────┴────────┴──────────────┘║
║                                                                              ║
║  ── SUNITA added at 10:15 AM ─────────────────────────────────────────────  ║
║  │  🟠  │ Confirm final revenue number for CFO by   │ Ravi → │ IN PROGRESS │║
║  │      │ 11 AM | depends on Silver pipeline re-run │ Sunita │             │║
║  └──────┴──────────────────────────────────────────┴────────┴──────────────┘║
║                                                                              ║
║  [Export Task Summary]  [Sync to Jira]  [Send Daily Digest]                ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## SCREEN 12 — END OF DAY: DATA TRUST SUMMARY REPORT

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  📋 DATA TRUST DAILY SUMMARY — RetailCo — 2024-11-05                       ║
║  Generated: 11:05 AM  |  Pipeline Status: RECOVERING ⚠️                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  OVERALL QUALITY SCORE: 69 / 100  ▼ from 77 yesterday                      ║
║                                                                              ║
║  TOP ISSUES (resolved and open)                                              ║
║  ┌───┬────────────────────────────────────────────┬──────────┬──────────┐  ║
║  │ # │ Issue                                      │ Severity │ Status   │  ║
║  ├───┼────────────────────────────────────────────┼──────────┼──────────┤  ║
║  │ 1 │ net_revenue NULL for 206K records (11.2%)  │ CRITICAL │ FIXING   │  ║
║  │   │ Silver pipeline discount calc step failed  │          │ ETA 10:50│  ║
║  ├───┼────────────────────────────────────────────┼──────────┼──────────┤  ║
║  │ 2 │ Row count 57% below avg (1.84M vs 4.3M)   │ CRITICAL │ FIXING   │  ║
║  │   │ Caused by early pipeline + null filter     │          │ ETA 10:50│  ║
║  ├───┼────────────────────────────────────────────┼──────────┼──────────┤  ║
║  │ 3 │ WMS shipment feed 85 mins late             │ HIGH     │ OPEN     │  ║
║  │   │ Downstream delivery status data stale      │          │ Infra    │  ║
║  ├───┼────────────────────────────────────────────┼──────────┼──────────┤  ║
║  │ 4 │ status='RTN_INIT' — 882 unknown codes      │ HIGH     │ OPEN     │  ║
║  │   │ Northeast region only — OMS clarification  │          │ Ravi     │  ║
║  ├───┼────────────────────────────────────────────┼──────────┼──────────┤  ║
║  │ 5 │ 23 duplicate order_ids in Bronze           │ MEDIUM   │ OPEN     │  ║
║  │   │ Dedup logic review needed                  │          │ Ravi     │  ║
║  └───┴────────────────────────────────────────────┴──────────┴──────────┘  ║
║                                                                              ║
║  ANOMALY SUMMARY (4 detected today)                                          ║
║  🔴 Volume: orders_enriched −57%        → Pipeline re-run in progress       ║
║  🟠 Source: WMS feed 85 min late        → Raised with infra team            ║
║  🟡 Segment: RTN_INIT in Northeast      → OMS team notified                 ║
║  🟡 Drift: return_rate 4x above avg     → Under investigation               ║
║                                                                              ║
║  CDE STATUS                                                                  ║
║  net_revenue     ❌ FAIL — pipeline issue (fixing)                          ║
║  gross_amount    ✅ PASS                                                     ║
║  status          ⚠️ 882 invalid records                                     ║
║  email           ✅ PASS                                                     ║
║  lifetime_revenue ✅ PASS                                                    ║
║                                                                              ║
║  IMPACTED AREAS                                                              ║
║  ❌ Finance Daily Revenue Dashboard — DO NOT PUBLISH                         ║
║  ⚠️  Fulfilment SLA Report — partial data                                   ║
║  ⚠️  ML Revenue Models — operating on incomplete data                       ║
║                                                                              ║
║  HUMAN DECISIONS TODAY (7)                                                   ║
║  ✅ Suppressed R4 (days_to_deliver) — expected null today                   ║
║  ✅ Updated net_revenue description (Priya)                                  ║
║  ✅ Promoted status to CDE (Priya)                                           ║
║  ✅ Approved net_revenue_max_threshold rule (NL→DQ)                          ║
║  ✅ Edited status whitelist — added PEND_REVIEW                              ║
║  ✅ Escalated pipeline failure to Deepa Nair                                 ║
║  ✅ Blocked Finance Dashboard publish (Sunita notified)                      ║
║                                                                              ║
║  RECOMMENDED ACTIONS FOR TOMORROW                                            ║
║  1. Implement Bronze pipeline dependency check — wait for full OMS extract  ║
║  2. Fix Silver net_revenue null filter — don't drop records silently        ║
║  3. Add WMS SLA monitoring rule — alert if file > 30 min late               ║
║  4. Resolve RTN_INIT status code with OMS team                              ║
║  5. Review return rate spike — is this real or a data quality artifact?     ║
║                                                                              ║
║  [Export PDF Report]  [Share to Slack #data-quality]  [Email to Stakeholders]║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## PART C — QUALITY REPORT CARD (Printable Summary)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│              RETAILCO DATA QUALITY REPORT CARD — 2024-11-05                 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PLATFORM: Snowflake    LAYERS: Raw → Bronze → Silver → Gold                │
│  RUN: #1108    STARTED: 06:03 AM    COMPLETED: 08:22 AM                     │
│                                                                              │
├──────────────────────────────┬───────────────────────────────────────────────┤
│  LAYER          SCORE        │  RAW FINDINGS                                │
├──────────────────────────────┤                                              │
│  Raw            82 / 100  ⚠️ │  5 rules run. 1 failure: WMS file 85 min   │
│  Bronze         75 / 100  ⚠️ │  late. Source monitoring: ACTIVE.           │
│  Silver         61 / 100  ❌ │                                              │
│  Gold           68 / 100  ⚠️ │  BRONZE FINDINGS                            │
│                              │  8 rules run. 2 failures: 847 cast errors   │
│  OVERALL        69 / 100  ⚠️ │  on total_amount, 23 duplicate order_ids.  │
│                              │                                              │
├──────────────────────────────┤  SILVER FINDINGS                            │
│  CDEs TOTAL:    5            │  14 rules run. 5 failures. net_revenue       │
│  CDEs HEALTHY:  3  ✅        │  NULL critical (206K rows). status 882 bad   │
│  CDEs AT RISK:  1  ⚠️        │  codes. gross_amount 147 zero-value rows.   │
│  CDEs FAILED:   1  ❌        │                                              │
│                              │  GOLD FINDINGS                               │
├──────────────────────────────┤  4 rules run. 2 failures. Revenue 22%        │
│  RULES TOTAL:   31           │  below 7-day avg. Return rate 4x avg.        │
│  RULES PASSED:  21  (68%)    │                                              │
│  RULES FAILED:  10  (32%)    │  ANOMALIES                                   │
│                              │  4 detected: 1 Critical (volume), 1 High    │
├──────────────────────────────┤  (source), 2 Medium (segment, drift).        │
│  ANOMALIES:     4            │                                              │
│  CRITICAL:      1            │  HUMAN ACTIONS                               │
│  HIGH:          1            │  7 decisions logged to audit trail.          │
│  MEDIUM:        2            │  0 rules auto-activated without review.      │
│  LOW:           0            │  All escalations sent within 5 minutes.      │
│                              │                                              │
│  OPEN TASKS:    6            │  NEXT RUN: 06:03 AM tomorrow                │
└──────────────────────────────┴───────────────────────────────────────────────┘
```

---

*One coherent story. One real domain. Every screen connected.
This is what a Senior DE actually builds — not demos, not slides.*
