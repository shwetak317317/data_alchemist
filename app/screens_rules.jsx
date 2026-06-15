// DataTrust — Screen: Rule Studio + Natural Language → DQ converter
(function () {
  const D = window.DT;

  // Mini NL→rule "engine": maps a phrase to a structured rule
  function synthRule(text) {
    const t = text.toLowerCase();
    if (t.includes("25000") || t.includes("25,000") || (t.includes("exceed") && t.includes("revenue"))) {
      return { name: "net_revenue_max_threshold", col: "net_revenue", expr: "net_revenue <= 25000 AND channel != 'CORP'", sev: "HIGH", cde: true,
        why: "99.97% of orders have net_revenue < $25,000. The top 0.03% (552 orders) are either bulk B2B (channel='CORP') or likely data-entry errors.",
        refine: "net_revenue <= 25000 AND channel != 'CORP'  (excludes legitimate corporate orders)" };
    }
    if (t.includes("negative") || t.includes(">= 0") || t.includes("not be negative")) {
      return { name: "amount_non_negative", col: "net_revenue", expr: "net_revenue >= 0", sev: "HIGH", cde: true,
        why: "Negative revenue indicates a data-entry error or an uncorrected return record. 0 such rows exist today, but the rule guards future loads.", refine: null };
    }
    if (t.includes("email")) {
      return { name: "email_format_valid", col: "email", expr: "email RLIKE '^[^@]+@[^@]+\\\\.[^@]+$'", sev: "MEDIUM", cde: true,
        why: "email is a CDE on customers_master. 0.4% of values currently fail a basic format pattern.", refine: null };
    }
    if (t.includes("duplicate") || t.includes("unique")) {
      return { name: "order_id_unique", col: "order_id", expr: "count(*) = count(distinct order_id)", sev: "CRITICAL", cde: false,
        why: "order_id is the primary key. 23 duplicates were detected in today's Bronze load — a uniqueness rule prevents silent fan-out on joins.", refine: null };
    }
    return { name: "custom_rule", col: "net_revenue", expr: "/* AI-generated expression from your expectation */", sev: "MEDIUM", cde: false,
      why: "The agent translated your expectation into a structured check. Review the expression and severity before approving.", refine: null };
  }

  const Rules = () => {
    const { go, ruleDecisions, setRuleDecisions, customRules, setCustomRules, statusPromoted, setTrustScore, activeConnectionId, activeConnectionName } = useApp();
    const [nl, setNl] = React.useState("A single order's net revenue should never exceed $25,000");
    const [generated, setGenerated] = React.useState(null);
    const [nlLoading, setNlLoading] = React.useState(false);
    const [editId, setEditId] = React.useState(null);
    const [exprDraft, setExprDraft] = React.useState("");
    const [fLayer, setFLayer] = React.useState("ALL");
    const [apiRules, setApiRules] = React.useState([]);
    useIcons();

    React.useEffect(() => {
      if (!window.DTApi || !activeConnectionId) return;
      window.DTApi.listRules(activeConnectionId)
        .then(rows => { if (rows) setApiRules(rows.map((r, i) => ({
          id: r.rule_id || (i + 1), name: r.rule_name || r.name,
          expr: r.rule_expression || r.expr, note: r.description,
          layer: (r.layer || "SILVER").toUpperCase(),
          sev: r.severity || "MEDIUM", by: r.nl_source ? "NL" : "AI",
          status: r.status || "pending",
        }))); })
        .catch(() => {});
    }, [activeConnectionId]);

    const allRules = [...apiRules, ...customRules];
    const visible = fLayer === "ALL" ? allRules : allRules.filter(r => r.layer === fLayer);
    const decide = (id, d) => {
      setRuleDecisions(x => ({ ...x, [id]: d }));
      toast(`Rule #${id} ${d} · logged to audit trail`, { kind: d === "rejected" ? "info" : "success" });
      window.DTApi?.decideRule?.(id, { status: d }).catch(() => {});
    };
    const statusOf = (r) => ruleDecisions[r.id] || r.status;

    const approvedTotal = allRules.filter(r => statusOf(r) === "approved" || statusOf(r) === "active").length;

    const convertNl = () => {
      if (window.DTApi && activeConnectionId) {
        setNlLoading(true);
        window.DTApi.nlToRule({ natural_language: nl, connection_id: activeConnectionId })
          .then(r => {
            setGenerated({ name: r.rule_name, col: r.column_name, expr: r.rule_expression,
              sev: r.severity || "MEDIUM", cde: false, why: r.rationale || r.explanation || "", refine: null,
              table_fqn: r.table_fqn || null });
          })
          .catch(() => setGenerated(synthRule(nl)))
          .finally(() => setNlLoading(false));
      } else {
        setGenerated(synthRule(nl));
      }
    };

    // ---- per-rule run ----
    const [runState, setRunState] = React.useState({}); // id -> 'running' | {pass, failCnt, failPct, ms}
    const FAILING = {
      1: { failCnt: "206,338", failPct: "11.2" }, // net_revenue not null
      3: { failCnt: "882", failPct: "0.05" },      // status whitelist
      4: { failCnt: "147", failPct: "0.008" },     // gross > 0
      7: { failCnt: "—", failPct: "0" },           // file arrival
      11: { failCnt: "23", failPct: "0.0005" },    // dedup
    };
    const runOne = (r) => {
      setRunState(s => ({ ...s, [r.id]: "running" }));
      const t0 = Date.now();
      setTimeout(() => {
        const f = FAILING[r.id];
        setRunState(s => ({ ...s, [r.id]: f ? { pass: false, ...f, ms: 1.2 } : { pass: true, failCnt: "0", failPct: "0", ms: (0.4 + Math.random()).toFixed(1) } }));
        toast(f ? `Rule #${r.id} ran — FAILED (${f.failCnt} records)` : `Rule #${r.id} ran — PASSED`, { kind: f ? "error" : "success" });
      }, 850 + Math.random() * 500);
    };
    const runLayer = (layer) => {
      const ids = visible.filter(r => layer === "ALL" || r.layer === layer).map(r => r.id);
      ids.forEach(id => setRunState(s => ({ ...s, [id]: "running" })));
      toast(`Running ${ids.length} rules${layer === "ALL" ? "" : " · " + layer + " layer"}…`, { kind: "info" });
      ids.forEach((id, i) => setTimeout(() => {
        const f = FAILING[id];
        setRunState(s => ({ ...s, [id]: f ? { pass: false, ...f, ms: 1.2 } : { pass: true, failCnt: "0", failPct: "0", ms: (0.4 + Math.random()).toFixed(1) } }));
      }, 700 + i * 220));
    };

    return (
      <div className="dt-fade-up">
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="shield-check" sub={`${allRules.length} rules recommended by the agent. Every rule needs explicit human review — nothing activates without approval.`}
            right={<Chip intent="brand" dot>{approvedTotal} active</Chip>}>Rule Studio{activeConnectionName ? ` — ${activeConnectionName}` : ""}</SectionTitle>
          <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
            <Eyebrow>Layer</Eyebrow>
            {["ALL", "RAW", "BRONZE", "SILVER", "GOLD"].map(l => (
              <button key={l} onClick={() => setFLayer(l)} style={{ background: fLayer === l ? "var(--brand-soft)" : "#fff", color: fLayer === l ? "var(--brand)" : "var(--fg-2)",
                border: `1px solid ${fLayer === l ? "var(--brand-ring)" : "var(--grey-200)"}`, borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{l}</button>
            ))}
            <div style={{ flex: 1 }}></div>
            <Button size="sm" variant="primary" icon="circle-play" onClick={() => runLayer(fLayer)}>Run {fLayer === "ALL" ? "all" : fLayer}</Button>
            <Button size="sm" variant="soft" icon="check-check" onClick={() => { allRules.filter(r => r.sev === "LOW").forEach(r => setRuleDecisions(x => ({ ...x, [r.id]: "approved" }))); toast("All LOW-severity non-CDE rules approved", { kind: "success" }); }}>Bulk approve LOW</Button>
          </div>
        </Card>

        {/* rule list */}
        <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          {visible.map((r, i) => {
            const st = statusOf(r);
            const done = st === "approved" || st === "active";
            const rejected = st === "rejected";
            const run = runState[r.id];
            return (
              <div key={r.id} style={{ padding: "14px 20px", borderTop: i ? "1px solid var(--grey-100)" : "none",
                background: rejected ? "var(--grey-50)" : done ? "var(--green-50)" : "transparent", opacity: rejected ? 0.6 : 1 }}>
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 14, color: "var(--fg-3)", width: 22, flexShrink: 0, paddingTop: 1 }}>{r.id}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.name}</span>
                      <LayerPill layer={r.layer} size="sm" />
                      <Severity level={r.sev} size="sm" />
                      <Chip intent="neutral" variant="outline" size="sm">{r.by}</Chip>
                    </div>
                    {editId === r.id ? (
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        <input value={exprDraft} onChange={(e) => setExprDraft(e.target.value)} style={{ flex: 1, fontFamily: '"JetBrains Mono", monospace', fontSize: 12, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--brand)", outline: "none", boxShadow: "0 0 0 3px var(--brand-ring)" }} />
                        <Button size="sm" variant="primary" onClick={() => { setEditId(null); decide(r.id, "edited"); }}>Save</Button>
                      </div>
                    ) : (
                      <Mono style={{ color: "var(--fg-2)", display: "block", background: "var(--grey-50)", padding: "6px 10px", borderRadius: 6, marginTop: 2 }}>{r.expr}</Mono>
                    )}
                    {r.note && <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 5 }}>{r.note}</div>}
                    {/* run result strip */}
                    {run && (run === "running"
                      ? <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "var(--brand)", fontWeight: 600 }}>
                          <span className="dt-spin" style={{ width: 13, height: 13, border: "2px solid var(--brand-ring)", borderTopColor: "var(--brand)", borderRadius: "50%" }}></span>Running against live data…</div>
                      : <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginTop: 8, padding: "6px 12px", borderRadius: 8, background: run.pass ? "var(--green-50)" : "var(--red-50)" }}>
                          {run.pass ? <Chip intent="success" size="sm" icon="check">PASS</Chip> : <Chip intent="danger" size="sm" icon="x">FAIL</Chip>}
                          <span style={{ fontSize: 12, color: "var(--fg-2)" }}>{run.pass ? "0 violations" : `${run.failCnt} violations · ${run.failPct}%`}</span>
                          <span style={{ fontSize: 11, color: "var(--fg-3)" }}>· {run.ms}s</span>
                        </div>)}
                  </div>
                  <div style={{ flexShrink: 0, display: "flex", gap: 6, alignItems: "center" }}>
                    {editId !== r.id && <IconBtn icon="play" title="Run this rule" size={30} onClick={() => runOne(r)} />}
                    {done ? <Chip intent="success" size="sm" icon="check">{st === "active" ? "Active" : "Approved"}</Chip>
                      : rejected ? <Chip intent="neutral" size="sm">Rejected</Chip>
                      : editId !== r.id && (
                        <>
                          <IconBtn icon="check" title="Approve" size={30} onClick={() => decide(r.id, "approved")} />
                          <IconBtn icon="pencil" title="Edit" size={30} onClick={() => { setEditId(r.id); setExprDraft(r.expr); }} />
                          <IconBtn icon="x" title="Reject" size={30} danger onClick={() => decide(r.id, "rejected")} />
                        </>
                      )}
                  </div>
                </div>
              </div>
            );
          })}
        </Card>

        {/* NL → DQ converter */}
        <Card style={{ marginBottom: 16, border: "1px solid var(--brand-ring)", background: "linear-gradient(180deg, var(--blue-50), #fff)" }}>
          <SectionTitle icon="wand-2" sub="Type a plain-English quality expectation. The agent converts it into a structured, reviewable DQ rule.">Natural language → DQ rule</SectionTitle>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <Input icon="message-square" value={nl} onChange={setNl} placeholder="e.g. revenue should never be negative" style={{ flex: 1 }}
              onKeyDown={(e) => { if (e.key === "Enter") convertNl(); }} />
            <Button variant="primary" icon="sparkles" disabled={nlLoading} onClick={() => convertNl()}>{nlLoading ? "Converting…" : "Convert to rule"}</Button>
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap" }}>
            {["revenue should never be negative", "emails must be valid format", "order_id must be unique"].map(s => (
              <button key={s} onClick={() => { setNl(s); setGenerated(synthRule(s)); }} style={{ fontSize: 11.5, color: "var(--fg-2)", background: "#fff", border: "1px solid var(--grey-200)", borderRadius: 999, padding: "4px 11px", cursor: "pointer" }}>{s}</button>
            ))}
          </div>

          {generated && (
            <div className="dt-fade-up" style={{ marginTop: 16, background: "#fff", borderRadius: 12, border: "1px solid var(--grey-200)", padding: 18 }}>
              <Eyebrow style={{ marginBottom: 12 }}>Generated rule — review before approving</Eyebrow>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 9, columnGap: 14, fontSize: 13, alignItems: "baseline" }}>
                <span style={{ color: "var(--fg-3)" }}>Rule name</span><Mono style={{ fontWeight: 700 }}>{generated.name}</Mono>
                <span style={{ color: "var(--fg-3)" }}>Table</span><Mono>{generated.table_fqn || (activeConnectionName ? activeConnectionName + " (auto)" : "connection default")}</Mono>
                <span style={{ color: "var(--fg-3)" }}>Expression</span><Mono style={{ background: "var(--grey-50)", padding: "6px 10px", borderRadius: 6 }}>{generated.expr}</Mono>
                <span style={{ color: "var(--fg-3)" }}>Severity</span><span><Severity level={generated.sev} size="sm" /></span>
                <span style={{ color: "var(--fg-3)" }}>CDE impact</span><span>{generated.cde ? <Chip intent="brand" size="sm" dot>YES — CDE</Chip> : <span style={{ color: "var(--fg-2)" }}>No</span>}</span>
              </div>
              <div style={{ marginTop: 14, padding: 12, background: "var(--blue-50)", borderRadius: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}><i data-lucide="lightbulb" style={{ width: 14, height: 14, color: "var(--brand)" }}></i><span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--brand)", letterSpacing: ".03em" }}>WHY THIS RULE MAKES SENSE</span></div>
                <div style={{ fontSize: 12.5, color: "var(--fg-1)", lineHeight: 1.55 }}>{generated.why}</div>
                {generated.refine && <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 8 }}><strong>Suggested refinement:</strong> <Mono>{generated.refine}</Mono></div>}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <Button variant="primary" icon="check" onClick={() => { const id = 100 + customRules.length; setCustomRules(c => [...c, { id, name: generated.name, expr: generated.refine || generated.expr, layer: "SILVER", sev: generated.sev, by: "Ravi", status: "approved" }]); setGenerated(null); toast(`Rule ${generated.name} approved & added · Ravi Kumar`, { kind: "success" }); }}>{generated.refine ? "Approve with refinement" : "Approve & add"}</Button>
                <Button variant="soft" icon="pencil">Edit expression</Button>
                <Button variant="ghost" onClick={() => setGenerated(null)}>Reject</Button>
              </div>
            </div>
          )}
        </Card>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="primary" iconRight="arrow-right" onClick={() => go("execution")}>Activate rule set & run checks</Button>
        </div>
      </div>
    );
  };

  window.DTScreens.rules = Rules;
})();
