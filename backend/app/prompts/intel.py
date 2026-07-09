from app.prompts._loader import load_prompt

ADVISORY_PROMPT_VERSION = "advisory-v1.0"
RECEIPT_PROMPT_VERSION = "receipt-v1.0"
DAILY_SUMMARY_PROMPT_VERSION = "daily-summary-v1.0"


def build_daily_summary_prompt(facts: dict) -> list[dict]:
    """Messages for the end-of-day narrative. facts = measured today-only values."""
    msgs = load_prompt("intel", "daily_summary")
    lines = ["Today's measured facts:"]
    lines.append(f"  trust score: {facts.get('score', '—')}"
                 + (f" ({facts['delta']:+.0f} vs yesterday)" if facts.get("delta") is not None else ""))
    runs_today = facts.get("runs_today", 0)
    if runs_today == 0:
        lines.append("  runs today: none (no rule executions ran today)")
    else:
        lines.append(f"  runs today: {runs_today} rule execution(s)"
                     + (f" — failing rules: {', '.join(facts['failing_rules'][:3])}" if facts.get("failing_rules") else " — all rules passing"))
    an = facts.get("anomalies_today", {})
    if an.get("total"):
        lines.append(f"  anomalies detected today: {an['total']} ({', '.join(f'{v} {k}' for k, v in an.get('by_severity', {}).items())})")
    else:
        lines.append("  anomalies detected today: none")
    dec = facts.get("decisions_today", [])
    if dec:
        lines.append(f"  human decisions today: {len(dec)} ({', '.join(dec[:4])})")
    else:
        lines.append("  human decisions today: none")
    if facts.get("simulations_today"):
        lines.append(f"  simulations/drills run today: {facts['simulations_today']}")
    lines.append(f"  still open: {facts.get('open_anomalies', 0)} anomalies, {facts.get('open_critical', 0)} critical rule failure(s)")
    lines.append("\nWrite the JSON summary now.")
    msgs.append({"role": "user", "content": "\n".join(lines)})
    return msgs


def build_receipt_prompt(table_fqn: str, trust_score: float, fields: list[dict],
                         upstream_issues: list[str], as_of: str) -> list[dict]:
    """Messages for trust-receipt narration. fields carry pre-computed status +
    raw signal text; the model only writes consumer-readable notes for them."""
    msgs = load_prompt("intel", "receipt")
    lines = [f"table: {table_fqn} (trust score {trust_score})", f"as of: {as_of}", "fields:"]
    for f in fields:
        lines.append(f"  - {f['name']} ({f['status']}): {f['signal']}")
    if upstream_issues:
        lines.append("upstream: " + "; ".join(upstream_issues[:3]))
    else:
        lines.append("upstream: no upstream feed issues recorded in lineage")
    lines.append("\nWrite the JSON receipt now.")
    msgs.append({"role": "user", "content": "\n".join(lines)})
    return msgs


def build_advisory_prompt(signals: dict) -> list[dict]:
    """Messages for pre-run advisory generation.

    signals is a dict of MEASURED values (open anomalies, failing rules, volume
    trends, ages, day-of-week pattern, fingerprints) — the model is instructed
    to quote only these, never invent.
    """
    msgs = load_prompt("intel", "advisory")

    lines = ["Today's measured signals:"]

    oa = signals.get("open_anomalies", {})
    if oa.get("total"):
        parts = [f"{v} {k}" for k, v in oa.get("by_severity", {}).items() if v]
        tables = ", ".join(oa.get("top_tables", [])[:3])
        lines.append(f"- Open anomalies: {oa['total']} ({', '.join(parts)}){f' — most affected: {tables}' if tables else ''}")
    else:
        lines.append("- Open anomalies: none")

    fails = signals.get("failing_rules", [])
    if fails:
        lines.append("- Rules failing in the latest run:")
        for f in fails[:5]:
            lines.append(f"  - {f['rule']} on {f['table']} ({f['fail_pct']}% failing, severity {f['severity']})")
    else:
        lines.append("- Rules failing in the latest run: none")

    rep = signals.get("repeat_offenders", [])
    if rep:
        lines.append(f"- Repeat offenders (failed in 2+ runs over the last 7 days): {', '.join(rep[:5])}")

    vol = signals.get("volume_trends", [])
    if vol:
        lines.append("- Volume changes vs previous profiling of the same table:")
        for v in vol[:5]:
            lines.append(f"  - {v['table']}: {v['delta_pct']:+.0f}% ({v['prev']:,} → {v['cur']:,} rows)")

    ages = signals.get("ages", {})
    lines.append(f"- Last profiling: {ages.get('profiling_h', 'never')}{'h ago' if isinstance(ages.get('profiling_h'), (int, float)) else ''}; "
                 f"last rule execution: {ages.get('execution_h', 'never')}{'h ago' if isinstance(ages.get('execution_h'), (int, float)) else ''}")

    dow = signals.get("dow", {})
    if dow.get("today_avg") is not None:
        lines.append(f"- Day-of-week pattern (last 90d): {dow['today_name']}s average {dow['today_avg']} anomalies vs {dow['overall_avg']}/day overall; today is {dow['today_name']}")

    fps = signals.get("fingerprints", [])
    if fps:
        lines.append("- Past-incident fingerprints (resolved incidents on this connection):")
        for fp in fps[:3]:
            lines.append(f"  - {fp['date']} on {fp['table']}: {fp['cause']} — resolved by: {fp['resolution']}")

    lines.append(f"\nComputed predicted trust score for today's run: {signals.get('predicted_score')}/100.")
    lines.append("Write the JSON advisory now.")
    msgs.append({"role": "user", "content": "\n".join(lines)})
    return msgs
