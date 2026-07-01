"""Offline + online classifier accuracy evaluator.

Usage:
    # Offline — uses regex backstop only, no LLM calls, no DB needed
    python scripts/eval_classifier.py --offline

    # Online — calls the real LLM (requires ANTHROPIC_API_KEY + running postgres)
    python scripts/eval_classifier.py

Exit codes:
    0  overall accuracy >= 85%
    1  overall accuracy < 85% (CI gate)
    2  test suite error (import / auth / etc.)

The --offline flag tests classify_regex only.  Online mode tests classify_with_llm
(which itself falls back to regex on LLM failure, so it tests the full stack).
"""
import argparse
import asyncio
import json
import sys
import textwrap
from typing import NamedTuple


# ── Ground-truth test cases ───────────────────────────────────────────────────

class Case(NamedTuple):
    text: str
    expected_key: str
    category: str  # human label for grouping

CASES: list[Case] = [
    # segment (4)
    Case("The Northeast region is sending zero orders today",           "segment", "segment"),
    Case("APAC region stopped sending sales data since midnight",       "segment", "segment"),
    Case("West Coast channel has been offline since 2 AM",             "segment", "segment"),
    Case("Chicago partition is missing — no records for 6 hours",      "segment", "segment"),

    # nullcol (4)
    Case("net_revenue column has nulls for all of today's orders",     "nullcol", "nullcol"),
    Case("The revenue field is blank for today's partition",           "nullcol", "nullcol"),
    Case("amount column shows NULL across 12% of rows",                "nullcol", "nullcol"),
    Case("Imagine revenue data was not loaded for today's orders",     "nullcol", "nullcol"),

    # volume (4)
    Case("Orders dropped 60% overnight",                               "volume",  "volume"),
    Case("bronze.orders has only 40% of yesterday's row count",        "volume",  "volume"),
    Case("We received only 200 records today vs the usual 1000",       "volume",  "volume"),
    Case("Ingestion ran 3x slower and only 40% of expected rows arrived", "volume", "volume"),

    # whitelist (2)
    Case("A new status code GHOST appeared in 5000 orders",            "whitelist", "whitelist"),
    Case("payment_type has 3000 rows with value ZZZ not in our enum",  "whitelist", "whitelist"),

    # source (2)
    Case("The CRM feed has not arrived today",                         "source",  "source"),
    Case("Vendor extract is 4 hours late and has not landed yet",      "source",  "source"),

    # unknown (4)
    Case("data is wrong",                                              "unknown", "unknown"),
    Case("My ETL pipeline is running very slowly today",               "unknown", "unknown"),
    Case("A column was added to orders schema without approval",       "unknown", "unknown"),
    Case("Something looks off with today's data",                      "unknown", "unknown"),
]

TOTAL = len(CASES)
TARGET_ACCURACY = 0.85


# ── Runner ────────────────────────────────────────────────────────────────────

def run_offline() -> list[dict]:
    """Test classify_regex — synchronous, no LLM calls."""
    from app.services.simulation_classify import classify_regex

    results = []
    for case in CASES:
        result = classify_regex(case.text)
        ok = result.key == case.expected_key
        results.append({
            "text":     case.text[:60],
            "category": case.category,
            "expected": case.expected_key,
            "got":      result.key,
            "conf":     round(result.confidence, 3),
            "ok":       ok,
        })
    return results


async def _run_online_async() -> list[dict]:
    """Test classify_with_llm (full LLM stack with regex fallback)."""
    from app.services.simulation_classify import classify_with_llm

    results = []
    for case in CASES:
        result = await classify_with_llm(case.text)
        ok = result.key == case.expected_key
        results.append({
            "text":     case.text[:60],
            "category": case.category,
            "expected": case.expected_key,
            "got":      result.key,
            "conf":     round(result.confidence, 3),
            "method":   result.method,
            "ok":       ok,
        })
    return results


def run_online() -> list[dict]:
    return asyncio.run(_run_online_async())


# ── Reporting ─────────────────────────────────────────────────────────────────

def report(results: list[dict], mode: str) -> int:
    correct = sum(1 for r in results if r["ok"])
    overall_acc = correct / TOTAL

    # Per-category breakdown
    cats: dict[str, dict] = {}
    for r in results:
        cat = r["category"]
        if cat not in cats:
            cats[cat] = {"total": 0, "correct": 0}
        cats[cat]["total"] += 1
        cats[cat]["correct"] += r["ok"]

    print(f"\n{'='*60}")
    print(f"  Classifier eval — mode={mode}  cases={TOTAL}")
    print(f"{'='*60}")

    print(f"\nPer-category accuracy:")
    for cat, stats in sorted(cats.items()):
        acc = stats["correct"] / stats["total"]
        mark = "OK" if acc >= TARGET_ACCURACY else "!!"
        print(f"  {mark}  {cat:<12}  {stats['correct']}/{stats['total']}  ({acc:.0%})")

    failures = [r for r in results if not r["ok"]]
    if failures:
        print(f"\nFailed cases ({len(failures)}):")
        for r in failures:
            print(f"  expected={r['expected']:<10}  got={r['got']:<10}  conf={r['conf']}  text={r['text']!r}")

    print(f"\nOverall: {correct}/{TOTAL}  ({overall_acc:.0%})")

    if overall_acc >= TARGET_ACCURACY:
        print(f"PASS  (>= {TARGET_ACCURACY:.0%})\n")
        return 0
    else:
        print(f"FAIL  (< {TARGET_ACCURACY:.0%})\n")
        return 1


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate scenario classifier accuracy.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            Exit codes:
              0  overall accuracy >= 85%
              1  overall accuracy <  85%
              2  import or runtime error
        """),
    )
    parser.add_argument(
        "--offline", action="store_true",
        help="Use regex backstop only — no LLM calls, no database needed.",
    )
    parser.add_argument(
        "--json", dest="json_out", action="store_true",
        help="Also print full results as a JSON array to stdout.",
    )
    args = parser.parse_args()

    mode = "offline (regex)" if args.offline else "online (LLM)"
    print(f"Running classifier eval in {mode} mode …")

    try:
        results = run_offline() if args.offline else run_online()
    except Exception as exc:
        print(f"\nERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(2)

    if args.json_out:
        print(json.dumps(results, indent=2))

    sys.exit(report(results, mode))


if __name__ == "__main__":
    main()
