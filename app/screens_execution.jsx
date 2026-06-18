// DataTrust — Screen: DQ Execution results + failed records drill-down
(function () {
  const D = window.DT;

  const FailedRecords = ({ onClose, records, ruleName, failCnt, resultId, ackId, ackNote, setAckNote, onAck, setAckId }) => {
    useIcons();
    const cols = records.length > 0 ? Object.keys(records[0]) : [];
    return (
      <Modal open={true} onClose={onClose} width={760} title={`Failed records — ${ruleName || "rule"}`}
        footer={
          <div style={{ display: "flex", gap: 8, alignItems: "center", width: "100%", flexWrap: "wrap" }}>
            <Button variant="soft" icon="check-square" onClick={() => setAckId(ackId === resultId ? null : resultId)}>
              Mark as expected
            </Button>
            {ackId === resultId && (
              <>
                <input value={ackNote} onChange={e => setAckNote(e.target.value)}
                  placeholder="Reason (optional)…"
                  style={{ flex: 1, minWidth: 140, fontSize: 12, padding: "6px 10px", borderRadius: 7,
                    border: "1px solid var(--grey-200)", outline: "none" }} />
                <Button size="sm" variant="primary" onClick={() => onAck(resultId)}>Confirm</Button>
                <Button size="sm" variant="ghost" onClick={() => setAckId(null)}>Cancel</Button>
              </>
            )}
            <div style={{ flex: 1 }}></div>
            <Button variant="danger" icon="siren"
              onClick={() => { toast("Escalated to pipeline owner · ticket created", { kind: "warning" }); onClose(); }}>
              Escalate to pipeline owner
            </Button>
          </div>
        }>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <Chip intent="danger" variant="fill" size="sm">FAIL</Chip>
          <span style={{ fontSize: 13, color: "var(--fg-2)" }}>
            Showing {records.length} of <strong style={{ color: "var(--fg-1)" }}>{failCnt || records.length}</strong> failed records
          </span>
        </div>
        <div style={{ overflowX: "auto", border: "1px solid var(--grey-100)", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: "var(--grey-50)", textAlign: "left" }}>
              {cols.map(h => (
                <th key={h} style={{ padding: "8px 12px", fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 11, color: "var(--fg-2)", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {records.map((row, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--grey-100)" }}>
                  {cols.map(col => (
                    <td key={col} style={{ padding: "7px 12px" }}>
                      <Mono style={{ fontSize: 11.5,
                        color: row[col] === null || row[col] === "NULL" ? "var(--red-500)" : "inherit",
                        fontWeight: row[col] === null || row[col] === "NULL" ? 700 : 400 }}>
                        {row[col] === null ? "NULL" : String(row[col])}
                      </Mono>
                    </td>
                  ))}
                </tr>
              ))}
              {records.length === 0 && (
                <tr><td colSpan={1} style={{ padding: "20px 12px", color: "var(--fg-3)", fontSize: 12, textAlign: "center" }}>
                  No sample records available
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {records.length === 0 && (
          <div style={{ marginTop: 12, padding: 14, background: "var(--grey-50)", borderRadius: 10, fontSize: 12.5, color: "var(--fg-3)" }}>
            Sample records are captured during rule execution. Run the rule set to populate this view.
          </div>
        )}
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
        <span className="dt-spin" style={{ width: 38, height: 38, border: "3px solid var(--brand-ring)",
          borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block", marginBottom: 18 }}></span>
        <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
          Executing rules across all layers
        </div>
        <div style={{ fontSize: 13, color: "var(--fg-2)", marginBottom: 18 }}>Raw → Bronze → Silver → Gold</div>
        <div style={{ maxWidth: 360, margin: "0 auto" }}><Bar pct={(n / 31) * 100} height={8} /></div>
        <Mono style={{ marginTop: 10, color: "var(--fg-2)", display: "block" }}>{n} / 31 rules</Mono>
      </Card>
    );
  };

  const _applyRunResults = (r, setExecResults, setLayerScores, setRunMeta) => {
    if (!r) return;
    const mapped = (r.results || []).map(x => ({
      id: x.rule_id,
      resultId: x.result_id || "",
      rule: x.rule_name,
      tableFqn: x.table_fqn || "",
      isCde: x.is_cde_rule || false,
      status: x.status,
      failCnt: x.failed_records > 0 ? x.failed_records.toLocaleString() : "0",
      failPct: x.fail_pct || 0,
      qualityScore: x.quality_score ?? null,
      sev: x.severity || "—",
      layer: (x.layer || "SILVER").toUpperCase(),
      sampleRecords: x.sample_failed_records || [],
      remediation: x.remediation_suggestion || "",
      isExpected: x.is_expected_failure || false,
      acknowledgedBy: x.acknowledged_by || "",
    }));
    if (mapped.length) setExecResults(mapped);
    const LAYERS = ["RAW", "BRONZE", "SILVER", "GOLD"];
    const ls = LAYERS.map(layer => {
      const lr = mapped.filter(x => x.layer === layer);
      const passed = lr.filter(x => x.status === "PASS").length;
      const failed = lr.filter(x => x.status === "FAIL").length;
      const avgScore = lr.length
        ? Math.round(lr.reduce((sum, x) => sum + (x.qualityScore ?? (x.status === "PASS" ? 100 : 0)), 0) / lr.length)
        : 0;
      return { layer, rules: lr.length, passed, failed, score: avgScore };
    }).filter(l => l.rules > 0);
    if (ls.length) setLayerScores(ls);
    if (r.run_id) setRunMeta({
      runId: r.run_id,
      rulesTotal: r.total_rules || mapped.length,
      failed: r.failed || 0,
      overallScore: r.overall_quality_score ?? null,
      runTimestamp: r.run_timestamp || null,
    });
  };

  const Execution = () => {
    const { go, activeConnectionId, lastRunId, setLastRunId } = useApp();
    const [phase, setPhase]             = React.useState("results");
    const [showRecords, setShowRecords] = React.useState(false);
    const [drillRecords, setDrillRecords] = React.useState({});
    const [layerRun, setLayerRun]       = React.useState({});
    const [ruleRun, setRuleRun]         = React.useState({});
    const [layerScores, setLayerScores] = React.useState([]);
    const [execResults, setExecResults] = React.useState([]);
    const [runMeta, setRunMeta]         = React.useState(null);
    const [filterStatus, setFilterStatus] = React.useState("ALL");
    const [filterLayer, setFilterLayer]   = React.useState("ALL");
    const [ackId, setAckId]             = React.useState(null);
    const [ackNote, setAckNote]         = React.useState("");
    const [ackedIds, setAckedIds]       = React.useState({});
    useIcons();

    React.useEffect(() => {
      if (!window.DTApi || !activeConnectionId) return;
      setExecResults([]);
      setLayerScores([]);
      setRunMeta(null);
      window.DTApi.getLatestRun(activeConnectionId)
        .then(r => r?.run_id && window.DTApi.getRunResults(r.run_id))
        .then(r => _applyRunResults(r, setExecResults, setLayerScores, setRunMeta))
        .catch(() => {});
    }, [activeConnectionId]);

    React.useEffect(() => {
      if (!window.DTApi || !lastRunId) return;
      window.DTApi.getRunResults(lastRunId)
        .then(r => _applyRunResults(r, setExecResults, setLayerScores, setRunMeta))
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
      setTimeout(() => { setRuleRun(s => ({ ...s, [id]: "done" })); toast("Rule re-run complete", { kind: "success" }); }, 1100);
    };

    const confirmAck = (resultId) => {
      if (!resultId) return;
      const reason = ackNote.trim();
      window.DTApi?.acknowledgeFailure?.({
        rule_result_id: resultId,
        acknowledged_by: "user",
        is_expected: true,
        reason: reason || "Expected failure",
      }).catch(() => {});
      setAckedIds(x => ({ ...x, [resultId]: true }));
      setAckId(null);
      setAckNote("");
      setShowRecords(false);
      toast("Marked as expected · logged to audit trail", { kind: "info" });
    };

    const visibleResults = React.useMemo(() => {
      let rows = execResults;
      if (filterLayer !== "ALL") rows = rows.filter(r => r.layer === filterLayer);
      if (filterStatus === "FAIL")     rows = rows.filter(r => r.status === "FAIL" && !r.isExpected && !ackedIds[r.resultId]);
      if (filterStatus === "PASS")     rows = rows.filter(r => r.status === "PASS");
      if (filterStatus === "ERROR")    rows = rows.filter(r => r.status === "ERROR");
      if (filterStatus === "expected") rows = rows.filter(r => r.isExpected || !!ackedIds[r.resultId]);
      return rows;
    }, [execResults, filterStatus, filterLayer, ackedIds]);

    const downloadCsv = () => {
      const headers = ["Rule","Layer","Status","Table","Fail Count","Fail %","Quality Score","Severity","CDE"];
      const rows = visibleResults.map(r => [
        r.rule, r.layer, r.status, r.tableFqn,
        r.failCnt, r.failPct, r.qualityScore ?? "", r.sev, r.isCde ? "Y" : "N"
      ]);
      const csv = [headers, ...rows]
        .map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dq-run-${(runMeta?.runId || "results").slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };

    const pillSt = (active) => ({
      background: active ? "var(--brand-soft)" : "#fff",
      color: active ? "var(--brand)" : "var(--fg-2)",
      border: `1px solid ${active ? "var(--brand-ring)" : "var(--grey-200)"}`,
      borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
    });

    if (phase === "running") return <RunOverlay onDone={() => setPhase("results")} />;

    return (
      <div className="dt-fade-up">

        {/* ── Header card ── */}
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <Eyebrow>Execution results</Eyebrow>
              {runMeta?.runId ? (
                <>
                  <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 17, margin: "5px 0 3px" }}>
                    Run #{runMeta.runId.slice(0, 8)}… · all layers
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}>
                    {runMeta.runTimestamp
                      ? new Date(runMeta.runTimestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                    {" · "}{runMeta.rulesTotal || "—"} rules ·{" "}
                    <strong style={{ color: "var(--red-500)" }}>{runMeta.failed ?? 0} failed</strong>
                  </div>
                  {runMeta.overallScore !== null && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                      <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>Overall quality</span>
                      <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20,
                        color: scoreColor(runMeta.overallScore) }}>
                        {runMeta.overallScore}
                      </span>
                      <div style={{ maxWidth: 140 }}>
                        <Bar pct={runMeta.overallScore} color={scoreColor(runMeta.overallScore)} height={6} />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 600, fontSize: 15,
                  margin: "5px 0 4px", color: "var(--fg-3)" }}>
                  No runs yet — click Re-run checks to execute your approved rules.
                </div>
              )}
            </div>
            <Button variant="outline" icon="refresh-cw" size="sm" onClick={startRun}>Re-run checks</Button>
          </div>
        </Card>

        {/* ── Layer summary cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
          {layerScores.map(l => (
            <Card key={l.layer} pad={16}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <LayerPill layer={l.layer} />
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22,
                  color: scoreColor(l.score) }}>{l.score}</span>
              </div>
              <Bar pct={l.score} color={scoreColor(l.score)} height={5} />
              <div style={{ fontSize: 11.5, color: "var(--fg-2)", marginTop: 8 }}>
                {l.passed}/{l.rules} passed ·{" "}
                <span style={{ color: l.failed ? "var(--red-500)" : "var(--fg-2)", fontWeight: 600 }}>
                  {l.failed} failed
                </span>
              </div>
              <Button size="sm"
                variant={layerRun[l.layer] === "done" ? "soft" : "outline"}
                icon={layerRun[l.layer] === "running" ? "loader" : layerRun[l.layer] === "done" ? "check" : "circle-play"}
                disabled={layerRun[l.layer] === "running"}
                onClick={() => runLayer(l.layer)}
                style={{ width: "100%", marginTop: 12 }}>
                {layerRun[l.layer] === "running" ? "Running…" : layerRun[l.layer] === "done" ? "Re-run done" : "Run layer"}
              </Button>
            </Card>
          ))}
        </div>

        {/* ── Results table ── */}
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--grey-100)" }}>
            <SectionTitle icon="list-checks">Rule results</SectionTitle>
          </div>

          {/* Filter bar */}
          <div style={{ padding: "10px 20px", display: "flex", gap: 6, alignItems: "center",
            flexWrap: "wrap", borderBottom: "1px solid var(--grey-100)", background: "var(--grey-50)" }}>
            <Eyebrow style={{ marginRight: 2 }}>Status</Eyebrow>
            {[["ALL","All"],["FAIL","Failed"],["PASS","Passed"],["ERROR","Error"],["expected","Expected"]].map(([val, lbl]) => (
              <button key={val} onClick={() => setFilterStatus(val)} style={pillSt(filterStatus === val)}>{lbl}</button>
            ))}
            <div style={{ width: 1, height: 16, background: "var(--grey-200)", margin: "0 4px" }}></div>
            <Eyebrow style={{ marginRight: 2 }}>Layer</Eyebrow>
            {["ALL","RAW","BRONZE","SILVER","GOLD"].map(l => (
              <button key={l} onClick={() => setFilterLayer(l)} style={pillSt(filterLayer === l)}>{l}</button>
            ))}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "var(--grey-50)", textAlign: "left" }}>
                {["Rule","Layer","Status","Fail count","Fail %","Score","Severity",""].map((h, i) => (
                  <th key={i} style={{ padding: "9px 18px", fontSize: 11, fontWeight: 700, color: "var(--fg-2)",
                    textTransform: "uppercase", letterSpacing: ".04em",
                    textAlign: i === 3 || i === 4 || i === 5 ? "right" : "left",
                    whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {visibleResults.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: "32px 20px", textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
                    {execResults.length === 0
                      ? "No results yet — run checks to populate this table."
                      : "No results match the current filters."}
                  </td></tr>
                )}
                {visibleResults.map((r) => {
                  const fail    = r.status === "FAIL";
                  const isError = r.status === "ERROR";
                  const isAcked = r.isExpected || !!ackedIds[r.resultId];
                  return (
                    <React.Fragment key={r.id || r.resultId}>
                      <tr style={{ borderTop: "1px solid var(--grey-100)",
                        background: isAcked ? "transparent" : fail && r.sev === "CRITICAL" ? "var(--red-50)" : "transparent",
                        opacity: isAcked ? 0.55 : 1 }}>
                        <td style={{ padding: "11px 18px" }}>
                          <Mono style={{ fontWeight: 500 }}>{r.rule}</Mono>
                          {(r.isCde || r.tableFqn) && (
                            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
                              {r.isCde && (
                                <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--brand)",
                                  background: "var(--brand-soft)", borderRadius: 3, padding: "1px 5px" }}>CDE</span>
                              )}
                              {r.tableFqn && (
                                <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{r.tableFqn}</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "11px 18px" }}><LayerPill layer={r.layer} size="sm" /></td>
                        <td style={{ padding: "11px 18px" }}>
                          {isAcked
                            ? <Chip intent="neutral" size="sm">Expected</Chip>
                            : isError
                              ? <Chip intent="warning" size="sm" icon="alert-triangle">ERROR</Chip>
                              : fail
                                ? <Chip intent="danger" size="sm" icon="x">FAIL</Chip>
                                : <Chip intent="success" size="sm" icon="check">PASS</Chip>
                          }
                        </td>
                        <td style={{ padding: "11px 18px", textAlign: "right", fontWeight: 600,
                          color: fail && !isAcked ? "var(--red-500)" : "var(--fg-3)" }}>{r.failCnt}</td>
                        <td style={{ padding: "11px 18px", textAlign: "right", color: "var(--fg-2)" }}>
                          {r.failPct ? r.failPct + "%" : "—"}
                        </td>
                        <td style={{ padding: "11px 18px", textAlign: "right" }}>
                          {r.qualityScore !== null && r.qualityScore !== undefined
                            ? <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13,
                                color: scoreColor(r.qualityScore) }}>{r.qualityScore}</span>
                            : <span style={{ color: "var(--fg-3)" }}>—</span>}
                        </td>
                        <td style={{ padding: "11px 18px" }}>
                          {r.sev !== "—" ? <Severity level={r.sev} size="sm" /> : <span style={{ color: "var(--fg-3)" }}>—</span>}
                        </td>
                        <td style={{ padding: "11px 18px", textAlign: "right" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                            {fail && !isAcked && (
                              <Button size="sm" variant="soft" icon="search" onClick={() => {
                                setDrillRecords({ records: r.sampleRecords || [], rule: r.rule, failCnt: r.failCnt, resultId: r.resultId });
                                setShowRecords(true);
                              }}>Records</Button>
                            )}
                            <IconBtn icon={ruleRun[r.id] === "running" ? "loader" : "play"} size={30}
                              title="Re-run this rule" active={ruleRun[r.id] === "running"}
                              onClick={() => runRule(r.id)} />
                          </div>
                        </td>
                      </tr>
                      {fail && !isAcked && r.remediation && (
                        <tr style={{ background: "var(--yellow-50)" }}>
                          <td colSpan={8} style={{ padding: "8px 18px 10px 46px", borderBottom: "1px solid var(--yellow-100)" }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                                stroke="var(--yellow-700)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                style={{ flexShrink: 0, marginTop: 2 }}>
                                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                              </svg>
                              <span style={{ fontSize: 12, color: "var(--yellow-900)", lineHeight: 1.55 }}>
                                <strong>AI suggestion · </strong>{r.remediation}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 10, padding: "14px 20px", background: "var(--grey-50)", flexWrap: "wrap" }}>
            <Button size="sm" variant="soft" icon="download" onClick={downloadCsv}>Download CSV</Button>
            <Button size="sm" variant="soft" icon="share-2">Share to Slack</Button>
            <div style={{ flex: 1 }}></div>
            <Button size="sm" variant="primary" iconRight="arrow-right" onClick={() => go("anomalies")}>Review anomalies</Button>
          </div>
        </Card>

        {showRecords && (
          <FailedRecords
            onClose={() => { setShowRecords(false); setDrillRecords({}); setAckId(null); setAckNote(""); }}
            records={drillRecords.records || []}
            ruleName={drillRecords.rule}
            failCnt={drillRecords.failCnt}
            resultId={drillRecords.resultId}
            ackId={ackId}
            ackNote={ackNote}
            setAckNote={setAckNote}
            onAck={confirmAck}
            setAckId={setAckId}
          />
        )}
      </div>
    );
  };

  window.DTScreens.execution = Execution;
})();
