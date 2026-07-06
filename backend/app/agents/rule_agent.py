"""
Rule Agent — two capabilities:
  1. recommend_rules(profiling_report) → list of recommended DQ rules
  2. nl_to_rule(table_fqn, natural_language) → structured DQ rule
Both use LiteLLM for intelligence.
"""
import json
import logging
import re
import time
import uuid
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.llm import chat_with_usage, parse_llm_json
from app.core.config import settings
from app.models.rule import DQRule, NLConvertResponse
from app.models.profiling import ProfilingReport
from app.prompts.rules import build_recommend_rules_prompt, build_nl_to_rule_prompt, build_cross_table_rules_prompt

logger = logging.getLogger(__name__)

# Matches a single quoted identifier segment across every dialect the prompts
# support: [Col] (SQL Server), "Col" (postgres/snowflake/ANSI), `Col` (databricks).
# Allows an embedded dot inside one bracket/quote pair (e.g. [SilverDB.dim_category])
# because the model sometimes quotes this app's internal "layer.table" display label
# as a single segment instead of a bare column — without this, a chain like
# [dbo].[SilverDB.dim_category] would fail to match past [dbo] (the next segment
# doesn't fit \w+), fragmenting the chain so 'dbo' looks like a standalone,
# unqualified column reference and gets falsely flagged.
_QUOTED_SEGMENT_RE = r"(?:\[[\w.]+\]|\"[\w.]+\"|`[\w.]+`)"
_QUOTED_IDENTIFIER_INNER_RE = re.compile(r"[\[\"`]([\w.]+)[\]\"`]")
# A full dotted reference chain, e.g. [RawDB].[dbo].[Table].[Column] or "schema"."table"."col" —
# matched as ONE unit so only its LAST segment (the actual column) gets checked; the earlier
# segments are catalog/schema/table qualifiers, not column names, and must never be checked
# against the known-COLUMN list (they were being flagged as fabricated columns before this fix).
_QUALIFIED_CHAIN_RE = re.compile(rf"{_QUOTED_SEGMENT_RE}(?:\s*\.\s*{_QUOTED_SEGMENT_RE})*")

# Generic SQL Server/catalog qualifier words the model sometimes emits as a guessed
# schema prefix (e.g. prepending "dbo" to a table it's quoting incorrectly). These are
# never column names in any real schema, so never report them as an "unverified
# column" even if a malformed/fragmented chain leaves one standing alone — that
# specific false positive ("'dbo' not found in profiled schema") was confusing enough
# on its own, reported directly, to be worth suppressing independently of fixing the
# generation-side prompt.
_KNOWN_QUALIFIER_WORDS = {"dbo", "sys", "guest", "information_schema", "public"}

# Catches the "inverted null check" anti-pattern: ISNULL/IFNULL/COALESCE(col, X) = X
# (or ZEROIFNULL(col) = 0). This is TRUE exactly when col IS NULL — the opposite of
# "passing" — so a rule using it as a NULL_CHECK silently fails 100% of good rows.
# Prompt guidance asks the model not to write this, but that's not a guarantee, so
# this is a deterministic backstop that catches it even if the prompt fix drifts.
_INVERTED_NULL_CHECK_RE = re.compile(
    r"(?:ISNULL|IFNULL|COALESCE)\s*\(\s*[^,()]+\s*,\s*([^)]+?)\s*\)\s*=\s*\1"
    r"|ZEROIFNULL\s*\([^)]+\)\s*=\s*0",
    re.IGNORECASE,
)


def _has_inverted_null_check(rule_expression: str) -> bool:
    return bool(rule_expression and _INVERTED_NULL_CHECK_RE.search(rule_expression))


# Catches ANDing/ORing a bare value-substitution call with no comparison, e.g.
# `ISNULL(a,0) AND ISNULL(b,0)` — ISNULL/IFNULL/COALESCE/ZEROIFNULL return a VALUE,
# not a boolean, so this is invalid SQL syntax in every dialect the prompts target.
# Seen live: `ISNULL([Quantity],0) AND ISNULL([UnitPrice],0)` from a real
# "Generate rules" call, which fails at execution time with no useful signal to the
# reviewer (the executor's error-scrubber intentionally hides raw driver SQL detail).
_VALUE_FUNC = r"(?:ISNULL|IFNULL|COALESCE|ZEROIFNULL)\s*\([^()]*\)"
_BARE_VALUE_FUNC_BOOLEAN_RE = re.compile(
    rf"{_VALUE_FUNC}\s*(?:AND|OR)\s*{_VALUE_FUNC}(?!\s*[=<>!])",
    re.IGNORECASE,
)
# The one-sided variant of the same mistake — a bare value-func on just ONE side of
# AND/OR, e.g. `ISNULL(ParentCategoryID,0) AND NOT EXISTS(...)`. The original regex
# above only caught two bare calls together; this seen-live cross-table generation
# case has a real boolean (NOT EXISTS) on the other side, which the original pattern
# doesn't match at all. A value-func NOT immediately followed by a comparison
# operator before hitting AND/OR is being used as a raw value, which is exactly as
# invalid as the two-sided case.
_ONE_SIDED_VALUE_FUNC_BOOLEAN_RE = re.compile(
    rf"{_VALUE_FUNC}(?!\s*[=<>!])\s*(?:AND|OR)\b",
    re.IGNORECASE,
)

# Catches an invented "dot method call" on a column, e.g. `[SourceSystem].IN('ERP','CRM')`
# or `[Brz_CategoryID].ISNULL([ParentCategoryID], -999)` — no dialect these prompts
# target supports calling a function AS A METHOD on a column reference; the function
# must wrap the column (`ISNULL([Col], x)`), never follow it with a dot. Seen live in
# cross-table generation — genuinely invalid syntax, not just a style issue.
_DOT_CHAINED_FUNC_RE = re.compile(
    rf"{_QUOTED_SEGMENT_RE}\s*\.\s*(?:ISNULL|IFNULL|COALESCE|ZEROIFNULL|IN|COUNT|SUM|MAX|MIN|AVG)\s*\(",
    re.IGNORECASE,
)


def _has_dot_chained_function_call(rule_expression: str) -> bool:
    return bool(rule_expression and _DOT_CHAINED_FUNC_RE.search(rule_expression))


# Catches the null-hostile FK guard `X IS NOT NULL AND ... EXISTS(...)` — the prompt's
# contract is `X IS NULL OR EXISTS(...)` (a missing FK is a NULL_CHECK rule's job, not
# this one's), so this inversion makes every NULL-FK row fail the referential check:
# all root categories, every optional FK. Seen live in three generated rules, one of
# which was approved — prompt guidance alone demonstrably doesn't prevent it.
_NULL_HOSTILE_FK_GUARD_RE = re.compile(
    r"IS\s+NOT\s+NULL\s+AND\b[^()]*\bEXISTS\s*\(",
    re.IGNORECASE,
)


def _has_null_hostile_fk_guard(rule_expression: str) -> bool:
    return bool(rule_expression and _NULL_HOSTILE_FK_GUARD_RE.search(rule_expression))


# The correlation tautology: inside an EXISTS subquery, `alias.[Col] = [Col]` (or the
# unbracketed equivalent) where the right side is UNQUALIFIED. Standard SQL scoping
# binds that unqualified name to the SUBQUERY's own table whenever the column exists
# there too — the normal FK case, and every self-reference case — so the predicate
# degenerates to alias.Col = alias.Col and the rule passes every row, never detecting
# an orphan. The executor aliases the primary table as `t` and the prompts now demand
# `t.Col` on the outer side; this is the deterministic backstop for when the model
# drifts back to the old (pre-fix) example shape it has surely memorized.
_UNCORRELATED_EXISTS_RE = re.compile(
    r"(\w+)\s*\.\s*(?:\[([\w.]+)\]|\"([\w.]+)\"|`([\w.]+)`|(\w+))\s*=\s*"
    r"(?:\[([\w.]+)\]|\"([\w.]+)\"|`([\w.]+)`|(\w+))(?!\s*\.)(?!\w)",
    re.IGNORECASE,
)


def _has_uncorrelated_exists_comparison(rule_expression: str) -> bool:
    """True when an alias-qualified column is compared to a bare, unqualified
    identifier inside an expression that contains EXISTS — i.e. `c.[X] = [X]`
    with no `t.` (or other) qualifier on the right side."""
    if not rule_expression or not re.search(r"\bEXISTS\s*\(", rule_expression, re.IGNORECASE):
        return False
    for m in _UNCORRELATED_EXISTS_RE.finditer(rule_expression):
        left_alias = m.group(1)
        right_name = next((g for g in m.groups()[5:] if g), None)
        # `c.[X] = t.[X]` never matches (right side would start a new alias chain,
        # blocked by the (?!\s*\.) lookahead); a bare right side with any alias on
        # the left is the tautology shape — unless the "bare" token is a keyword.
        if (right_name and not right_name.isdigit()
                and right_name.upper() not in {"NULL", "TRUE", "FALSE"} and left_alias):
            return True
    return False


def _has_malformed_boolean_combination(rule_expression: str) -> bool:
    return bool(rule_expression and (
        _BARE_VALUE_FUNC_BOOLEAN_RE.search(rule_expression)
        or _ONE_SIDED_VALUE_FUNC_BOOLEAN_RE.search(rule_expression)
    ))


# Matches a table name referenced after FROM/JOIN inside a cross-table rule's EXISTS
# subquery, e.g. `FROM [BronzeDB].[br_products] p` or `FROM Sales.Customers c`.
_FROM_JOIN_TABLE_RE = re.compile(
    rf"(?:FROM|JOIN)\s+({_QUOTED_SEGMENT_RE}(?:\s*\.\s*{_QUOTED_SEGMENT_RE})*|\w+(?:\.\w+)*)",
    re.IGNORECASE,
)


def _unverified_table_references(rule_expression: str, known_table_fqns: set[str]) -> list[str]:
    """Return table names referenced in FROM/JOIN clauses that don't match any table
    actually given to the model (the primary table or one of its listed siblings).
    Only the LAST segment of a dotted/bracketed chain is compared — same approach as
    _unverified_columns_in_expression, since schema/catalog prefixing varies.

    Closes a real gap: the model sometimes hallucinates a differently-named/-cased
    variant of a table it WAS given (seen live: writing `[Brz_Categories]` when the
    real table is `br_categories`) — a rule with this mistake looks entirely
    plausible at review time and only fails with "Invalid object name" at execution,
    since no existing check ever validated table names, only column names."""
    if not rule_expression or not known_table_fqns:
        return []
    known_last_segments = {fqn.split(".")[-1].lower() for fqn in known_table_fqns}
    found = []
    for match in _FROM_JOIN_TABLE_RE.finditer(rule_expression):
        chain = match.group(1)
        segments = _QUOTED_IDENTIFIER_INNER_RE.findall(chain) or chain.split(".")
        if not segments:
            continue
        table_name = segments[-1]
        if table_name.lower() not in known_last_segments and table_name not in found:
            found.append(table_name)
    return found


def _unverified_columns_in_expression(rule_expression: str, known_column_names: set[str],
                                       table_fqn: str | None = None) -> list[str]:
    """Return quoted identifiers referenced in rule_expression that aren't real
    columns. The column_name field only tags ONE column (or None for a
    table-level/multi-column rule) — it says nothing about the other columns a
    cross-column expression like `[A] >= [B]` actually references, so a
    fabricated column in a multi-column rule previously sailed through with
    zero warning as long as column_name itself happened to be null or valid.

    Only the LAST segment of a dotted reference (e.g. [RawDB].[dbo].[Table].[Col])
    is checked — earlier segments are catalog/schema/table qualifiers, not column
    names, and checking them against the known-COLUMN list produced false positives
    like flagging 'dbo' and 'RawDB' as "unverified columns".

    table_fqn (this app's internal "layer.table" display label for the table the
    rule runs against) is excluded from the check too: the model sometimes quotes
    that whole label as a single bracketed segment when self-referencing the table
    in a subquery (e.g. a uniqueness check), producing a segment like
    "SilverDB.dim_category" that is a table self-reference, not a column, and would
    otherwise be reported as an "unverified column" — a different but equally
    confusing false positive than the 'dbo'-qualifier case above."""
    if not rule_expression or not known_column_names:
        return []
    known_lower = {c.lower() for c in known_column_names}
    table_self_refs = set()
    if table_fqn:
        table_self_refs.add(table_fqn.lower())
        table_self_refs.add(table_fqn.split(".")[-1].lower())
    found = []
    for chain in _QUALIFIED_CHAIN_RE.findall(rule_expression):
        segments = _QUOTED_IDENTIFIER_INNER_RE.findall(chain)
        if not segments:
            continue
        name = segments[-1]  # last segment = the column; earlier ones are qualifiers
        name_lower = name.lower()
        if name_lower in _KNOWN_QUALIFIER_WORDS or name_lower in table_self_refs:
            continue
        if name_lower not in known_lower and name not in found:
            found.append(name)
    return found


def _log_ai_call(db: Session | None, *, connection_id: str, call_type: str,
                  table_fqn: str | None, prompt, raw_response: str | None,
                  status: str, error_message: str | None = None,
                  usage: dict | None = None, latency_ms: int | None = None) -> None:
    """Persist an LLM call so a bad AI-generated rule can be traced back to its prompt/response."""
    if db is None:
        return
    logger.info(json.dumps({
        "event": "llm.call", "call_type": call_type, "model": settings.llm_model,
        "table_fqn": table_fqn, "status": status,
        "input_tokens": (usage or {}).get("input_tokens"),
        "output_tokens": (usage or {}).get("output_tokens"),
        "latency_ms": latency_ms,
    }))
    try:
        db.execute(text("""
            INSERT INTO rule_ai_calls
                (call_id, connection_id, call_type, table_fqn, model, prompt, raw_response,
                 status, error_message, input_tokens, output_tokens, latency_ms)
            VALUES
                (:id, :conn, :type, :table_fqn, :model, :prompt, :raw, :status, :err,
                 :in_tok, :out_tok, :latency)
        """), {
            "id": str(uuid.uuid4()), "conn": connection_id, "type": call_type,
            "table_fqn": table_fqn, "model": settings.llm_model,
            "prompt": json.dumps(prompt), "raw": raw_response,
            "status": status, "err": error_message,
            "in_tok": (usage or {}).get("input_tokens"),
            "out_tok": (usage or {}).get("output_tokens"),
            "latency": latency_ms,
        })
        db.commit()
    except Exception as e:
        logger.warning("Failed to persist rule_ai_calls row: %s", e)


def recommend_rules(
    report: ProfilingReport,
    connection_id: str,
    cde_columns: list[str] | None = None,
    sql_dialect: str = "postgresql",
    db: Session | None = None,
    requested_by: str = "AI_AGENT",
) -> list[DQRule]:
    cde_set = set(cde_columns or [])
    known_column_names = {c.name for c in report.columns}
    # min_val/max_val/top_values/has_duplicates were computed by profiling but never
    # reached this prompt — RANGE rules were generated purely from the column's NAME
    # and TYPE (e.g. "must be a positive integer" is a generic guess), never checked
    # against what values the column actually contains. Grounding rule generation in
    # real observed stats produces tighter, more defensible thresholds instead of
    # generic guesses. top_values is capped to 10 to stay within the local model's
    # token budget (see the sibling-table capping note in api/rules.py for the same
    # class of failure — a bloated prompt gets no JSON back at all, not a worse rule).
    col_summary = [
        {
            "name": c.name, "type": c.data_type,
            "null_pct": c.null_pct, "cardinality_ratio": c.cardinality_ratio,
            "format_pattern": c.format_pattern, "is_cde": c.name in cde_set,
            "min_val": c.min_val, "max_val": c.max_val,
            "top_values": (c.top_values or [])[:10],
            "has_duplicates": c.has_duplicates,
        }
        for c in report.columns
    ]

    # prompt is built inside the try (not before it) so a template/serialization
    # failure still produces a logged rule_ai_calls row instead of raising unlogged
    # — every call attempt must be traceable, including ones that never reach chat().
    prompt = None
    raw = None
    usage = None
    t0 = time.monotonic()
    try:
        prompt = build_recommend_rules_prompt(
            table_fqn=report.table_fqn,
            layer=report.layer,
            row_count=report.row_count,
            col_summary=col_summary,
            risks=report.risks,
            sql_dialect=sql_dialect,
        )
        raw, usage = chat_with_usage(prompt)
        data = parse_llm_json(raw)
        rules_raw = data.get("rules", [])
        logger.info("Rule recommendation LLM call succeeded: connection=%s table=%s rules=%d",
                    connection_id, report.table_fqn, len(rules_raw))
        _log_ai_call(db, connection_id=connection_id, call_type="RECOMMEND",
                     table_fqn=report.table_fqn, prompt=prompt, raw_response=raw, status="success",
                     usage=usage, latency_ms=int((time.monotonic() - t0) * 1000))
    except Exception as e:
        logger.error("Rule recommendation LLM failed: %s", e)
        # raw (not hardcoded None) — if chat() succeeded but parse_llm_json() threw
        # (e.g. truncated JSON), the raw completion is the only diagnostic evidence
        # of what the model actually returned; losing it here made the two token-
        # budget truncation regressions this session much harder to root-cause.
        _log_ai_call(db, connection_id=connection_id, call_type="RECOMMEND",
                     table_fqn=report.table_fqn, prompt=prompt, raw_response=raw,
                     status="error", error_message=str(e), usage=usage,
                     latency_ms=int((time.monotonic() - t0) * 1000))
        # Re-raise rather than silently returning an empty list — the caller (rules.py)
        # must be able to tell "LLM failed" apart from "LLM legitimately found nothing
        # to flag," otherwise a failure looks identical to a clean table.
        raise

    rules = []
    for r in rules_raw:
        try:
            column_name = r.get("column_name")
            description = r.get("rule_description")
            rule_expression = (r.get("rule_expression") or "").strip()
            if not rule_expression:
                # Never default a missing expression to a tautology like 1=1 — that
                # persists a permanently-green rule that looks healthy forever.
                logger.warning("Skipping rule with no expression for %s (raw=%r)", report.table_fqn, r)
                continue
            # Defense-in-depth: the prompt is grounded with the table's real columns,
            # but if the model still drifts, flag it in the description rather than
            # silently persisting a rule that references a column that doesn't exist.
            # Checking column_name alone misses fabricated columns inside a
            # multi-column/table-level expression (column_name is null there).
            unverified = []
            if column_name and column_name not in known_column_names:
                unverified.append(column_name)
            for name in _unverified_columns_in_expression(rule_expression, known_column_names, report.table_fqn):
                if name not in unverified:
                    unverified.append(name)
            if unverified:
                refs = "', '".join(unverified)
                description = f"⚠️ Unverified column reference(s) ('{refs}' not found in profiled schema) — review before approving. {description or ''}".strip()
            if _has_inverted_null_check(rule_expression):
                description = f"⚠️ Possible inverted null check — this pattern is often TRUE exactly when the column IS null, which would fail every good row. Verify before approving. {description or ''}".strip()
            if _has_malformed_boolean_combination(rule_expression):
                description = f"⚠️ Possible invalid SQL — ANDing/ORing two value-substitution calls (ISNULL/IFNULL/COALESCE) with no comparison is not valid boolean logic and will likely error at execution. Verify before approving. {description or ''}".strip()
            if _has_dot_chained_function_call(rule_expression):
                description = f"⚠️ Possible invalid SQL — a function cannot be called as col.FUNCTION(...); it must wrap the column, e.g. FUNCTION(col, ...). Verify before approving. {description or ''}".strip()
            if _has_uncorrelated_exists_comparison(rule_expression):
                description = (f"⚠️ Broken correlation — a comparison inside EXISTS uses an unqualified column on "
                               f"one side (e.g. `c.[X] = [X]`), which binds to the subquery's own table and makes "
                               f"the check always pass. This table's columns must be written `t.[X]` inside "
                               f"subqueries. Verify before approving. {description or ''}").strip()
            rules.append(DQRule(
                connection_id=connection_id,
                rule_name=r.get("rule_name", "unnamed_rule"),
                rule_description=description,
                table_fqn=report.table_fqn,
                layer=report.layer,
                column_name=column_name,
                rule_expression=rule_expression,
                rule_type=r.get("rule_type", "CUSTOM"),
                severity=r.get("severity", "MEDIUM"),
                is_cde_rule=r.get("is_cde_rule", False),
                status="draft",
                created_by=requested_by,
                generation_source="single_table",
            ))
        except Exception as e:
            logger.warning("Skipping malformed rule recommendation for %s: %s (raw=%r)",
                            report.table_fqn, e, r)
    return rules


def recommend_cross_table_rules(
    table_fqn: str,
    layer: str,
    primary_columns: list[dict],       # [{"name": ..., "type": ...}, ...] for the primary table
    sibling_tables: list[dict],        # [{"table_fqn": ..., "columns": [{"name","type"}, ...]}, ...]
    connection_id: str,
    sql_dialect: str = "postgresql",
    db: Session | None = None,
) -> list[DQRule]:
    """Recommend FK/referential-integrity rules between one table and every other
    table in the connection — recommend_rules() only ever sees one table's own
    profiling stats, so it has no way to know a sibling table even exists, let
    alone propose a cross-table check against it."""
    known_column_names = {c["name"] for c in primary_columns}
    known_table_fqns = {table_fqn} | {t["table_fqn"] for t in sibling_tables}

    prompt = None
    raw = None
    usage = None
    t0 = time.monotonic()
    try:
        prompt = build_cross_table_rules_prompt(
            table_fqn=table_fqn, layer=layer, primary_columns=primary_columns,
            sibling_tables=sibling_tables, sql_dialect=sql_dialect,
        )
        raw, usage = chat_with_usage(prompt)
        data = parse_llm_json(raw)
        rules_raw = data.get("rules", [])
        logger.info("Cross-table rule recommendation LLM call succeeded: connection=%s table=%s rules=%d",
                    connection_id, table_fqn, len(rules_raw))
        _log_ai_call(db, connection_id=connection_id, call_type="CROSS_TABLE",
                     table_fqn=table_fqn, prompt=prompt, raw_response=raw, status="success",
                     usage=usage, latency_ms=int((time.monotonic() - t0) * 1000))
    except Exception as e:
        logger.error("Cross-table rule recommendation LLM failed: %s", e)
        _log_ai_call(db, connection_id=connection_id, call_type="CROSS_TABLE",
                     table_fqn=table_fqn, prompt=prompt, raw_response=raw,
                     status="error", error_message=str(e), usage=usage,
                     latency_ms=int((time.monotonic() - t0) * 1000))
        raise

    rules = []
    for r in rules_raw:
        try:
            column_name = r.get("column_name")
            related = (r.get("related_table_fqn") or "").strip()
            # The model was only given OTHER tables as candidates, but sometimes proposes
            # a relationship back to the PRIMARY table itself anyway — e.g. a self-
            # referencing hierarchy check (ParentCategoryID must exist as a CategoryID in
            # this SAME table). That's a real, valid rule, but it is NOT a cross-table
            # dependency: tagging it "[Cross-table: X]" would be actively wrong, since
            # this tag drives both the UI's cross-table badge (misleadingly implying a
            # join to another table) and the sprawl-cleanup DELETE scoping in
            # /recommend and /recommend-cross-table (which would then clean up this rule
            # on the wrong regenerate action).
            # Strip brackets/quotes before comparing, not raw string equality — the
            # model doesn't consistently format related_table_fqn the same way twice
            # (seen live: "BronzeDB.br_categories" one call, "[BronzeDB].[br_categories]"
            # the next, for the exact same self-reference), so a naive string-equals
            # check against the unbracketed table_fqn produces false negatives that let
            # a genuine self-reference slip through mislabeled as cross-table. Rebuild
            # the full dotted path from any bracketed segments (rather than comparing
            # only the last segment) so two different layers with a same-named table
            # (e.g. BronzeDB.br_categories vs SilverDB.br_categories) are never
            # incorrectly treated as the same table.
            related_segments = _QUOTED_IDENTIFIER_INNER_RE.findall(related)
            related_normalized = ".".join(related_segments) if related_segments else related
            is_self_reference = bool(related) and related_normalized.lower() == table_fqn.strip().lower()
            if related and not is_self_reference:
                description = r.get("rule_description") or f"Cross-table check against {related}."
                description = f"[Cross-table: {related}] {description}"
            else:
                description = r.get("rule_description") or "Self-referencing integrity check within this table."
            rule_expression = (r.get("rule_expression") or "").strip()
            if not rule_expression:
                # Never default a missing expression to a tautology like 1=1 — that
                # persists a permanently-green rule that looks healthy forever.
                logger.warning("Skipping cross-table rule with no expression for %s (raw=%r)", table_fqn, r)
                continue
            # Only the primary table's own bare-column references are checkable
            # against a known list here — the sibling table's columns inside the
            # EXISTS subquery belong to a different table's schema entirely, so
            # flagging them against known_column_names would itself be a false
            # positive (the same class of bug already fixed for dotted qualifiers).
            unverified = []
            if column_name and column_name not in known_column_names:
                unverified.append(column_name)
            if unverified:
                refs = "', '".join(unverified)
                description = f"⚠️ Unverified column reference(s) ('{refs}' not found in profiled schema) — review before approving. {description}".strip()
            bad_tables = _unverified_table_references(rule_expression, known_table_fqns)
            if bad_tables:
                refs = "', '".join(bad_tables)
                description = f"⚠️ Unverified table reference(s) ('{refs}' does not match any known table — likely to error at execution) — review before approving. {description}".strip()
            if _has_inverted_null_check(rule_expression):
                description = f"⚠️ Possible inverted null check — verify before approving. {description}".strip()
            if _has_malformed_boolean_combination(rule_expression):
                description = f"⚠️ Possible invalid SQL — verify before approving. {description}".strip()
            if _has_dot_chained_function_call(rule_expression):
                description = f"⚠️ Possible invalid SQL — a function cannot be called as col.FUNCTION(...); it must wrap the column. Verify before approving. {description}".strip()
            if _has_null_hostile_fk_guard(rule_expression):
                description = (f"⚠️ Null-hostile FK guard — `X IS NOT NULL AND EXISTS(...)` fails every row "
                               f"where the FK is NULL (should be `X IS NULL OR EXISTS(...)`; a missing value is a "
                               f"NULL_CHECK rule's job). Verify before approving. {description}").strip()
            if _has_uncorrelated_exists_comparison(rule_expression):
                description = (f"⚠️ Broken correlation — a comparison inside EXISTS uses an unqualified column on "
                               f"one side (e.g. `c.[X] = [X]`), which binds to the subquery's own table and makes "
                               f"the check always pass. The primary table's columns must be written `t.[X]` inside "
                               f"subqueries. Verify before approving. {description}").strip()
            rules.append(DQRule(
                connection_id=connection_id,
                rule_name=r.get("rule_name", "unnamed_cross_table_rule"),
                rule_description=description,
                table_fqn=table_fqn,
                layer=layer,
                column_name=column_name,
                rule_expression=rule_expression,
                rule_type="FK",
                severity=r.get("severity", "MEDIUM"),
                is_cde_rule=r.get("is_cde_rule", False),
                status="draft",
                created_by="AI_AGENT",
                generation_source="cross_table",
                related_table_fqn=None if is_self_reference else (related_normalized or None),
            ))
        except Exception as e:
            logger.warning("Skipping malformed cross-table rule recommendation for %s: %s (raw=%r)",
                            table_fqn, e, r)
    return rules


def _nl_fallback(natural_language: str, table_fqn: str | None, reason: str) -> NLConvertResponse:
    return NLConvertResponse(
        rule_name="custom_rule",
        rule_expression="/* could not parse */",
        rule_type="CUSTOM",
        severity="MEDIUM",
        description=natural_language,
        is_cde_rule=False,
        explanation=reason,
        table_fqn=table_fqn,
        unresolved=True,
        unresolved_reason=reason,
    )


def nl_to_rule(
    table_fqn: str | None,
    natural_language: str,
    connection_id: str,
    layer: str = "UNKNOWN",
    sql_dialect: str = "postgresql",
    db: Session | None = None,
    known_columns: list[dict] | None = None,
) -> NLConvertResponse:
    # prompt is built inside the try (not before it) so a template/serialization
    # failure still produces a logged rule_ai_calls row instead of raising unlogged.
    prompt = None
    raw = None
    usage = None
    t0 = time.monotonic()
    try:
        prompt = build_nl_to_rule_prompt(
            table_fqn=table_fqn,
            layer=layer,
            natural_language=natural_language,
            sql_dialect=sql_dialect,
            known_columns=known_columns,
        )
        raw, usage = chat_with_usage(prompt)
        data = parse_llm_json(raw)
        logger.info("NL-to-rule LLM call succeeded: connection=%s table=%s", connection_id, table_fqn)
        _log_ai_call(db, connection_id=connection_id, call_type="NL_CONVERT",
                     table_fqn=table_fqn, prompt=prompt, raw_response=raw, status="success",
                     usage=usage, latency_ms=int((time.monotonic() - t0) * 1000))
    except Exception as e:
        logger.error("NL to rule LLM failed: %s", e)
        _log_ai_call(db, connection_id=connection_id, call_type="NL_CONVERT",
                     table_fqn=table_fqn, prompt=prompt, raw_response=raw,
                     status="error", error_message=str(e), usage=usage,
                     latency_ms=int((time.monotonic() - t0) * 1000))
        return _nl_fallback(natural_language, table_fqn, "LLM conversion failed. Please edit the expression manually.")

    try:
        column_name = data.get("column_name")
        unresolved = bool(data.get("unresolved", False))
        unresolved_reason = data.get("unresolved_reason")
        # Defense-in-depth: even if the model didn't flag itself as unresolved, catch
        # drift against the verified column list when we have one.
        rule_expression = data.get("rule_expression", "/* edit me */")
        if known_columns:
            known_names = {c["column_name"] for c in known_columns}
            if column_name and column_name not in known_names:
                unresolved = True
                unresolved_reason = unresolved_reason or f"Column '{column_name}' was not found in the verified schema for this table."
            # column_name only tags ONE column (or is null for a multi-column/
            # table-level rule) — it says nothing about the other columns a
            # cross-column expression like `[A] >= [B]` actually references, so
            # check the expression text itself too.
            bad_refs = _unverified_columns_in_expression(rule_expression, known_names, table_fqn)
            if bad_refs:
                unresolved = True
                refs = "', '".join(bad_refs)
                unresolved_reason = unresolved_reason or f"Expression references column(s) ('{refs}') not found in the verified schema for this table."

        if _has_inverted_null_check(rule_expression):
            unresolved = True
            unresolved_reason = (unresolved_reason + " " if unresolved_reason else "") + (
                "Possible inverted null check — this ISNULL/IFNULL/COALESCE-equality pattern is often "
                "TRUE exactly when the column IS null, which would fail every good row. Verify before approving."
            )
        if _has_malformed_boolean_combination(rule_expression):
            unresolved = True
            unresolved_reason = (unresolved_reason + " " if unresolved_reason else "") + (
                "Possible invalid SQL — ANDing/ORing two value-substitution calls (ISNULL/IFNULL/COALESCE) "
                "with no comparison is not valid boolean logic and will likely error at execution."
            )
        if _has_dot_chained_function_call(rule_expression):
            unresolved = True
            unresolved_reason = (unresolved_reason + " " if unresolved_reason else "") + (
                "Possible invalid SQL — a function cannot be called as col.FUNCTION(...); "
                "it must wrap the column, e.g. FUNCTION(col, ...)."
            )
        if _has_uncorrelated_exists_comparison(rule_expression):
            unresolved = True
            unresolved_reason = (unresolved_reason + " " if unresolved_reason else "") + (
                "Broken correlation — a comparison inside EXISTS uses an unqualified column on one "
                "side (e.g. `c.[X] = [X]`), which binds to the subquery's own table and makes the "
                "check always pass. This table's columns must be written `t.[X]` inside subqueries."
            )

        return NLConvertResponse(
            rule_name=data.get("rule_name", "custom_rule"),
            column_name=column_name,
            rule_expression=rule_expression,
            rule_type=data.get("rule_type", "CUSTOM"),
            severity=data.get("severity", "MEDIUM"),
            description=data.get("description", natural_language),
            is_cde_rule=data.get("is_cde_rule", False),
            explanation=data.get("explanation", ""),
            table_fqn=table_fqn,
            unresolved=unresolved,
            unresolved_reason=unresolved_reason,
        )
    except Exception as e:
        # A malformed field (wrong type, unexpected shape) must fall back safely
        # instead of raising a 500 straight through to the frontend.
        logger.error("NL to rule response failed validation: %s (raw=%r)", e, data)
        _log_ai_call(db, connection_id=connection_id, call_type="NL_CONVERT",
                     table_fqn=table_fqn, prompt=prompt, raw_response=raw,
                     status="error", error_message=f"validation error: {e}", usage=usage,
                     latency_ms=int((time.monotonic() - t0) * 1000))
        return _nl_fallback(natural_language, table_fqn, "The AI response was malformed. Please edit the expression manually.")
