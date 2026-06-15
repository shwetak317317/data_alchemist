// DataTrust — Screen: DQ Execution results + failed records drill-down
(function () {
  const D = window.DT;

  const FailedRecords = ({ onClose }) => {
    useIcons();
    return (
      <Modal open={true} onClose={onClose} width={760} title="Failed records — net_revenue IS NOT NULL"
        footer={<>
          <Button variant="soft" icon="message-square-plus">Add note</Button>
          <Button variant="soft">Mark as expected</Button>
          <Button variant="danger" icon="siren" onClick={() => { toast("Escalated to Deepa Nair (Silver Pipeline Owner) · Ticket DQ-2024-1108-001", { kind: "warning" }); onClose(); }}>Escalate to pipeline owner</Button>
        </>}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <Chip intent="danger" variant="fill" size="sm">CRITICAL</Chip>
          <span style={{ fontSize: 13, color: "var(--fg-2)" }}>Showing 8 of <strong style={{ color: "var(--fg-1)" }}>206,338</strong> records</span>
        </div>
        <div style={{ overflowX: "auto", border: "1px solid var(--grey-100)", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: "var(--grey-50)", textAlign: "left" }}>
              {["order_id", "customer_id", "order_date", "status", "gross_amount", "net_revenue"].map(h => <th key={h} style={{ padding: "8px 12px", fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: "var(--fg-2)", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {[].map((r) => (
                <tr key={r.order_id} style={{ borderTop: "1px solid var(--grey-100)" }}>
                  <td style={{ padding: "7px 12px" }}><Mono style={{ fontSize: 11.5 }}>{r.order_id}</Mono></td>
                  <td style={{ padding: "7px 12px" }}><Mono style={{ fontSize: 11.5 }}>{r.customer_id}</Mono></td>
                  <td style={{ padding: "7px 12px" }}><Mono style={{ fontSize: 11.5 }}>{r.order_date}</Mono></td>
                  <td style={{ padding: "7px 12px" }}><Mono style={{ fontSize: 11.5 }}>{r.status}</Mono></td>
                  <td style={{ padding: "7px 12px" }}><Mono style={{ fontSize: 11.5 }}>{r.gross}</Mono></td>
                  <td style={{ padding: "7px 12px" }}><Mono style={{ fontSize: 11.5, color: "var(--red-500)", fontWeight: 700 }}>NULL</Mono></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 14, padding: 14, background: "var(--grey-50)", borderRadius: 10 }}>
          <Eyebrow style={{ marginBottom: 8 }}>Pattern analysis</Eyebrow>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--fg-1)", lineHeight: 1.7 }}>
            <li>100% of null net_revenue rows have order_date = 2024-11-05 (today)</li>
            <li>gross_amount is populated for all null net_revenue rows ✓</li>
            <li>channel distribution: WEB 58%, APP 31%, STORE 11% (normal)</li>
            <li>All regions affected proportionally</li>
          </ul>
        </div>
        <div style={{ marginTop: 12, padding: 14, background: "var(--blue-50)", borderRadius: 10, borderLeft: "3px solid var(--brand)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}><i data-lucide="bot" style={{ width: 15, height: 15, color: "var(--brand)" }}></i><span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--brand)" }}>AI INSIGHT</span></div>
          <div style={{ fontSize: 12.5, color: "var(--fg-1)", lineHeight: 1.6 }}>All null records are from today. gross_amount is populated, meaning source data arrived but the <strong>discount calculation step in the Silver pipeline failed or was skipped</strong>. This is NOT a source data problem — it is a pipeline step failure for order_date = today.</div>
        </div>
      </Modal>
    );
  };

  const RunOverlay = ({ onDone }) => {
    const [n, setN] = React.useState(0);
    React.useEffect(() => {
      if (n >= 31) { const t = setTimeout(onDone, 400); return () => clearTimeout(t); }
      const t = setTimeout(() => setN(x => Math.min(31, x + Math.ceil(Math.random() * 3))), 70);
      return () => clearTimeout(t);
    }, [n]);
    return (
      <Card style={{ textAlign: "center", padding: 48 }}>
        <span className="dt-spin" style={{ width: 38, height: 38, border: "3px solid var(--brand-ring)", borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block", marginBottom: 18 }}></span>
        <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 17, marginBottom: 6 }}>Executing rules across all layers</div>
        <div style={{ fontSize: 13, color: "var(--fg-2)", marginBottom: 18 }}>Raw → Bronze → Silver → Gold</div>
        <div style={{ maxWidth: 360, margin: "0 auto" }}><Bar pct={(n / 31) * 100} height={8} /></div>
        <Mono style={{ marginTop: 10, color: "var(--fg-2)", display: "block" }}>{n} / 31 rules</Mono>
      </Card>
    );
  };

  const Execution = () => {
    const { go, activeConnectionId, lastRunId, setLastRunId } = useApp();
    const [phase, setPhase] = React.useState("results"); // running | results
    const [showRecords, setShowRecords] = React.useState(false);
    const [layerRun, setLayerRun] = React.useState({}); // layer -> 'running' | 'done'
    const [ruleRun, setRuleRun] = React.useState({});   // id -> 'running' | 'done'
    const [layerScores, setLayerScores] = React.useState([]);
    const [execResults, setExecResults] = React.useState([]);
    const [runMeta, setRunMeta] = React.useState(null);
    useIcons();

    // Fetch latest run results on mount / connection change
    React.useEffect(() => {
      if (!window.DTApi || !activeConnectionId) return;
      setExecResults([]);
      setLayerScores([]);
      setRunMeta(null);
      // Load results for the demo run so the screen is populated on first view
      window.DTApi.getRunResults("demo-run-001")
        .then(r => {
          if (!r) return;
          const mapped = (r.results || []).map(x => ({
            id: x.rule_id, rule: x.rule_name, status: x.status,
            failCnt: x.failed_records > 0 ? x.failed_records.toLocaleString() : "0",
            failPct: x.fail_pct || 0, sev: x.severity || "—",
            layer: (x.layer || "SILVER").toUpperCase(),
          }));
          if (mapped.length) setExecResults(mapped);
          const LAYERS = ["RAW", "BRONZE", "SILVER", "GOLD"];
          const ls = LAYERS.map(layer => {
            const lr = mapped.filter(x => x.layer === layer);
            const passed = lr.filter(x => x.status === "PASS").length;
            const failed = lr.filter(x => x.status === "FAIL").length;
            const score = lr.length ? Math.round((passed / lr.length) * 100) : 0;
            return { layer, rules: lr.length, passed, failed, score, trend: 0, anomalies: 0 };
          }).filter(l => l.rules > 0);
          if (ls.length) setLayerScores(ls);
          if (r.run_id) setRunMeta({ runId: r.run_id, rulesTotal: r.total_rules || mapped.length, failed: r.failed || r.failed_rules || 0, duration: "2m 14s" });
        })
        .catch(() => {});
    }, [activeConnectionId]);

    // Fetch real results when a run completes
    React.useEffect(() => {
      if (!window.DTApi || !lastRunId) return;
      window.DTApi.getRunResults(lastRunId)
        .then(r => {
          if (!r) return;
          const mapped = (r.results || []).map(x => ({
            id: x.rule_id, rule: x.rule_name, status: x.status,
            failCnt: x.failed_records > 0 ? x.failed_records.toLocaleString() : "0",
            failPct: x.fail_pct || 0, sev: x.severity || "—",
            layer: (x.layer || "SILVER").toUpperCase(),
          }));
          setExecResults(mapped);
          const LAYERS = ["RAW", "BRONZE", "SILVER", "GOLD"];
          const ls = LAYERS.map(layer => {
            const lr = mapped.filter(x => x.layer === layer);
            const passed = lr.filter(x => x.status === "PASS").length;
            const failed = lr.filter(x => x.status === "FAIL").length;
            const score = lr.length ? Math.round((passed / lr.length) * 100) : 0;
            return { layer, rules: lr.length, passed, failed, score, trend: 0, anomalies: 0 };
          }).filter(l => l.rules > 0);
          if (ls.length) setLayerScores(ls);
          setRunMeta({ runId: r.run_id, rulesTotal: r.total_rules || mapped.length, failed: r.failed || 0, duration: "—" });
        })
        .catch(() => {});
    }, [lastRunId]);

    const startRun = () => {
      if (!window.DTApi || !activeConnectionId) { setPhase("running"); return; }
      setPhase("running");
      window.DTApi.runExecution(activeConnectionId)
        .then(r => { if (r?.run_id) setLastRunId(r.run_id); setPhase("results"); })
        .catch(err => { toast("Execution failed: " + (err?.message || "backend error"), { kind: "error" }); setPhase("results"); });
    };

    const runLayer = (layer) => {
      setLayerRun(s => ({ ...s, [layer]: "running" }));
      toast(`Re-running ${layer} layer checks…`, { kind: "info" });
      setTimeout(() => { setLayerRun(s => ({ ...s, [layer]: "done" })); toast(`${layer} layer re-run complete`, { kind: "success" }); }, 1500);
    };
    const runRule = (id) => {
      setRuleRun(s => ({ ...s, [id]: "running" }));
      setTimeout(() => { setRuleRun(s => ({ ...s, [id]: "done" })); toast(`Rule re-run complete`, { kind: "success" }); }, 1100);
    };

    if (phase === "running") return <RunOverlay onDone={() => setPhase("results")} />;

    return (
      <div className="dt-fade-up">
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <Eyebrow>Execution results</Eyebrow>
              <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 17, margin: "5px 0 4px" }}>
                {runMeta?.runId ? `Run #${runMeta.runId} · all layers` : "Run #1108 · all layers"}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}>
                {runMeta
                  ? `${new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${runMeta.rulesTotal || "—"} rules · ${runMeta.duration || "—"} · `
                  : "2024-11-05 08:22 AM · 31 rules · 2m 14s · "}
                <strong style={{ color: "var(--red-500)" }}>{runMeta?.failed ?? 10} failed</strong>
              </div>
            </div>
            <Button variant="outline" icon="refresh-cw" size="sm" onClick={startRun}>Re-run checks</Button>
          </div>
        </Card>

        {/* layer summary */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
          {layerScores.map(l => (
            <Card key={l.layer} pad={16}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <LayerPill layer={l.layer} />
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22, color: scoreColor(l.score) }}>{l.score}</span>
              </div>
              <Bar pct={l.score} color={scoreColor(l.score)} height={5} />
              <div style={{ fontSize: 11.5, color: "var(--fg-2)", marginTop: 8 }}>{l.passed}/{l.rules} passed · <span style={{ color: l.failed ? "var(--red-500)" : "var(--fg-2)", fontWeight: 600 }}>{l.failed} failed</span></div>
              <Button size="sm" variant={layerRun[l.layer] === "done" ? "soft" : "outline"} icon={layerRun[l.layer] === "running" ? "loader" : layerRun[l.layer] === "done" ? "check" : "circle-play"}
                disabled={layerRun[l.layer] === "running"} onClick={() => runLayer(l.layer)} style={{ width: "100%", marginTop: 12 }}>
                {layerRun[l.layer] === "running" ? "Running…" : layerRun[l.layer] === "done" ? "Re-run done" : "Run layer"}</Button>
            </Card>
          ))}
        </div>

        {/* results table */}
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px" }}><SectionTitle icon="list-checks">Rule results</SectionTitle></div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "var(--grey-50)", textAlign: "left" }}>
                {["Rule", "Layer", "Status", "Fail count", "Fail %", "Severity", ""].map((h, i) => <th key={i} style={{ padding: "9px 18px", fontSize: 11, fontWeight: 700, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: ".04em", textAlign: i === 3 || i === 4 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {execResults.map((r) => {
                  const fail = r.status === "FAIL";
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--grey-100)", background: fail && r.sev === "CRITICAL" ? "var(--red-50)" : "transparent" }}>
                      <td style={{ padding: "11px 18px" }}>
                        <Mono style={{ fontWeight: 500 }}>{r.rule}</Mono>
                        {r.note && <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>{r.note}</div>}
                      </td>
                      <td style={{ padding: "11px 18px" }}><LayerPill layer={r.layer} size="sm" /></td>
                      <td style={{ padding: "11px 18px" }}>{fail ? <Chip intent="danger" size="sm" icon="x">FAIL</Chip> : <Chip intent="success" size="sm" icon="check">PASS</Chip>}</td>
                      <td style={{ padding: "11px 18px", textAlign: "right", fontWeight: 600, color: fail ? "var(--red-500)" : "var(--fg-3)" }}>{r.failCnt}</td>
                      <td style={{ padding: "11px 18px", textAlign: "right", color: "var(--fg-2)" }}>{r.failPct ? r.failPct + "%" : "—"}{r.delta && <div style={{ fontSize: 10, color: "var(--red-500)" }}>{r.delta}</div>}</td>
                      <td style={{ padding: "11px 18px" }}>{r.sev !== "—" ? <Severity level={r.sev} size="sm" /> : <span style={{ color: "var(--fg-3)" }}>—</span>}</td>
                      <td style={{ padding: "11px 18px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                          {fail && r.id === 1 && <Button size="sm" variant="soft" icon="search" onClick={() => setShowRecords(true)}>Records</Button>}
                          <IconBtn icon={ruleRun[r.id] === "running" ? "loader" : "play"} size={30} title="Re-run this rule"
                            active={ruleRun[r.id] === "running"} onClick={() => runRule(r.id)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 10, padding: "14px 20px", background: "var(--grey-50)", flexWrap: "wrap" }}>
            <Button size="sm" variant="soft" icon="download">Download CSV</Button>
            <Button size="sm" variant="soft" icon="share-2">Share to Slack</Button>
            <div style={{ flex: 1 }}></div>
            <Button size="sm" variant="primary" iconRight="arrow-right" onClick={() => go("anomalies")}>Review anomalies</Button>
          </div>
        </Card>

        {showRecords && <FailedRecords onClose={() => setShowRecords(false)} />}
      </div>
    );
  };

  window.DTScreens.execution = Execution;
})();
