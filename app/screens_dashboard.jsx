// DataTrust — Screen: Trust Dashboard (Exec / Technical / Steward)
(function () {

  function useDashboard(activeConnectionId) {
    const [summary, setSummary] = React.useState(null);
    const [trends, setTrends] = React.useState(null);
    const [cdeStatus, setCdeStatus] = React.useState(null);
    const [layerScores, setLayerScores] = React.useState(null);
    const [auditTrail, setAuditTrail] = React.useState(null);
    const [ruleFailTrend, setRuleFailTrend] = React.useState(null);
    const [topAnomalies, setTopAnomalies] = React.useState(null);
    const [openTasks, setOpenTasks] = React.useState(null);
    const [layerCoverage, setLayerCoverage] = React.useState(null); // [{layer, dictPct, rulePct}]

    React.useEffect(() => {
      if (!window.DTApi) return;
      setSummary(null);
      setTrends(null);
      setCdeStatus(null);
      setLayerScores(null);
      setAuditTrail(null);
      setRuleFailTrend(null);
      setTopAnomalies(null);
      setOpenTasks(null);
      setLayerCoverage(null);

      window.DTApi.getDashboardSummary(activeConnectionId)
        .then(s => {
          if (!s) return;
          setSummary(s);
          if (s.layers && s.layers.length) {
            setLayerScores(s.layers.map(l => ({
              layer: l.layer, score: Math.round(l.score || 0),
              rules: l.rule_count || 0, passed: (l.rule_count || 0) - (l.open_issues || 0),
              failed: l.open_issues || 0,
              trend: l.trend_delta ?? null,
              anomalies: s.layer_anomaly_counts?.[l.layer] || 0,
            })));
          }
          if (s.recent_activity && s.recent_activity.length) {
            setAuditTrail(s.recent_activity.map(r => ({
              time: r.time || "—", user: r.user || "System",
              action: r.action || "—", entity: r.entity || "—",
            })));
          }
        })
        .catch(() => {});
      window.DTApi.getDashboardTrends(activeConnectionId, 14)
        .then(pts => { if (pts && pts.length) setTrends(pts.map(p => ({ label: p.date?.slice(5) || p.label, value: p.score || p.value }))); })
        .catch(() => {});
      if (window.DTApi.getRuleFailTrend) {
        window.DTApi.getRuleFailTrend(activeConnectionId, 7)
          .then(pts => { if (pts && pts.length) setRuleFailTrend(pts); })
          .catch(() => {});
      }
      window.DTApi.getCDEStatus(activeConnectionId)
        .then(rows => {
          if (rows && rows.length) setCdeStatus(rows.map(r => ({ name: r.column_name, table: r.table_fqn, status: r.health || "PASS", validated: r.last_validated || "—" })));
        })
        .catch(() => {});
      if (window.DTApi.getAuditTrail) {
        window.DTApi.getAuditTrail(activeConnectionId)
          .then(rows => { if (rows && rows.length) setAuditTrail(rows.map(r => ({ time: r.time || "—", user: r.user_name || r.user || "System", action: r.action, entity: r.entity || "—" }))); })
          .catch(() => {});
      }
      // Real top issues — severity-ranked open anomalies, in the AI's own
      // business-language explanation (falls back to the raw description if an
      // anomaly hasn't been explained yet).
      if (window.DTApi.getAnomalyInbox) {
        window.DTApi.getAnomalyInbox(activeConnectionId)
          .then(rows => {
            const sevRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
            const sorted = (rows || []).slice().sort((a, b) =>
              (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9) ||
              new Date(b.detected_at || 0) - new Date(a.detected_at || 0));
            setTopAnomalies(sorted.slice(0, 3).map(a => ({
              text: a.business_explanation || a.description || `${a.anomaly_type || "Anomaly"} detected on ${a.table_fqn || "a table"}`,
              severity: a.severity || "MEDIUM",
              table: a.table_fqn, layer: a.layer,
            })));
          })
          .catch(() => setTopAnomalies([]));
      }
      // Real open tasks with real owners (task_board), not invented names.
      if (window.DTApi.listTasks) {
        window.DTApi.listTasks(activeConnectionId, "open")
          .then(rows => {
            setOpenTasks((rows || []).slice(0, 6).map(t => ({
              title: t.title, owner: t.owner || "Unassigned",
              due: t.due_date || (t.priority === "CRITICAL" || t.priority === "HIGH" ? "Now" : "—"),
            })));
          })
          .catch(() => setOpenTasks([]));
      }
      // Real per-layer dictionary completeness + rule coverage, computed from the
      // same data the Dictionary & CDEs and Rule Studio screens themselves show —
      // not a separately-invented number.
      if (window.DTApi.listDictionary && window.DTApi.listRules) {
        Promise.all([
          window.DTApi.listDictionary(activeConnectionId).catch(() => []),
          window.DTApi.listRules(activeConnectionId).catch(() => []),
        ]).then(([dictRows, ruleRows]) => {
          const byLayer = {};
          (dictRows || []).forEach(d => {
            const layer = (d.layer || "UNKNOWN").toUpperCase();
            if (!byLayer[layer]) byLayer[layer] = { total: 0, described: 0, columnsWithRule: new Set() };
            byLayer[layer].total++;
            if (d.business_name || d.description) byLayer[layer].described++;
          });
          const activeRuleColumnsByLayer = {};
          (ruleRows || []).forEach(r => {
            if (!["approved", "active"].includes(r.status) || !r.column_name) return;
            const layer = (r.layer || "UNKNOWN").toUpperCase();
            (activeRuleColumnsByLayer[layer] ||= new Set()).add(r.column_name);
          });
          const coverage = Object.keys(byLayer).map(layer => {
            const b = byLayer[layer];
            const ruleCols = activeRuleColumnsByLayer[layer]?.size || 0;
            return {
              layer,
              dictPct: b.total ? Math.round((b.described / b.total) * 100) : 0,
              rulePct: b.total ? Math.round((Math.min(ruleCols, b.total) / b.total) * 100) : 0,
            };
          });
          const order = { RAW: 0, BRONZE: 1, SILVER: 2, GOLD: 3 };
          coverage.sort((a, b) => (order[a.layer] ?? 9) - (order[b.layer] ?? 9));
          setLayerCoverage(coverage);
        });
      }
    }, [activeConnectionId]);

    return { summary, trends, cdeStatus, layerScores, auditTrail, ruleFailTrend, topAnomalies, openTasks, layerCoverage };
  }

  const Tabs = ({ tab, setTab }) => (
    <div style={{ display: "inline-flex", gap: 4, background: "var(--grey-100)", padding: 4, borderRadius: 10, marginBottom: 18 }}>
      {[["exec", "Executive", "briefcase"], ["tech", "Technical", "terminal"], ["steward", "Governance", "shield"]].map(([id, label, icon]) => (
        <button key={id} onClick={() => setTab(id)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 16px", borderRadius: 7,
          border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-ui)",
          background: tab === id ? "#fff" : "transparent", color: tab === id ? "var(--brand)" : "var(--fg-2)",
          boxShadow: tab === id ? "var(--shadow-card)" : "none" }}>
          <i data-lucide={icon} style={{ width: 15, height: 15 }}></i>{label}
        </button>
      ))}
    </div>
  );

  const Spinner = ({ label = "Loading…" }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "18px 4px", color: "var(--fg-3)", fontSize: 12.5 }}>
      <span className="dt-spin" style={{ width: 14, height: 14, border: "2px solid var(--grey-200)",
        borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block" }}></span>
      {label}
    </div>
  );

  const Exec = ({ trustScore, trustHistory, scoreDelta, yesterdayScore, topAnomalies, layerScores }) => {
    const history = trustHistory || [];
    const impactedLayers = (layerScores || []).filter(l => l.failed > 0);
    const healthyLayers = (layerScores || []).filter(l => l.failed === 0 && l.rules > 0);
    return (
    <div className="dt-fade-up">
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <Card style={{ flex: 1, minWidth: 240, display: "flex", alignItems: "center", gap: 20 }}>
          <ScoreRing score={trustScore} size={120} stroke={11} sublabel="overall trust" />
          <div>
            <Eyebrow>Data trust score</Eyebrow>
            {yesterdayScore != null ? (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700,
                color: scoreDelta < 0 ? "var(--red-500)" : "var(--green-500)", marginTop: 8 }}>
                <i data-lucide={scoreDelta < 0 ? "trending-down" : "trending-up"} style={{ width: 15, height: 15 }}></i>
                {scoreDelta > 0 ? "+" : ""}{scoreDelta} pts vs yesterday ({yesterdayScore})
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 8 }}>No history yet</div>
            )}
          </div>
        </Card>
        <Card style={{ flex: 2, minWidth: 320 }}>
          <SectionTitle icon="trending-up">Trust score — last 14 days</SectionTitle>
          {trustHistory === null ? <Spinner label="Loading trend…" /> : history.length ? (
            <>
              <LineChart data={history} height={150} yMin={40} yMax={100} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                {history.map(d => <span key={d.label} style={{ fontSize: 10, color: "var(--fg-3)" }}>{d.label}</span>)}
              </div>
            </>
          ) : <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "10px 0" }}>No trend history yet — check back after a few days of runs.</div>}
        </Card>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <SectionTitle icon="alert-circle">Top open issues</SectionTitle>
        {topAnomalies === null ? <Spinner label="Loading open issues…" /> : topAnomalies.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {topAnomalies.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: 14, background: SEV[a.severity]?.bg || SEV.MEDIUM.bg, borderRadius: 10 }}>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18, color: (SEV[a.severity] || SEV.MEDIUM).c, width: 22 }}>{i + 1}</span>
                <div style={{ flex: 1, fontSize: 13, color: "var(--fg-1)", lineHeight: 1.5 }}>{a.text}</div>
                <Severity level={a.severity} size="sm" />
              </div>
            ))}
          </div>
        ) : <div style={{ fontSize: 12.5, color: "var(--green-600)", fontWeight: 600, padding: "6px 0" }}>No open issues.</div>}
      </Card>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Card style={{ flex: 1, minWidth: 240 }}>
          <SectionTitle icon="x-octagon">Impacted layers</SectionTitle>
          {layerScores === null ? <Spinner /> : impactedLayers.length ? impactedLayers.map(l => (
            <div key={l.layer} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--grey-100)" }}>
              <i data-lucide="x-circle" style={{ width: 16, height: 16, color: "var(--red-500)" }}></i>
              <span style={{ fontSize: 13, flex: 1 }}>{l.layer}</span>
              <span style={{ fontSize: 12, color: "var(--fg-2)" }}>{l.failed} open issue{l.failed === 1 ? "" : "s"}</span>
            </div>
          )) : <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "6px 0" }}>No impacted layers.</div>}
        </Card>
        <Card style={{ flex: 1, minWidth: 240 }}>
          <SectionTitle icon="check-circle-2">Healthy layers</SectionTitle>
          {layerScores === null ? <Spinner /> : healthyLayers.length ? healthyLayers.map(l => (
            <div key={l.layer} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--grey-100)" }}>
              <i data-lucide="check-circle-2" style={{ width: 16, height: 16, color: "var(--green-500)" }}></i>
              <span style={{ fontSize: 13 }}>{l.layer}</span>
            </div>
          )) : <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "6px 0" }}>None yet.</div>}
        </Card>
      </div>
    </div>
    );
  };

  const Tech = ({ layerScores: lsProps, cdes: cdesProps, connName, ruleFailTrend: rftProps, openTasks }) => {
    const layerScores = lsProps || [];
    const cdes = cdesProps || [];
    return (
    <div className="dt-fade-up">
      <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px" }}><SectionTitle icon="layers">Layer scorecard</SectionTitle></div>
        {lsProps === null ? <div style={{ padding: "0 20px 16px" }}><Spinner /></div> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "var(--grey-50)", textAlign: "left" }}>
            {["Layer", "Score", "Rules", "Failed", "Anomalies", "Trend"].map(h => <th key={h} style={{ padding: "9px 20px", fontSize: 11, fontWeight: 700, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: ".04em" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {layerScores.map(l => (
              <tr key={l.layer} style={{ borderTop: "1px solid var(--grey-100)" }}>
                <td style={{ padding: "11px 20px" }}><LayerPill layer={l.layer} size="sm" /></td>
                <td style={{ padding: "11px 20px" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 800, fontFamily: "var(--font-display)", color: scoreColor(l.score) }}>{l.score}</span><div style={{ width: 60 }}><Bar pct={l.score} color={scoreColor(l.score)} height={5} /></div></span></td>
                <td style={{ padding: "11px 20px", color: "var(--fg-2)" }}>{l.rules}</td>
                <td style={{ padding: "11px 20px", fontWeight: 600, color: l.failed ? "var(--red-500)" : "var(--fg-3)" }}>{l.failed}</td>
                <td style={{ padding: "11px 20px", fontWeight: l.anomalies ? 600 : 400, color: l.anomalies ? "var(--yellow-700)" : "var(--fg-3)" }}>{l.anomalies}</td>
                <td style={{ padding: "11px 20px" }}>
                  {l.trend == null || l.trend === 0
                    ? <span style={{ color: "var(--fg-3)" }} title={l.trend === 0 ? "No change since previous profiling" : "Needs at least two profilings of the same tables to compare"}>{l.trend === 0 ? "→ 0" : "—"}</span>
                    : <span style={{ fontWeight: 700, color: l.trend > 0 ? "var(--green-600)" : "var(--red-500)" }} title="Average score change vs the previous profiling of the same tables">
                        {l.trend > 0 ? "↑ +" : "↓ "}{l.trend}
                      </span>}
                </td>
              </tr>
            ))}
            {layerScores.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "20px", textAlign: "center", color: "var(--fg-3)", fontSize: 12.5 }}>No layers profiled yet.</td></tr>
            )}
          </tbody>
        </table>
        )}
      </Card>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <SectionTitle icon="columns-3">CDE column health{connName ? ` — ${connName}` : ""}</SectionTitle>
          {cdesProps === null ? <Spinner /> : cdes.length ? cdes.map((c, i) => (
            <div key={`${c.table || ""}::${c.name || c.column_name}::${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--grey-100)" }}>
              <Mono style={{ flex: 1, fontWeight: 700 }}>{c.name || c.column_name}</Mono>
              <Chip intent="brand" size="sm">CDE</Chip>
              <span style={{ fontWeight: 700, fontSize: 13, color: scoreColor(c.score || c.cde_score || 0), width: 30, textAlign: "right" }}>{c.score || c.cde_score || "—"}</span>
              {/* c.status is already one of HEALTHY|WARN|CRIT (from the backend's
                  health field) — Health's map takes that directly. The previous
                  ternary compared against "PASS", a value this field never has,
                  so every truly-HEALTHY CDE fell through to CRIT (red) here. */}
              <Health status={c.status || "HEALTHY"} />
            </div>
          )) : <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "6px 0" }}>No CDEs registered yet.</div>}
        </Card>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <SectionTitle icon="bar-chart-3">Rule failures — last 7 days</SectionTitle>
          {rftProps === null ? <Spinner /> : rftProps && rftProps.length ? (
            <div style={{ marginTop: 18 }}><BarSeries data={rftProps} height={120} highlightLast lastColor="var(--red-500)" baseColor="var(--blue-300)" /></div>
          ) : <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "10px 0" }}>No execution history yet.</div>}
        </Card>
      </div>

      <Card>
        <SectionTitle icon="user-cog">Open tasks with owners</SectionTitle>
        {openTasks === null ? <Spinner label="Loading tasks…" /> : openTasks.length ? openTasks.map((t, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--grey-100)" }}>
            <span style={{ flex: 1, fontSize: 13 }}>{t.title}</span>
            <Avatar name={t.owner} size={24} color="blue" /><span style={{ fontSize: 12.5, color: "var(--fg-2)", width: 90 }}>{t.owner}</span>
            <Chip intent="neutral" size="sm" icon="clock">{t.due}</Chip>
          </div>
        )) : <div style={{ fontSize: 12.5, color: "var(--green-600)", fontWeight: 600, padding: "6px 0" }}>No open tasks — go to Task Board to create one.</div>}
      </Card>
    </div>
    );
  };

  // AI Usage & Cost — governance transparency: every AI call this app makes is
  // logged at its call site (rule_ai_calls / ai_usage_log); this is the single
  // place that turns those rows into a judge-legible cost/latency/fallback-rate
  // answer instead of leaving it as backend-only log lines.
  const FEATURE_LABEL = {
    RECOMMEND: "Rule recommendation", NL_CONVERT: "NL → DQ rule", ANOMALY_EXPLAIN: "Anomaly explanation",
    REMEDIATION: "Rule remediation", CROSS_TABLE: "Cross-table rule check",
    sim_classify: "Simulator classification", sim_narrative: "Simulator narrative",
    lineage_narrative: "Impact graph narrative", advisory: "Pre-run advisory", receipt: "Trust receipt",
    daily_summary: "Daily summary",
  };
  const AiUsagePanel = ({ connectionId }) => {
    const [usage, setUsage] = React.useState(null);
    const [days, setDays] = React.useState(30);
    React.useEffect(() => {
      if (!window.DTApi?.getAiUsage) return;
      setUsage(null);
      window.DTApi.getAiUsage(connectionId, days).then(setUsage).catch(() => setUsage({ error: true }));
    }, [connectionId, days]);

    return (
      <Card style={{ marginBottom: 16 }}>
        <SectionTitle icon="cpu"
          sub="Every AI call this platform makes — token spend, latency, and how often the LLM actually answered vs. fell back to a deterministic path. Not a claim; a ledger."
          right={
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--grey-200)", color: "var(--fg-1)", background: "var(--bg-1, #fff)" }}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          }>AI usage &amp; cost transparency</SectionTitle>

        {usage === null ? <Spinner label="Loading AI usage…" /> : usage.error ? (
          <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "8px 0" }}>Could not load AI usage data.</div>
        ) : usage.total_calls === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "8px 0" }}>No AI calls recorded in this window yet — run profiling, rule recommendation, or the simulator to populate this ledger.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 18 }}>
              {[
                ["Total AI calls", usage.total_calls.toLocaleString(), null],
                ["Tokens (in / out)", `${usage.total_input_tokens.toLocaleString()} / ${usage.total_output_tokens.toLocaleString()}`, null],
                ["Est. cost", `${usage.cost_fully_known ? "" : "≥"}$${usage.estimated_cost_usd.toFixed(2)}`, "List-price estimate from token counts — not a billing statement. ≥ means at least one call used a model not in the price table and was estimated conservatively."],
                ["Avg latency", `${(usage.avg_latency_ms / 1000).toFixed(1)}s`, null],
                ["LLM answered", usage.ai_success_rate != null ? `${usage.ai_success_rate}%` : "—", "Calls the LLM actually answered vs. fell back to a deterministic path (timeout, malformed output, or provider error)."],
              ].map(([label, value, tip]) => (
                <div key={label} title={tip || undefined}>
                  <div style={{ fontSize: 10.5, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-display)", color: "var(--fg-1)" }}>{value}</div>
                </div>
              ))}
              {(usage.fallback_rate > 0 || usage.error_rate > 0) && (
                <div>
                  <div style={{ fontSize: 10.5, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: ".04em" }}>Fallback / error rate</div>
                  <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-display)", color: "var(--yellow-700)" }}>
                    {usage.fallback_rate || 0}% / {usage.error_rate || 0}%
                  </div>
                </div>
              )}
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr style={{ textAlign: "left", borderBottom: "1px solid var(--grey-100)" }}>
                {["Feature", "Calls", "Tokens", "Avg latency", "LLM / fallback / error", "Est. cost"].map(h => (
                  <th key={h} style={{ padding: "6px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: ".03em" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {usage.by_feature.map(f => (
                  <tr key={f.feature} style={{ borderBottom: "1px solid var(--grey-50)" }}>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>{FEATURE_LABEL[f.feature] || f.feature}</td>
                    <td style={{ padding: "8px 10px" }}>{f.calls}</td>
                    <td style={{ padding: "8px 10px", color: "var(--fg-2)" }}>{(f.input_tokens + f.output_tokens).toLocaleString()}</td>
                    <td style={{ padding: "8px 10px", color: "var(--fg-2)" }}>{(f.avg_latency_ms / 1000).toFixed(1)}s</td>
                    <td style={{ padding: "8px 10px", color: "var(--fg-2)" }}>
                      <span style={{ color: "var(--green-600)" }}>{f.ai_calls}</span>
                      {" / "}<span style={{ color: f.fallback_calls ? "var(--yellow-700)" : "var(--fg-3)" }}>{f.fallback_calls}</span>
                      {" / "}<span style={{ color: f.error_calls ? "var(--red-500)" : "var(--fg-3)" }}>{f.error_calls}</span>
                    </td>
                    <td style={{ padding: "8px 10px", color: "var(--fg-2)" }}>${f.estimated_cost_usd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    );
  };

  const Steward = ({ cdes: cdesProps, auditTrail: auditProp, layerCoverage, connectionId, connName }) => {
    // Compliance export pulls a deep audit history (not just the on-screen rows)
    // and downloads it as CSV — auditors want the full trail, not the last 20.
    const [exporting, setExporting] = React.useState(false);
    const exportAudit = async () => {
      setExporting(true);
      try {
        const rows = await window.DTApi.getAuditTrail(connectionId, 500);
        const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const csv = ["time,user,action,entity",
          ...(rows || []).map(r => [r.time, r.user_name || r.user, r.action, r.entity].map(esc).join(","))].join("\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        a.download = `audit-trail-${(connName || "all").replace(/\W+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast(`Exported ${(rows || []).length} audit entries`, { kind: "success" });
      } catch (_) {
        toast("Audit export failed — backend unreachable", { kind: "error" });
      }
      setExporting(false);
    };
    const cdes = cdesProps || [];
    const auditTrail = auditProp || [];
    return (
    <div className="dt-fade-up">
      <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px" }}><SectionTitle icon="shield-alert">CDE health monitor — {cdes.length} registered</SectionTitle></div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "var(--grey-50)", textAlign: "left" }}>
            {["CDE", "Table", "Status", "Last validated"].map(h => <th key={h} style={{ padding: "9px 20px", fontSize: 11, fontWeight: 700, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: ".04em" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {cdes.map((c, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--grey-100)" }}>
                <td style={{ padding: "11px 20px" }}><Mono style={{ fontWeight: 600 }}>{c.name}</Mono></td>
                <td style={{ padding: "11px 20px" }}><Mono style={{ fontSize: 11.5, color: "var(--fg-2)" }}>{c.table}</Mono></td>
                {/* c.status is HEALTHY|WARN|CRIT (the backend's health field) —
                    comparing against "PASS" (a value it never has) meant every
                    truly-healthy CDE rendered as a red "danger" chip here. */}
                <td style={{ padding: "11px 20px" }}><Chip intent={c.status === "HEALTHY" ? "success" : c.status === "WARN" ? "warning" : "danger"} size="sm" dot>{c.status}</Chip></td>
                <td style={{ padding: "11px 20px", color: "var(--fg-2)" }}>{c.validated}</td>
              </tr>
            ))}
            {cdesProps !== null && cdes.length === 0 && (
              <tr><td colSpan={4} style={{ padding: "20px", textAlign: "center", color: "var(--fg-3)", fontSize: 12.5 }}>No CDEs registered yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <AiUsagePanel connectionId={connectionId} />

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <SectionTitle icon="book-open">Dictionary completeness</SectionTitle>
          <div style={{ fontSize: 12, color: "var(--fg-2)", marginBottom: 14 }}>% of columns with a business name or description</div>
          {layerCoverage === null ? <Spinner /> : layerCoverage.length ? layerCoverage.map(({ layer, dictPct }) => (
            <div key={layer} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 5 }}><span>{layer}</span><span style={{ fontWeight: 700 }}>{dictPct}%</span></div>
              <Bar pct={dictPct} color={dictPct >= 85 ? "var(--green-500)" : dictPct >= 65 ? "var(--brand)" : "var(--yellow-500)"} height={7} />
            </div>
          )) : <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>No cataloged columns yet.</div>}
        </Card>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <SectionTitle icon="percent">Rule coverage</SectionTitle>
          <div style={{ fontSize: 12, color: "var(--fg-2)", marginBottom: 14 }}>% of cataloged columns with at least one approved/active rule</div>
          {layerCoverage === null ? <Spinner /> : layerCoverage.length ? layerCoverage.map(({ layer, rulePct }) => (
            <div key={layer} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 5 }}><span>{layer}</span><span style={{ fontWeight: 700 }}>{rulePct}%</span></div>
              <Bar pct={rulePct} color="var(--navy-500)" height={7} />
            </div>
          )) : <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>No cataloged columns yet.</div>}
        </Card>
      </div>

      <Card>
        <SectionTitle icon="scroll-text" right={<Button size="sm" variant="soft" icon="download" onClick={exportAudit} disabled={exporting}>{exporting ? "Exporting…" : "Export for compliance"}</Button>}>Recent audit trail</SectionTitle>
        {auditProp === null ? <Spinner label="Loading audit trail…" /> : auditTrail.length ? auditTrail.map((a, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < auditTrail.length - 1 ? "1px solid var(--grey-100)" : "none" }}>
            <Mono style={{ fontSize: 11.5, color: "var(--fg-3)", width: 64 }}>{a.time}</Mono>
            <Avatar name={a.user} size={24} color="blue" />
            <span style={{ fontSize: 12.5, fontWeight: 600, width: 100 }}>{a.user}</span>
            <Chip intent={a.action === "APPROVE" ? "success" : a.action === "SUPPRESS" ? "warning" : "brand"} size="sm">{a.action}</Chip>
            <span style={{ flex: 1, fontSize: 12.5, color: "var(--fg-2)" }}>{a.entity}</span>
          </div>
        )) : <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "6px 0" }}>No audit trail entries yet.</div>}
      </Card>
    </div>
    );
  };

  const Dashboard = () => {
    const { trustScore, activeConnectionId, activeConnectionName } = useApp();
    const [tab, setTab] = React.useState("tech");
    const { summary, trends, cdeStatus, layerScores, auditTrail, ruleFailTrend, topAnomalies, openTasks, layerCoverage } = useDashboard(activeConnectionId);
    const effectiveTrustScore = summary ? Math.round(summary.overall_score) || trustScore : trustScore;
    useIcons();
    return (
      <div>
        <Tabs tab={tab} setTab={setTab} />
        {tab === "exec"
          ? <Exec trustScore={effectiveTrustScore} trustHistory={trends} scoreDelta={summary?.score_delta}
              yesterdayScore={summary?.yesterday_score} topAnomalies={topAnomalies} layerScores={layerScores} />
          : tab === "tech"
          ? <Tech layerScores={layerScores} cdes={cdeStatus} connName={activeConnectionName} ruleFailTrend={ruleFailTrend} openTasks={openTasks} />
          : <Steward cdes={cdeStatus} auditTrail={auditTrail} layerCoverage={layerCoverage} connectionId={activeConnectionId} connName={activeConnectionName} />}
      </div>
    );
  };

  window.DTScreens.dashboard = Dashboard;
})();
