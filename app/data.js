// DataTrust — RetailCo seed data. One coherent story: Tuesday, 5 Nov 2024.
// Loaded as a plain script; exposed as window.DT.
window.DT = (function () {
  const today = "2024-11-05";

  // ---- Dataset browse tree (by layer) ----
  const datasets = [
    { layer: "RAW", tables: [
      { name: "raw.crm_customers", rows: "1.21M", profiled: "Yesterday", score: 88 },
      { name: "raw.oms_orders",    rows: "4.39M", profiled: "Yesterday", score: 91 },
      { name: "raw.oms_order_items", rows: "9.8M", profiled: "Yesterday", score: 90 },
      { name: "raw.wms_shipments", rows: "3.9M",  profiled: "2 hrs ago", score: 79 },
      { name: "raw.erp_payments",  rows: "4.1M",  profiled: "Yesterday", score: 86 },
      { name: "raw.erp_refunds",   rows: "184K",  profiled: "Yesterday", score: 92 },
    ]},
    { layer: "BRONZE", tables: [
      { name: "bronze.customers",   rows: "1.20M", profiled: "Yesterday", score: 84 },
      { name: "bronze.orders",      rows: "4.38M", profiled: "2 hrs ago", score: 75 },
      { name: "bronze.order_items", rows: "9.7M",  profiled: "Yesterday", score: 88 },
      { name: "bronze.shipments",   rows: "3.8M",  profiled: "2 hrs ago", score: 81 },
      { name: "bronze.payments",    rows: "4.0M",  profiled: "Yesterday", score: 87 },
    ]},
    { layer: "SILVER", tables: [
      { name: "silver.orders_enriched",  rows: "1.84M", profiled: "2 hrs ago", score: 61, hot: true },
      { name: "silver.customers_master", rows: "1.19M", profiled: "Yesterday", score: 80 },
      { name: "silver.product_catalog",  rows: "48.2K", profiled: "Yesterday", score: 92 },
    ]},
    { layer: "GOLD", tables: [
      { name: "gold.daily_revenue_summary", rows: "364", profiled: "1 hr ago", score: 68 },
      { name: "gold.customer_segments",     rows: "2.9K", profiled: "Yesterday", score: 85 },
      { name: "gold.product_performance",   rows: "48.2K", profiled: "Yesterday", score: 90 },
    ]},
  ];

  // ---- Profiling: live agent steps ----
  const profileSteps = [
    { label: "Row count & volume scan", detail: "1,842,300 rows detected" },
    { label: "Schema validation", detail: "17 columns matched expected" },
    { label: "Null analysis per column", detail: "3 columns flagged" },
    { label: "Cardinality & distinct analysis", detail: "completed" },
    { label: "Format pattern detection", detail: "2 columns mixed formats" },
    { label: "Duplicate detection", detail: "order_id + customer_id" },
    { label: "Statistical distribution", detail: "completed" },
    { label: "Cross-layer FK validation", detail: "customer_id → customers_master" },
    { label: "Volume delta vs. yesterday", detail: "↓ 58% — flagged" },
    { label: "Risk scoring", detail: "4 risks surfaced" },
  ];

  // ---- Profiling report ----
  const profileSummary = [
    { k: "Total Rows", v: "1,842,300", note: "↓ 58% vs yesterday 4,385,100", bad: true },
    { k: "Duplicate order_id", v: "0", ok: true },
    { k: "Fully null rows", v: "0", ok: true },
    { k: "Last updated", v: "06:03 AM", note: "SLA: before 07:00", ok: true },
    { k: "Completeness score", v: "72%", bad: true },
    { k: "Uniqueness score", v: "100%", ok: true },
    { k: "Validity score", v: "84%", warn: true },
  ];

  const columns = [
    { name: "order_id",        nullPct: 0,    distinct: "1,842,300", format: "UUID", cde: false, health: "HEALTHY", score: 100 },
    { name: "customer_id",     nullPct: 0.1,  distinct: "912,441",   format: "UUID", cde: false, health: "HEALTHY", score: 99 },
    { name: "order_date",      nullPct: 0,    distinct: "364",       format: "DATE", cde: false, health: "HEALTHY", score: 100 },
    { name: "status",          nullPct: 0,    distinct: "7",         format: "mixed", cde: true,  health: "WARN", score: 94 },
    { name: "gross_amount",    nullPct: 0,    distinct: "184,221",   format: "DEC",  cde: true,  health: "HEALTHY", score: 98 },
    { name: "discount_amount", nullPct: 8.2,  distinct: "2,341",     format: "DEC",  cde: false, health: "WARN", score: 78 },
    { name: "net_revenue",     nullPct: 11.2, distinct: "184,010",   format: "DEC",  cde: true,  health: "CRIT", score: 22 },
    { name: "channel",         nullPct: 0,    distinct: "3",         format: "OK",   cde: false, health: "HEALTHY", score: 100 },
    { name: "region",          nullPct: 3.1,  distinct: "8",         format: "OK",   cde: false, health: "WARN", score: 84 },
    { name: "loyalty_tier",    nullPct: 4.7,  distinct: "4",         format: "OK",   cde: false, health: "WARN", score: 82 },
    { name: "has_payment",     nullPct: 0,    distinct: "2",         format: "BOOL", cde: false, health: "HEALTHY", score: 100 },
    { name: "is_returned",     nullPct: 0,    distinct: "2",         format: "BOOL", cde: false, health: "HEALTHY", score: 100 },
    { name: "refund_amount",   nullPct: 91.3, distinct: "8,441",     format: "DEC",  cde: false, health: "OK", score: 95, note: "91.3% null is EXPECTED (most orders not returned)" },
    { name: "days_to_deliver", nullPct: 14.8, distinct: "45",        format: "INT",  cde: false, health: "WARN", score: 80 },
    { name: "_dq_score",       nullPct: 0,    distinct: "892",       format: "DEC",  cde: false, health: "HEALTHY", score: 100 },
  ];

  const risks = [
    { id: "R1", sev: "CRITICAL", title: "net_revenue is NULL for 206,338 records (11.2%)",
      body: "This is a CDE. Yesterday's null rate was 0.3%. A 37× increase.", col: "net_revenue" },
    { id: "R2", sev: "CRITICAL", title: "Row count 58% below yesterday (1.84M vs 4.39M)",
      body: "Possible incomplete pipeline run or source data truncation.", col: "—" },
    { id: "R3", sev: "HIGH", title: "status column contains unknown values",
      body: "'PEND_REVIEW' (1,204 rows), 'RTN_INIT' (882 rows) — not in approved whitelist.", col: "status" },
    { id: "R4", sev: "MEDIUM", title: "days_to_deliver null 14.8% — likely unshipped orders",
      body: "Normal if order_date = today. Check distribution before flagging.", col: "days_to_deliver" },
  ];

  // ---- Metadata enrichment ----
  const metadata = [
    { col: "net_revenue", desc: "Net order revenue after discounts and before refunds (USD). Primary metric for Finance P&L reporting.", cde: true, cdeScore: 97, status: "approved" },
    { col: "gross_amount", desc: "Total order value before any discounts are applied (USD).", cde: true, cdeScore: 94, status: "approved" },
    { col: "status", desc: "Current lifecycle state of the order. Expected: OPEN, PROCESSING, SHIPPED, DELIVERED, CANCELLED, RETURNED.", cde: false, cdeScore: 41, status: "review", canPromote: true },
    { col: "discount_code", desc: "Promotional voucher code applied at checkout. May be null if no promotion was used.", cde: false, cdeScore: 28, status: "pending" },
    { col: "customer_id", desc: "Unique customer identifier linked to the CRM master record.", cde: false, cdeScore: 55, status: "pending" },
    { col: "region", desc: "Customer's sales region, joined from the customer master (8 regions).", cde: false, cdeScore: 38, status: "pending" },
    { col: "_dq_score", desc: "Internal metadata column — no business description generated. Confirm if visible to business users.", cde: false, cdeScore: 12, status: "needs-review", internal: true },
  ];

  const cdes = [
    { name: "net_revenue", table: "silver.orders_enriched", status: "FAIL", validated: "08:22 AM today" },
    { name: "gross_amount", table: "silver.orders_enriched", status: "PASS", validated: "08:22 AM today" },
    { name: "status", table: "silver.orders_enriched", status: "WARN", validated: "08:22 AM today" },
    { name: "email", table: "silver.customers_master", status: "PASS", validated: "Yesterday" },
    { name: "lifetime_revenue", table: "silver.customers_master", status: "PASS", validated: "Yesterday" },
  ];

  // ---- Rules ----
  const rules = [
    { id: 1, name: "net_revenue must NOT be NULL", expr: "net_revenue IS NOT NULL", note: "CDE — 11.2% null spike today", layer: "SILVER", sev: "CRITICAL", by: "AI", status: "pending" },
    { id: 2, name: "net_revenue must be >= 0", expr: "net_revenue >= 0", layer: "SILVER", sev: "HIGH", by: "AI", status: "pending" },
    { id: 3, name: "status must be in approved list", expr: "status IN ('OPEN','PROCESSING','SHIPPED','DELIVERED','CANCELLED','RETURNED','REFUNDED')", layer: "SILVER", sev: "CRITICAL", by: "AI", status: "pending" },
    { id: 4, name: "gross_amount must be > 0", expr: "gross_amount > 0", note: "CDE — no zero-value orders expected", layer: "SILVER", sev: "HIGH", by: "AI", status: "pending" },
    { id: 5, name: "customer_id FK must exist in customers_master", expr: "customer_id IN (SELECT customer_id FROM silver.customers_master)", layer: "SILVER", sev: "CRITICAL", by: "AI", status: "pending" },
    { id: 6, name: "net_revenue daily total within ±30% of 7-day avg", expr: "ABS(sum(net_revenue) - avg_7d) / avg_7d <= 0.30", layer: "GOLD", sev: "HIGH", by: "AI", status: "pending" },
    { id: 7, name: "raw.oms_orders file must arrive by 05:30 AM", expr: "arrival_time <= '05:30:00'", layer: "RAW", sev: "HIGH", by: "AI", status: "pending" },
    { id: 8, name: "discount_amount null rate below 5%", expr: "null_pct(discount_amount) < 0.05", layer: "SILVER", sev: "MEDIUM", by: "AI", status: "pending" },
    { id: 9, name: "order_date must equal a valid calendar date", expr: "order_date IS NOT NULL AND order_date <= CURRENT_DATE", layer: "SILVER", sev: "MEDIUM", by: "AI", status: "active" },
    { id: 10, name: "channel in ('WEB','APP','STORE')", expr: "channel IN ('WEB','APP','STORE')", layer: "SILVER", sev: "LOW", by: "AI", status: "active" },
    { id: 11, name: "bronze.orders dedup on order_id", expr: "count(*) = count(distinct order_id)", layer: "BRONZE", sev: "HIGH", by: "AI", status: "active" },
    { id: 12, name: "loyalty_tier in approved tiers", expr: "loyalty_tier IN ('BRONZE','SILVER','GOLD','PLATINUM')", layer: "SILVER", sev: "LOW", by: "AI", status: "pending" },
  ];

  // ---- Execution results ----
  const layerScores = [
    { layer: "RAW", rules: 5, passed: 4, failed: 1, score: 82, trend: -3, anomalies: 1 },
    { layer: "BRONZE", rules: 8, passed: 6, failed: 2, score: 75, trend: -5, anomalies: 0 },
    { layer: "SILVER", rules: 14, passed: 9, failed: 5, score: 61, trend: -16, anomalies: 2 },
    { layer: "GOLD", rules: 4, passed: 2, failed: 2, score: 68, trend: -9, anomalies: 1 },
  ];

  const execResults = [
    { id: 1, rule: "net_revenue IS NOT NULL", status: "FAIL", failCnt: "206,338", failPct: 11.2, sev: "CRITICAL", cde: true, delta: "↑ from 0.3%", layer: "SILVER" },
    { id: 2, rule: "status IN whitelist", status: "FAIL", failCnt: "882", failPct: 0.05, sev: "HIGH", cde: true, note: "Failing value: 'RTN_INIT'", layer: "SILVER" },
    { id: 3, rule: "gross_amount > 0", status: "FAIL", failCnt: "147", failPct: 0.008, sev: "HIGH", cde: true, note: "0.00 (92), negative (55)", layer: "SILVER" },
    { id: 4, rule: "net_revenue <= 25000 AND channel != 'CORP'", status: "PASS", failCnt: "0", failPct: 0, sev: "—", layer: "SILVER" },
    { id: 5, rule: "customer_id FK exists", status: "PASS", failCnt: "0", failPct: 0, sev: "—", layer: "SILVER" },
    { id: 6, rule: "raw.wms_shipments arrival by 05:30 AM", status: "FAIL", failCnt: "—", failPct: 0, sev: "HIGH", note: "Arrived 06:55 AM (85 min late)", layer: "RAW" },
    { id: 7, rule: "bronze.orders total_amount cast success ≥ 99%", status: "FAIL", failCnt: "847", failPct: 0.046, sev: "MEDIUM", layer: "BRONZE" },
    { id: 8, rule: "bronze.orders duplicate order_id = 0", status: "FAIL", failCnt: "23", failPct: 0.0005, sev: "MEDIUM", layer: "BRONZE" },
    { id: 9, rule: "gold.daily_revenue within ±30% of 7-day avg", status: "FAIL", failCnt: "1", failPct: 0, sev: "HIGH", note: "22% below 7-day avg", layer: "GOLD" },
  ];

  const failedRecords = [
    { order_id: "ORD-2024-88821", customer_id: "CUST-441122", order_date: today, status: "PROCESSING", gross: "142.50", net: null },
    { order_id: "ORD-2024-88822", customer_id: "CUST-002341", order_date: today, status: "OPEN", gross: "89.99", net: null },
    { order_id: "ORD-2024-88823", customer_id: "CUST-998812", order_date: today, status: "OPEN", gross: "204.00", net: null },
    { order_id: "ORD-2024-88824", customer_id: "CUST-112233", order_date: today, status: "PROCESSING", gross: "67.50", net: null },
    { order_id: "ORD-2024-88825", customer_id: "CUST-554411", order_date: today, status: "OPEN", gross: "310.00", net: null },
    { order_id: "ORD-2024-88826", customer_id: "CUST-771290", order_date: today, status: "PROCESSING", gross: "55.20", net: null },
    { order_id: "ORD-2024-88827", customer_id: "CUST-330021", order_date: today, status: "OPEN", gross: "189.75", net: null },
    { order_id: "ORD-2024-88828", customer_id: "CUST-845512", order_date: today, status: "OPEN", gross: "428.00", net: null },
  ];

  // ---- Anomalies ----
  const anomalies = [
    { id: "A1", sev: "CRITICAL", type: "Volume Anomaly", table: "silver.orders_enriched", layer: "SILVER", time: "08:03 AM",
      desc: "Row count 1,842,300 today vs 7-day average 4,312,880 (↓ 57.3%, threshold ±25%)",
      history: [4.4, 4.2, 4.5, 4.1, 4.3, 4.4, 1.8], hasFingerprint: true },
    { id: "A2", sev: "HIGH", type: "Source Non-Arrival", table: "raw.wms_shipments", layer: "RAW", time: "07:01 AM",
      desc: "Expected by 05:30 AM — arrived 06:55 AM (85 min late). 4 downstream Silver tables affected.",
      history: null },
    { id: "A3", sev: "MEDIUM", type: "Segment Anomaly", table: "silver.orders_enriched", layer: "SILVER", time: "08:05 AM",
      desc: "status = 'RTN_INIT' appears ONLY in region = 'Northeast' (882 rows). Other regions: 0 rows.",
      history: null },
    { id: "A4", sev: "MEDIUM", type: "Distribution Drift", table: "gold.daily_revenue_summary", layer: "GOLD", time: "08:08 AM",
      desc: "return_rate_pct today = 8.4% vs 7-day avg = 2.1% (4× increase, IQR threshold breach).",
      history: null },
  ];

  // ---- Anomaly fingerprint matches ----
  const fingerprints = [
    { sim: 94, date: "2024-09-03", day: "Tuesday", cause: "OMS extract arrived at 06:48 AM. Bronze ran at 05:35 AM before extract completed. Discount join step had no rows to join — set net_revenue NULL for same-day orders.", resolution: "Re-ran Bronze + Silver pipelines.", time: "47 minutes", by: "Deepa Nair" },
    { sim: 81, date: "2024-07-16", day: "Tuesday", cause: "Same pattern. Also a Tuesday. OMS file was late.", resolution: "Same re-run approach.", time: "1h 12min", by: "Arjun Mehta" },
  ];

  // ---- Lineage / impact graph ----
  // Tiers left→right. Status: ok | warn | fail
  const impact = {
    source: { id: "silver.orders_enriched", label: "silver.orders_enriched", sub: "net_revenue · 11.2% NULL", status: "fail" },
    tiers: [
      { label: "GOLD", nodes: [
        { id: "g1", label: "gold.daily_revenue_summary", status: "fail", note: "Revenue understated $221M" },
        { id: "g2", label: "gold.customer_segments", status: "warn", note: "LTV calculations affected" },
      ]},
      { label: "REPORTS / MODELS", nodes: [
        { id: "r1", label: "Finance Dashboard", status: "fail", note: "DO NOT PUBLISH", from: "g1" },
        { id: "r2", label: "CFO Weekly Report", status: "warn", note: "Queued — hold", from: "g1" },
        { id: "m1", label: "ml.revenue_forecast_v3", status: "fail", note: "Training data incomplete", from: "g1" },
        { id: "m2", label: "ml.churn_predictor_v2", status: "warn", note: "Feature incomplete", from: "g2" },
        { id: "o1", label: "ops.fulfilment_sla", status: "warn", note: "Revenue SLA threshold wrong", from: "g1" },
      ]},
    ],
  };

  // ---- Trust score history (14 days) ----
  const trustHistory = [
    { label: "Oct 23", value: 84 }, { label: "Oct 25", value: 88 }, { label: "Oct 27", value: 86 },
    { label: "Oct 29", value: 81 }, { label: "Oct 31", value: 79 }, { label: "Nov 1", value: 82 },
    { label: "Nov 3", value: 77 }, { label: "Nov 5", value: 69 },
  ];
  const ruleFailTrend = [
    { label: "Oct 30", value: 4 }, { label: "Oct 31", value: 4 }, { label: "Nov 1", value: 4 },
    { label: "Nov 2", value: 4 }, { label: "Nov 3", value: 6 }, { label: "Nov 4", value: 4 }, { label: "Nov 5", value: 5 },
  ];

  // ---- Audit trail ----
  const audit = [
    { time: "08:16 AM", user: "Ravi Kumar", action: "EDIT", entity: "Rule #3 status whitelist — added PEND_REVIEW" },
    { time: "09:36 AM", user: "Priya Sharma", action: "PROMOTE", entity: "status → CDE (score 87)" },
    { time: "09:34 AM", user: "Priya Sharma", action: "EDIT", entity: "net_revenue description updated" },
    { time: "08:14 AM", user: "Ravi Kumar", action: "APPROVE", entity: "Rule: net_revenue_max_threshold (NL→DQ)" },
    { time: "08:06 AM", user: "Ravi Kumar", action: "SUPPRESS", entity: "R4 days_to_deliver (today only, with reason)" },
  ];

  // ---- Tasks ----
  const tasks = [
    { prio: "CRITICAL", title: "Re-run Silver pipeline (net_revenue null)", meta: "Phase 4 · Silver · ETA 10:50 AM", owner: "Deepa Nair", status: "IN PROGRESS" },
    { prio: "CRITICAL", title: "Block Finance Dashboard publish", meta: "Until Silver re-run confirmed healthy", owner: "Ravi → Sunita", status: "DONE" },
    { prio: "HIGH", title: "Investigate 23 duplicate order_ids", meta: "Phase 4 · Bronze · Today", owner: "Ravi Kumar", status: "OPEN" },
    { prio: "HIGH", title: "Confirm RTN_INIT status code with OMS", meta: "Phase 3 · Add to whitelist?", owner: "Ravi Kumar", status: "OPEN" },
    { prio: "HIGH", title: "Raise WMS feed SLA issue with infra team", meta: "Phase 5 · Raw · file 85 min late", owner: "Ravi Kumar", status: "OPEN" },
    { prio: "MEDIUM", title: "Review return rate spike (8.4% vs 2.1%)", meta: "Phase 5 · Gold · Distribution drift", owner: "Priya Sharma", status: "OPEN" },
    { prio: "LOW", title: "Add rule coverage to Raw layer (40% → 70%)", meta: "Phase 3 · Long-term", owner: "Ravi Kumar", status: "BACKLOG" },
  ];

  // ---- Pre-run advisory ----
  const advisory = {
    predicted: 71,
    reasons: [
      { risk: "high", text: "WMS shipment feed has arrived late on 3 of the last 5 Tuesdays. Today is Tuesday. File not yet seen." },
      { risk: "med", text: "OMS extract is 12% smaller than yesterday (arrived 05:15). Possible partial extract. Bronze dedup may flag duplicates." },
      { risk: "high", text: "Historical pattern: when OMS < 95% of yesterday's size, Silver net_revenue null rate averages 8.4% (vs normal 0.3%)." },
    ],
    rec: "Hold Bronze pipeline 20 minutes. Wait for WMS confirmation. If OMS extract does not grow in 15 min → alert pipeline owner.",
  };

  // ---- Trust receipt ----
  const receipt = {
    query: "SELECT * FROM gold.daily_revenue_summary",
    by: "Sunita Reddy", at: "2024-11-05 10:30 AM", rows: 1, score: 61,
    fields: [
      { name: "net_revenue", status: "fail", note: "based on 88% of today's orders. 12% missing revenue (pipeline issue, fix in progress — ETA 10:50 AM)." },
      { name: "gross_amount", status: "ok", note: "FULLY TRUSTED (100% complete, validated)" },
      { name: "total_orders", status: "ok", note: "FULLY TRUSTED" },
      { name: "return_rate_pct", status: "warn", note: "UNCERTAIN (4× above average — under investigation, may be a data artifact)" },
    ],
    rec: "Do not use today's net_revenue figure for executive reporting until pipeline fix is confirmed. Use gross_amount as a proxy.",
    lastClean: "2024-11-04 (yesterday)",
  };

  // ---- Scenario simulator presets ----
  const scenarios = [
    { q: "What if the Northeast region stops sending order data entirely?", type: "Segment loss" },
    { q: "Imagine revenue data was not loaded for today's orders.", type: "Column NULL" },
    { q: "Orders dropped 60% overnight.", type: "Volume drop" },
    { q: "A new invalid status code 'GHOST' appeared.", type: "Whitelist breach" },
    { q: "The CRM feed stopped arriving today.", type: "Source non-arrival" },
  ];

  return {
    today, datasets, profileSteps, profileSummary, columns, risks,
    metadata, cdes, rules, layerScores, execResults, failedRecords,
    anomalies, fingerprints, impact, trustHistory, ruleFailTrend, audit, tasks,
    advisory, receipt, scenarios,
  };
})();
