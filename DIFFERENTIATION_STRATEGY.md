# HOW TO WIN THE HACKATHON
## Differentiation Strategy — Against 2 Other Teams on the Same Problem

> Perspective: Senior Data Engineer who has judged and competed in data hackathons.
> Assumption: All 3 teams read the same usecase.md. What you build on top of it is the competition.

---

## FIRST — UNDERSTAND WHAT THE OTHER TEAMS WILL BUILD

Be brutally honest. Given the usecase.md, 90% of teams converge on the same solution shape:

```
┌─────────────────────────────────────────────────────────────────┐
│  WHAT EVERY TEAM WILL BUILD                                     │
│                                                                 │
│  1. Connect to Snowflake / Databricks                           │
│  2. Run a profiling script — show nulls, types, cardinality    │
│  3. Generate some DQ rules (maybe with LLM)                    │
│  4. A dashboard with quality scores                            │
│  5. A chatbot sidebar that explains issues                     │
│  6. A "scenario simulation" that is secretly scripted          │
│  7. Nice slides with medallion architecture diagrams           │
└─────────────────────────────────────────────────────────────────┘
```

If your solution looks like this list — you are in a three-way tie before the demo starts.

The judges have read the same usecase.md. They know what the "expected" answer looks like. They are looking for the team that thought **beyond** the brief.

---

## THE 5 FEATURES THAT WILL SEPARATE YOU

### DIFFERENTIATOR 1 — DOWNSTREAM IMPACT GRAPH
**"Not just what broke. What it broke downstream."**

Every other team will show: *"Column X has 11% nulls."*
You show: *"Column X has 11% nulls — and here is every table, dashboard, report, and ML model that is now untrustworthy because of it."*

This is a **cascading impact visualisation** — a live dependency graph that traces a DQ issue from its source all the way to business consumption.

```
  IMPACT GRAPH — net_revenue NULL — silver.orders_enriched

  silver.orders_enriched  (❌ 11.2% null)
        │
        ├──→  gold.daily_revenue_summary       ❌ Revenue understated $221M
        │           │
        │           └──→  Finance Dashboard         ❌ DO NOT PUBLISH
        │           └──→  CFO Weekly Report         ⚠️  Queued — hold
        │
        ├──→  gold.customer_segments            ⚠️  LTV calculations affected
        │
        ├──→  ml_model.revenue_forecast_v3      ❌ Training data incomplete
        ├──→  ml_model.churn_predictor_v2       ⚠️  Feature incomplete
        │
        └──→  ops.fulfilment_sla_report         ⚠️  Revenue SLA threshold wrong
```

**Why it wins**: Every judge in the room is a business or tech lead. They don't care about null counts. They care about what broke. This graph makes the business impact *visceral and immediate*.

**How to build it**: Maintain a `data_lineage` metadata table that maps table → downstream tables → dashboards → reports → models. When a DQ issue is detected, traverse the graph and render it live. Keep it simple — even a static pre-mapped graph with live status overlays beats a raw score table.

---

### DIFFERENTIATOR 2 — PER-RECORD TRUST SCORE EMBEDDED IN DATA
**"The quality signal travels with the data."**

Most teams put quality scores on dashboards *outside* the data. Nobody else will put the trust score *inside* the data itself.

Every Silver and Gold row carries a `_trust_score` column (0–100) computed from:
- How many DQ rules this record passed/failed
- Whether its CDEs are populated
- Whether its source arrived on time
- Whether it has anomaly flags

```sql
-- A data consumer can now query:
SELECT *
FROM gold.daily_revenue_summary
WHERE _trust_score >= 85
  AND report_date = '2024-11-05'

-- Or an ML engineer does:
SELECT order_id, net_revenue, _trust_score, _trust_flags
FROM silver.orders_enriched
WHERE _trust_score < 60
-- See exactly which records are suspect before training
```

**The demo moment**: Show a Finance analyst querying Gold. Side-by-side:
- Without trust score: they get a number and hope it's right
- With trust score: they see $342M from records with score ≥ 85, and a flag that $18M comes from records with score < 60 — meaning the $18M is uncertain

**Why it wins**: This is a *product concept*, not a feature. It shifts data quality from a backend concern to a consumer-visible data attribute. No other team will think of this. Judges remember product thinking.

---

### DIFFERENTIATOR 3 — PREDICTIVE PRE-RUN ADVISORY
**"Tell me the risk BEFORE the pipeline runs."**

Every team does reactive quality checks. You add a layer that runs *before* the Bronze/Silver pipeline starts and predicts the likely trust score for today's run.

```
╔══════════════════════════════════════════════════════════════════╗
║  PRE-RUN ADVISORY — 05:20 AM — Before Bronze Pipeline Start     ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  PREDICTED TRUST SCORE FOR TODAY'S RUN:  71 / 100  ⚠️           ║
║                                                                  ║
║  WHY THE RISK:                                                   ║
║  • WMS shipment feed has arrived late on 3 of the last 5        ║
║    Tuesdays. Today is Tuesday. File not yet seen. (High risk)   ║
║  • OMS extract is 12% smaller than yesterday (arrived 05:15).  ║
║    Possible partial extract. Bronze dedup may flag duplicates.  ║
║  • Historical pattern: when OMS < 95% of yesterday's size,      ║
║    Silver net_revenue null rate averages 8.4% (vs normal 0.3%) ║
║                                                                  ║
║  RECOMMENDATION:                                                 ║
║  ⏸ Hold Bronze pipeline 20 minutes. Wait for WMS confirmation. ║
║  If OMS extract does not grow in 15 min → alert pipeline owner. ║
║                                                                  ║
║  [Hold Pipeline]  [Proceed Anyway]  [Alert Owner]               ║
╚══════════════════════════════════════════════════════════════════╝
```

**How to build it**: Simple historical pattern matching. Track: source file size vs yesterday %, arrival time vs SLA, day-of-week patterns, last 7-day null rates. An LLM synthesizes these signals into the advisory text.

**Why it wins**: This is the *only* feature in the entire usecase.md that is genuinely proactive. Not reactive, not monitoring — *predictive*. The brief says "move from reactive to proactive" but describes mostly monitoring. You actually do it.

---

### DIFFERENTIATOR 4 — ANOMALY FINGERPRINTING (INSTITUTIONAL MEMORY)
**"This has happened before. Here's how it was fixed."**

When the Anomaly Agent detects an issue, it doesn't just describe it. It searches the historical anomaly log for similar patterns and surfaces the last time this happened — including how it was resolved and how long it took.

```
╔══════════════════════════════════════════════════════════════════╗
║  🧠 ANOMALY FINGERPRINT MATCH                                   ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  CURRENT ISSUE:                                                  ║
║  silver.orders_enriched net_revenue NULL 11.2% — Tuesday AM    ║
║                                                                  ║
║  SIMILAR PAST INCIDENTS (2 matches found):                       ║
║                                                                  ║
║  Match 1 — Similarity: 94%  |  Date: 2024-09-03 (Tuesday)      ║
║  Root cause: OMS extract arrived at 06:48 AM. Bronze ran at     ║
║  05:35 AM before extract completed. Discount join step had      ║
║  no rows to join — set net_revenue to NULL for same-day orders. ║
║  Resolution: Re-ran Bronze + Silver pipelines.                  ║
║  Time to fix: 47 minutes.                                       ║
║  Fixed by: Deepa Nair                                           ║
║                                                                  ║
║  Match 2 — Similarity: 81%  |  Date: 2024-07-16 (Tuesday)      ║
║  Root cause: Same pattern. Also a Tuesday. OMS file was late.   ║
║  Resolution: Same re-run approach.                              ║
║  Time to fix: 1h 12min.                                         ║
║                                                                  ║
║  SUGGESTED RESOLUTION (based on past fixes):                    ║
║  1. Confirm OMS extract is now complete                         ║
║  2. Re-run Bronze pipeline for today's partition                ║
║  3. Re-run Silver pipeline                                       ║
║  Expected fix time: ~50 minutes                                  ║
║                                                                  ║
║  [Apply Suggested Resolution]  [Assign to Deepa Nair]          ║
╚══════════════════════════════════════════════════════════════════╝
```

**Why it wins**: This is institutional memory. Senior DEs know this problem — the same root causes repeat. Most teams will describe the current issue. You will say "we've seen this before, here's how to fix it in 47 minutes." That is genuinely valuable. Judges will react to this.

**How to build it**: Store past anomalies with their resolution in the `anomaly_log` table. On new detection, compute similarity (issue type + table + column + day-of-week + null rate range). LLM synthesizes the match into a readable fingerprint.

---

### DIFFERENTIATOR 5 — THE DATA TRUST RECEIPT
**"A nutrition label for every data query."**

When any consumer — analyst, ML engineer, or business user — queries a Gold or Silver table, they receive a lightweight "trust receipt" alongside their results.

```
╔══════════════════════════════════════════════════════════════════╗
║  📄 DATA TRUST RECEIPT                                          ║
║  Query: SELECT * FROM gold.daily_revenue_summary                ║
║  Executed: 2024-11-05 10:30 AM by Sunita Reddy                 ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  ROWS RETURNED:  1 (for report_date = 2024-11-05)              ║
║                                                                  ║
║  DATA TRUST SCORE:  ⚠️  61 / 100                               ║
║                                                                  ║
║  WHAT YOU SHOULD KNOW:                                           ║
║  ❌ net_revenue is based on 88% of today's orders.              ║
║     12% of orders are missing revenue data (pipeline issue,     ║
║     fix in progress — ETA 10:50 AM).                           ║
║                                                                  ║
║  ✅ gross_amount: FULLY TRUSTED (100% complete, validated)      ║
║  ✅ total_orders: FULLY TRUSTED                                  ║
║  ⚠️  return_rate_pct: UNCERTAIN (4x above average — under      ║
║     investigation, may be a data artifact)                      ║
║                                                                  ║
║  RECOMMENDATION:                                                 ║
║  Do not use today's net_revenue figure for executive reporting  ║
║  until pipeline fix is confirmed. Use gross_amount as a proxy. ║
║                                                                  ║
║  Last fully trusted snapshot: 2024-11-04 (yesterday) ✅         ║
║  [Use Yesterday's Data Instead]  [Acknowledge & Proceed]        ║
╚══════════════════════════════════════════════════════════════════╝
```

**Why it wins**: This closes the last-mile gap. Every other team stops at the pipeline. You follow the data all the way to the consumer's screen and give them a decision — not just a score. The Finance analyst in the demo story (Sunita) represents every judge's business users. This feature speaks directly to them.

---

## DEMO STRATEGY — HOW TO PRESENT TO WIN

### The One Rule That Beats Everything
**Let the judge inject the live scenario. Don't know what it will be.**

Other teams will have a scripted scenario. Their "live simulation" will be:
- Reviewer says "what about X"
- Team says "great question, let me show you..."
- They run the pre-prepared X script

Your team says: *"Give us any scenario. We'll take it live."*

That single moment of confidence will be remembered after every other demo is forgotten.

To do this safely, pre-wire 8–10 scenario injection scripts covering:
- Volume drops (any %)
- Source non-arrival
- Column going null
- Invalid codes appearing
- Metric threshold breach
- Cross-region segment loss
- Duplicate key injection
- Schema change (new column, dropped column)

Map any natural language scenario to one of these programmatically (LLM classification). The reviewer says something — your system classifies it — the right script runs — the system reacts in < 90 seconds.

---

### The Story Arc That Judges Remember

Most teams will demo **features**. You demo a **story**.

```
STORY:  "It's 5:20 AM. The pipeline hasn't run yet.
         Our system already knows something is wrong."
                    ↓
         Pre-run advisory fires. WMS feed not yet arrived.
         Recommendation: hold Bronze pipeline 20 minutes.
         Team ignores it (deliberately, for the story).
                    ↓
         Pipeline runs. Issues cascade exactly as predicted.
         net_revenue NULL. Row count 57% low.
         Impact graph lights up. $221M understated.
                    ↓
         Anomaly fingerprint matches a past Tuesday incident.
         "This happened on September 3rd. Fixed in 47 minutes."
                    ↓
         Sunita queries Gold at 10:30.
         She gets a trust receipt — don't publish this number.
                    ↓
         Fix applied. Pipeline re-runs.
         Trust score goes from 69 → 91 live on screen.
                    ↓
         Reviewer injects live scenario.
         System reacts in 73 seconds. Never seen it before.
```

This story has a beginning (prediction), middle (cascading failure), and end (recovery + live proof). Most teams will have a beginning and a middle. You will have all three.

---

### The 3 Demo Moments Judges Will Photograph

1. **The Impact Graph lighting up** — a single null column cascades visually to 4 tables, 2 dashboards, 3 models. Make this animated. Make it look like a circuit breaker tripping.

2. **The Pre-Run Advisory saying "hold the pipeline"** — then show what happens when you ignore it. This is a teaching moment in the demo. Judges love when a tool is right before it's needed.

3. **The Trust Score going from 69 → 91 after the fix** — show recovery, not just failure detection. Any team can detect a problem. Showing a trust score heal in real time proves the system is a closed loop.

---

## WHAT NOT TO BUILD

These are tempting but won't differentiate you:

| Temptation | Why to skip it |
|---|---|
| Fancy dashboard with lots of charts | Every team will have this. Judges are numb to it. |
| Chatbot sidebar | The brief says "this is not a chatbot." Don't make it feel like one. |
| More rule types | Depth on 5 rule types beats breadth on 20. |
| Complex ML anomaly detection | Simple statistical baselines that work > complex models that don't reliably demo. |
| Multi-platform support | One platform working perfectly beats 3 platforms half-working. |
| Elaborate slide deck | Less slides. More live demo. Every minute on slides is a minute not demoing. |

---

## TECHNICAL TIPS FOR DEMO DAY

### Reliability First
- Hardcode seed data snapshots. Do not rely on live cloud platform queries during the demo. Have a local or cached fallback.
- Pre-warm all API calls. Cold start on Claude API mid-demo = awkward silence.
- Have the live simulation scripts tested 10 times each before demo day. No surprises.
- Two laptops — primary and backup, fully synced.

### The 90-Second Rule
Every feature in your demo should pay off within 90 seconds of being introduced. If you're still explaining a feature after 90 seconds, cut it or simplify it.

### Make Numbers Feel Real
Don't say "206,000 records affected." Say "$221 million in revenue is understated right now." 
Judges are business people. Rows are abstract. Dollars are not.

### Have Sunita in the Room
Have one team member play a non-technical business user throughout the demo. Their job is to ask "what does this mean for me?" at key moments. This keeps the demo grounded in business value, not engineering pride.

---

## THE ONE-LINE PITCH THAT DIFFERENTIATES YOU

Other teams will say:
> "We built an agentic data quality system that profiles, monitors, and explains data issues."

You say:
> "We built a system that tells you a data problem is coming before the pipeline runs, shows you every business report it will break, remembers how this was fixed last time, and lets you query your data with a receipt that tells you how much to trust the answer — and we'll prove all of it live with any scenario you give us right now."

That is not the same pitch.

---

## PRIORITY STACK — IF YOU RUN OUT OF TIME

Build in this order. Stop when you run out of time. Each row is independently demoable.

```
MUST HAVE (without these, you don't have a submission)
  ✅  Profiling across all 4 layers
  ✅  Rule recommendation + NL→DQ conversion
  ✅  Human-in-the-loop review at every step
  ✅  DQ execution with scored results
  ✅  Live scenario simulation (wired, not mocked)
  ✅  Explainability in business language

STRONG DIFFERENTIATORS (build these next)
  ⭐  Downstream impact graph (Differentiator 1)
  ⭐  Per-record trust score in Silver/Gold (Differentiator 2)
  ⭐  Anomaly fingerprinting (Differentiator 4)

DEMO-WINNING ADDITIONS (if time allows)
  🏆  Pre-run advisory (Differentiator 3)
  🏆  Trust receipt for consumers (Differentiator 5)
  🏆  Trust score recovery animation (score goes up after fix)
```

---

> The teams that lose hackathons build what the brief asked for.
> The teams that win build what the brief was trying to ask for.
> The brief is asking: "Can data quality be so intelligent and transparent
> that no one ever has to ask 'can I trust this data?' again?"
> Build the answer to that question.
