# Senior DE + AI-Engineer Review — Cross-Table / Cross-Column Rule Creation
Date: 2026-07-03 · Scope: `rule_agent.py::recommend_cross_table_rules`, `rules.py::/recommend-cross-table`, `prompts/rules.yaml` (cross_table_rules + cross-column guidance in recommend_rules), `execution_agent.py::execute_rule`, `screens_rules.jsx` cross-table parsing.

Evidence type: this is a **logic review** — claims are backed by live SQL executed against the stack's Postgres (dialect-representative), and by rows read from the production `dq_rules` / `dq_run_results` tables, which is stronger evidence than screenshots for generation-logic defects. UI states were reviewed at code level (`screens_rules.jsx:89-128`).

---

## Finding: [P0] Correlated EXISTS pattern silently passes broken data (false-pass)

**Evidence**: Live SQL proof —
```sql
CREATE TEMP TABLE orders(customerid int);  INSERT INTO orders VALUES (999);   -- orphan FK
CREATE TEMP TABLE customers(customerid int); INSERT INTO customers VALUES (1),(2);
SELECT COUNT(*) FROM orders
WHERE NOT (customerid IS NULL OR EXISTS
  (SELECT 1 FROM customers c WHERE c.customerid = customerid));
-- → 0   (orphan NOT detected; correct answer is 1)
```
**Root cause**: `execution_agent.py:52` runs `SELECT COUNT(*) FROM {tref} WHERE NOT (expr)` with **no alias on the primary table**, and `rules.yaml` (cross_table_rules) explicitly forbids qualifying primary columns — its own canonical example is `EXISTS (SELECT 1 FROM [Sales].[Customers] c WHERE c.[CustomerID] = [CustomerID])`. Per standard SQL scoping the unqualified inner reference binds to the **inner** table when a same-named column exists there — which is the *normal* FK case, and *always* the case for self-referencing hierarchy rules. The predicate degenerates to `c.X = c.X` (tautology) → EXISTS true for every row → rule always PASSes → orphaned FKs are never reported, with a green checkmark.

**Live occurrences** (dq_rules): `br_order_items_sourceorderid_fk_check`, `br_order_items_sourceproductid_fk_check`, `br_products_source_category_fk_validity`, `br_categories_parent_self_reference_validity` — all draft, all tautologies.

**Fix (verified live)**: alias the primary table in the executor (`FROM {tref} AS t`) — bare column refs in existing rules remain valid — and require `t.<col>` for outer references inside any subquery in the prompts. Proven:
```sql
SELECT COUNT(*) FROM orders t
WHERE NOT (t.customerid IS NULL OR EXISTS
  (SELECT 1 FROM customers c WHERE c.customerid = t.customerid));
-- → 1  ✓ orphan detected
```
Also update the two sample-rows queries (`execution_agent.py:62-63`) identically, and add a deterministic backstop: flag any EXISTS rule whose correlation column is unqualified AND exists in the referenced sibling's column list.

---

## Finding: [P0] Prompt-mandated window-function shapes cannot execute (guaranteed ERROR)

**Evidence**: Live SQL proof —
```sql
SELECT COUNT(*) FROM orders WHERE NOT (COUNT(*) OVER (PARTITION BY customerid) = 1);
-- ERROR: window functions are not allowed in WHERE
```
Same restriction in SQL Server ("Windowed functions can only appear in SELECT or ORDER BY"), Snowflake, Databricks, DuckDB.

**Root cause**: `rules.yaml` recommend_rules **mandates** these exact shapes: uniqueness `COUNT(*) OVER (PARTITION BY col) = 1`, cross-column consistency `COUNT(DISTINCT CustomerName) OVER (PARTITION BY CustomerID) = 1`, VOLUME `COUNT(*) OVER (PARTITION BY BatchID) >= 10` — but the executor wraps every expression in `WHERE NOT (...)`. Nothing in the execution path rewrites window expressions. **13 live rules** currently carry `OVER (` (1 UNIQUE, 6 VOLUME, 4 CUSTOM, 1 FORMAT, 1 FK draft); every one will return status=ERROR the moment it is approved and run.

Bonus defect: `COUNT(DISTINCT …) OVER (PARTITION BY …)` is not supported by SQL Server **or** Postgres at all, so the mandated cross-column consistency shape is doubly unexecutable in the two primary dialects.

**Fix**: change the executor to a derived-table form that legalizes window functions and keeps semantics explicit:
```sql
SELECT COUNT(*) FROM (
  SELECT CASE WHEN (expr) THEN 1 ELSE 0 END AS __pass FROM {tref} AS t
) __q WHERE __pass = 0
```
(Note: this counts NULL-valued expressions as failures, whereas `WHERE NOT(expr)` silently skipped them — for DQ this is arguably more correct, but it is a behavior change; decide explicitly.) Alternatively re-shape the prompts to GROUP-BY subquery forms, but the executor wrap is one fix covering all dialects and all past rules.

---

## Finding: [P1] Regeneration can silently overwrite an APPROVED rule (dual-control bypass)

**Evidence**: `rules.py:164-168` and `305-308` — `ON CONFLICT (connection_id, table_fqn, rule_name) DO UPDATE SET rule_description=…, rule_expression=…` with **no status guard**. The pre-insert DELETE only clears *drafts*; if a previously generated rule with the same semantic name (e.g. `br_order_items_sourceorderid_fk_check` — LLM rule names are highly repeatable for the same table) was **approved**, a regenerate upserts brand-new, unreviewed LLM SQL into the approved row while `status='approved'` and `approved_by` remain intact. This defeats exactly the dual control that `decide_rule` so carefully enforces (it even blocks edit+approve in one request).
**Fix**: add `WHERE dq_rules.status = 'draft'` to both ON CONFLICT DO UPDATE clauses, and handle the then-empty `RETURNING` (currently `result.fetchone()[0]` would raise on a skipped update — skip such rules and surface "N suggestions skipped: an approved rule with this name already exists").

---

## Finding: [P1] Description-prefix `[Cross-table: …]` is the only type discriminator — and ⚠️ warnings destroy it

**Evidence**: `rule_agent.py:405` stamps `[Cross-table: X]` at position 0; lines 417-429 then **prepend** ⚠️ warning text before it. Any warned cross-table rule therefore no longer starts with `[Cross-table:`, so:
- `/recommend-cross-table`'s cleanup (`LIKE '[Cross-table:%'`, rules.py:290) never deletes it → accumulates forever on regenerate;
- `/recommend`'s cleanup (`NOT LIKE '[Cross-table:%'`, rules.py:147) **deletes it** → the wrong button wipes cross-table work;
- the frontend badge regex (`^\[Cross-table:`, screens_rules.jsx:96) misses it → no cross-table badge.

Self-reference rules from the cross-table button (no prefix by design, rule_agent.py:407) have the same fate — live row `br_categories_parent_self_reference_validity` is an AI_AGENT FK draft with no prefix: the single-table regenerate will delete it; the cross-table regenerate will duplicate it.
**Fix**: stop using prose as a schema. Add structured columns to `dq_rules` (`is_cross_table BOOLEAN`, `related_table_fqn TEXT`, and ideally `generation_source` enum `single_table|cross_table|nl|manual`), scope both cleanups and the UI badge on them, and backfill from the existing prefixes. (The frontend comment at screens_rules.jsx:89-95 already admits this gap.)

---

## Finding: [P1] Inverted FK-null polarity generated live, with no backstop

**Evidence**: 3 live rules use `X IS NOT NULL AND EXISTS(...)` instead of the prompt-mandated `X IS NULL OR EXISTS(...)`: `br_categories_parent_category_exists_in_br_categories`, `br_categories_source_category_exists_in_products`, and `br_customers_source_customer_id_foreign_key_check` — the last one is **approved**. Under `WHERE NOT(expr)`, every row with a NULL FK **fails** this rule (all root categories, all optional FKs), double-counting what the NULL_CHECK rule already covers and misreporting referential integrity.
**Fix**: deterministic backstop regex (`IS NOT NULL AND ... EXISTS` inside an FK rule → ⚠️ description flag, same mechanism as the inverted-null-check backstop), plus a negative example in the prompt ("WRONG: `[X] IS NOT NULL AND EXISTS(...)` — NULL must pass this rule").

---

## Finding: [P1] Missing expression silently becomes an always-pass rule

**Evidence**: `rule_agent.py:294` and `408` — `r.get("rule_expression", "1=1")`. A malformed model item (missing field) is persisted as `1=1`: a rule that always passes and looks healthy forever. Same anti-pattern the AI-engineer skill calls out ("an LLM call that fails should never produce a wrong answer that looks like a real one").
**Fix**: if `rule_expression` is absent/empty, skip the item (logged) or persist with an "⚠️ AI returned no expression" description — never a green tautology.

---

## Finding: [P1] No dry-run validation gate before human review

**Evidence**: `br_customers_source_customer_id_foreign_key_check` (approved) → last run status **ERROR**. The whole defense against bad generated SQL is a growing stack of regex lints (`_INVERTED_NULL_CHECK_RE`, `_BARE_VALUE_FUNC_BOOLEAN_RE`, `_DOT_CHAINED_FUNC_RE`, `_FROM_JOIN_TABLE_RE`, …), each added after a live incident. The connector is available at generation time; executing each candidate as `SELECT COUNT(*) FROM {tref} t WHERE (expr) AND 1=0` (or dialect EXPLAIN) would deterministically catch invalid syntax, wrong table names, wrong sibling columns, and window-in-WHERE *before* a reviewer ever sees the rule — replacing heuristics with ground truth ("determinism where possible").
**Fix**: add a validate step in `/recommend` and `/recommend-cross-table` that dry-runs each expression and stamps pass/fail (`validation_status` column or ⚠️ prefix). Bound it (e.g. 5s timeout per rule) and mark unvalidated on timeout.

---

## Finding: [P2] Sibling-side column references never validated

`rule_agent.py:409-413` deliberately skips expression-column validation for cross-table rules, but the data needed exists: `related_table_fqn` + that sibling's `data_dictionary` columns. Alias-qualified refs inside the EXISTS (`c.[Col]`) could be checked against the related table's known columns; today a hallucinated sibling column sails through to an execution-time "Invalid column name".

## Finding: [P2] `related_table_fqn` not validated against the provided sibling list

Live mismatch: `br_products_source_category_fk_validity` is tagged `[Cross-table: BronzeDB.br_products]` while its description text says "…in br_categories" and its expression queries `br_products` — the tag drives the UI badge and cleanup scoping, and nothing checks it against the tables actually referenced in the expression or against the sibling list given to the model.

## Finding: [P2] `_unverified_table_references` compares last segment only → cross-layer conflation

`rule_agent.py:129` lowers to `fqn.split(".")[-1]`; `FROM [WrongDB].[br_categories]` validates because the last segment matches — exactly the trap the self-reference normalization comment (line 396-399) says it avoids. Compare full normalized chains when the model provides a qualified name.

## Finding: [P2] All cross-table rules hardcoded `rule_type="FK"`; enums unvalidated

`rule_agent.py:438` — the prompt explicitly solicits AGGREGATE-consistency and reverse-direction checks, which then get mislabeled FK. Also `severity`/`rule_type` from the model are persisted unvalidated against their enums in all three generation paths.

## Finding: [P2] Deterministic FK catalog metadata unused; primary-side stats absent from prompt

SQL Server/Postgres expose real FK constraints (`INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS`); those should seed cross-table rules deterministically, with the LLM reserved for constraint-less zones (Bronze/raw). Also the prompt gets uniqueness only for the *sibling* side — the primary FK column's own null_pct/cardinality (already profiled) would let the model judge direction and severity better.

## Finding: [P3] Silent sibling cap and loose ID-regex

`rules.py:266` truncates to 40 sibling tables with no log and no user-facing note (silent-cap anti-pattern); `~* '(_id|id|key|code)$'` both over-matches (`Paid`, `Valid` end in "id") and misses legitimate join keys (`ProductNumber`, `email`, `sku`).

---

## What's working well (keep)

- Full LLM call audit trail (`rule_ai_calls` with prompt, raw response, tokens, latency) including failed-before-chat attempts — genuinely production-grade observability.
- Fail-loud contract: LLM/parse failure raises → 502, never indistinguishable from "0 rules found".
- Token-budget-aware sibling filtering (ID-like columns only) with uniqueness signal per sibling column — good grounded-prompt design.
- Self-reference detection with bracket-normalization (rule_agent.py:400-402) is careful and correct.
- Human-in-the-loop governance (draft-only creation, author-cannot-approve, edit resets to draft) is well designed — which is exactly why P1 #3 (upsert bypassing it) matters.

## Recommended fix order
1. P0 executor alias + prompt outer-qualification (restores actual FK detection).
2. P0 executor derived-table wrap (unblocks all uniqueness/consistency/VOLUME shapes) — decide NULL semantics explicitly.
3. P1 ON CONFLICT status guard.
4. P1 structured cross-table columns (kills the whole prefix-string fragility class).
5. P1 polarity backstop + missing-expression handling.
6. P1 dry-run validation gate (then retire regex lints gradually).
