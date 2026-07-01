"""
Eval harness for scenario classification.

Usage (from the backend/ directory):
    python eval_classify.py            # regex only (no API key needed)
    python eval_classify.py --llm      # regex + LLM (needs ANTHROPIC_API_KEY / llm_config.yaml)
    python eval_classify.py --llm --verbose

Exit code: 0 if accuracy >= 90%, 1 otherwise.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Resolve the package root so imports work when run as a script from backend/.
sys.path.insert(0, str(Path(__file__).parent))

from app.services.simulation_classify import ClassifyResult, classify_regex, classify_with_llm

# ── Labelled test set ─────────────────────────────────────────────────────────
# Each entry: (input_text, expected_key, expected_compound)
# compound=None means "don't assert compound, any value is fine"

TEST_CASES: list[tuple[str, str, bool | None]] = [
    # ── segment (5) ──────────────────────────────────────────────────────────
    ("The Northeast region is sending zero orders today",                            "segment",   False),
    ("APAC region stopped sending sales data since midnight",                        "segment",   False),
    ("West Coast orders are completely missing from today's load",                   "segment",   False),
    ("Our EMEA region data is absent from today's pipeline run",                     "segment",   False),
    ("Southeast channel went offline this morning — no records coming through",      "segment",   False),

    # ── nullcol (5) ──────────────────────────────────────────────────────────
    ("net_revenue column has nulls for all of today's orders",                       "nullcol",   False),
    ("Imagine revenue data was not loaded for today's orders",                       "nullcol",   False),
    ("discount_amount is NULL for today's partition — the field was not populated",  "nullcol",   False),
    ("The customer_age field is blank for 30% of records this morning",              "nullcol",   False),
    ("profit_margin was not calculated for yesterday's Silver table load",            "nullcol",   False),

    # ── volume (5) ───────────────────────────────────────────────────────────
    ("Orders dropped 60% overnight",                                                 "volume",    False),
    ("bronze.orders has only 40% of yesterday's row count after this morning's load","volume",    False),
    ("The ingestion pipeline missed 70% of today's records",                         "volume",    False),
    ("Row count in silver table is down by 2 million compared to last week average", "volume",    False),
    ("Today's data volume is 55% below the 7-day rolling average",                   "volume",    False),

    # ── whitelist (5) ────────────────────────────────────────────────────────
    ("A new status code GHOST appeared in 5000 orders",                              "whitelist", False),
    ("payment_type has 3000 rows with value ZZZ which is not in our approved enum",  "whitelist", False),
    ("An invalid order_status value PENDING_V2 showed up after the deploy",          "whitelist", False),
    ("5000 records have channel_code SHADOW that is not in our whitelist",           "whitelist", False),
    ("order_state field has an unapproved value LIMBO appearing in today's data",    "whitelist", False),

    # ── source (5) ───────────────────────────────────────────────────────────
    ("The CRM feed has not arrived today",                                           "source",    False),
    ("Our vendor data extract is 4 hours late and still has not landed",             "source",    False),
    ("raw.crm_customers table has no new rows — the file never arrived this morning","source",    False),
    ("The nightly ERP extract SLA was breached by 2 hours",                          "source",    False),
    ("Source file from payment processor did not land and downstream tables are stale","source",  False),

    # ── unknown (3) ──────────────────────────────────────────────────────────
    ("My ETL pipeline is running very slowly today",                                 "unknown",   False),
    ("A column was added to the orders schema without change management approval",   "unknown",   False),
    ("Something looks wrong with today's data",                                      "unknown",   None),

    # ── compound (2) — expected_compound=True for LLM eval; None for regex (regex can't detect compound)
    ("Revenue column is null AND overall order volume is down 60% today",            "nullcol",   True),
    ("The Northeast region has zero orders AND the CRM feed is missing",             "segment",   True),
]

# For regex eval, compound detection is not expected. Override expected_compound to None.
REGEX_TEST_CASES = [(t, k, None) for t, k, _ in TEST_CASES]


# ── Eval runner ───────────────────────────────────────────────────────────────

def _check(result: ClassifyResult, expected_key: str, expected_compound: bool | None) -> bool:
    key_ok = result.key == expected_key
    compound_ok = (expected_compound is None) or (result.compound == expected_compound)
    return key_ok and compound_ok


def run_regex_eval(verbose: bool = False) -> float:
    per_class: dict[str, list[bool]] = {}
    overall: list[bool] = []

    for text, expected_key, expected_compound in REGEX_TEST_CASES:
        result = classify_regex(text)
        ok = _check(result, expected_key, expected_compound)
        overall.append(ok)
        per_class.setdefault(expected_key, []).append(ok)

        if verbose and not ok:
            print(f"  FAIL  [{expected_key}] got={result.key} conf={result.confidence:.2f}  |  {text[:70]}")

    accuracy = sum(overall) / len(overall)
    _print_report("REGEX FALLBACK", per_class, accuracy)
    return accuracy


async def run_llm_eval(verbose: bool = False) -> float:
    per_class: dict[str, list[bool]] = {}
    overall: list[bool] = []

    for text, expected_key, expected_compound in TEST_CASES:
        result = await classify_with_llm(text)
        ok = _check(result, expected_key, expected_compound)
        overall.append(ok)
        per_class.setdefault(expected_key, []).append(ok)

        status = "✓" if ok else "✗"
        if verbose or not ok:
            print(f"  {status} [{expected_key}→{result.key}] conf={result.confidence:.2f} "
                  f"comp={result.compound}  |  {text[:65]}")

    accuracy = sum(overall) / len(overall)
    _print_report("LLM CLASSIFIER", per_class, accuracy)
    return accuracy


def _print_report(label: str, per_class: dict[str, list[bool]], accuracy: float) -> None:
    print(f"\n{'-' * 60}")
    print(f"  {label}   overall accuracy: {accuracy:.1%}  ({sum(sum(v) for v in per_class.values())}/{sum(len(v) for v in per_class.values())})")
    print(f"{'-' * 60}")
    for cls in ("segment", "nullcol", "volume", "whitelist", "source", "unknown", "compound"):
        hits = per_class.get(cls, [])
        if not hits:
            continue
        bar = "#" * sum(hits) + "." * (len(hits) - sum(hits))
        print(f"  {cls:<12} {bar}  {sum(hits)}/{len(hits)}")
    threshold = "PASS" if accuracy >= 0.90 else "FAIL  (target >= 90%)"
    print(f"\n  {threshold}")
    print(f"{'-' * 60}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Eval classify accuracy")
    parser.add_argument("--llm", action="store_true", help="Also run LLM classifier")
    parser.add_argument("--verbose", action="store_true", help="Print every case")
    args = parser.parse_args()

    print(f"\nRunning eval on {len(TEST_CASES)} test cases  (prompt_version: classify-v1.0)\n")

    # Regex is informational only — the 90% gate applies to the LLM classifier.
    run_regex_eval(verbose=args.verbose)

    if args.llm:
        llm_acc = asyncio.run(run_llm_eval(verbose=args.verbose))
        sys.exit(0 if llm_acc >= 0.90 else 1)

    print("\n  (run with --llm to apply the 90% accuracy gate against the LLM classifier)")
