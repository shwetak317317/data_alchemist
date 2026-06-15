// DataTrust — Screen: Trust Dashboard (Exec / Technical / Steward)
(function () {
  const D = window.DT;

  function useDashboard(activeConnectionId) {
    const [summary, setSummary] = React.useState(null);
    const [trends, setTrends] = React.useState(null);
    const [cdeStatus, setCdeStatus] = React.useState(null);
    const [layerScores, setLayerScores] = React.useState(null);
    const [auditTrail, setAuditTrail] = React.useState(null);
    const [ruleFailTrend, setRuleFailTrend] = React.useState(null);

    React.useEffect(() => {
      if (!window.DTApi) return;
      setSummary(null);
      setTrends(null);
      setCdeStatus(null);
      setLayerScores(null);
      setAuditTrail(null);
      setRuleFailTrend(null);

      window.DTApi.getDashboardSummary(activeConnectionId)
        .then(s => {
          if (!s) return;
          setSummary(s);
          if (s.layers && s.layers.length) {
            setLayerScores(s.layers.map(l => ({
              layer: l.layer, score: Math.round(l.score || 0),
              rules: l.rule_count || 0, passed: (l.rule_count || 0) - (l.open_issues || 0),
              failed: l.open_issues || 0, trend: 0, anomalies: 0,
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
    }, [activeConnectionId]);

    return { summary, trends, cdeStatus, layerScores, auditTrail, ruleFailTrend };
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

  const Exec = ({ trustScore, trustHistory }) => {
    const history = trustHistory || [];
    return (
    <div className="dt-fade-up">
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <Card style={{ flex: 1, minWidth: 240, display: "flex", alignItems: "center", gap: 20 }}>
          <ScoreRing score={trustScore} size={120} stroke={11} sublabel="overall trust" />
          <div>
            <Eyebrow>Data trust score</Eyebrow>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: trustScore < 77 ? "var(--red-500)" : "var(--green-500)", marginTop: 8 }}>
              <i data-lucide={trustScore < 77 ? "trending-down" : "trending-up"} style={{ width: 15, height: 15 }}></i>{trustScore - 77} pts vs yesterday</div>
            <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 6, maxWidth: 200 }}>Pipeline issue under active remediation. ETA 10:50 AM.</div>
          </div>
        </Card>
        <Card style={{ flex: 2, minWidth: 320 }}>
          <SectionTitle icon="trending-up">Trust score — last 14 days</SectionTitle>
          <LineChart data={history} height={150} yMin={40} yMax={100} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            {history.map(d => <span key={d.label} style={{ fontSize: 10, color: "var(--fg-3)" }}>{d.label}</span>)}
          </div>
        </Card>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <SectionTitle icon="alert-circle">Top issues — in plain English</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            ["Today's revenue is understated by ~$221M because 12% of orders are missing their revenue value. A pipeline step failed; fix is in progress.", "CRITICAL"],
            ["The order count is 57% lower than normal — over 2.5M orders are missing from today's data due to a late source feed.", "CRITICAL"],
            ["The shipment feed arrived 85 minutes late, so delivery status data is slightly stale.", "HIGH"],
          ].map(([t, sev], i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: 14, background: SEV[sev].bg, borderRadius: 10 }}>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18, color: SEV[sev].c, width: 22 }}>{i + 1}</span>
              <div style={{ flex: 1, fontSize: 13, color: "var(--fg-1)", lineHeight: 1.5 }}>{t}</div>
              <Severity level={sev} size="sm" />
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Card style={{ flex: 1, minWidth: 240 }}>
          <SectionTitle icon="x-octagon">Impacted business areas</SectionTitle>
          {[["Finance Reporting", "fail"], ["Revenue Analytics", "fail"], ["Operations / Fulfilment", "warn"], ["ML Revenue Models", "warn"]].map(([a, s]) => (
            <div key={a} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--grey-100)" }}>
              <i data-lucide={s === "fail" ? "x-circle" : "alert-triangle"} style={{ width: 16, height: 16, color: s === "fail" ? "var(--red-500)" : "var(--yellow-600)" }}></i>
              <span style={{ fontSize: 13 }}>{a}</span>
            </div>
          ))}
        </Card>
        <Card style={{ flex: 1, minWidth: 240 }}>
          <SectionTitle icon="check-circle-2">Areas unaffected</SectionTitle>
          {["Customer Intelligence", "Product Performance", "Marketing Segmentation"].map(a => (
            <div key={a} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--grey-100)" }}>
              <i data-lucide="check-circle-2" style={{ width: 16, height: 16, color: "var(--green-500)" }}></i>
              <span style={{ fontSize: 13 }}>{a}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
    );
  };

  const Tech = ({ layerScores: lsProps, cdes: cdesProps, connName, ruleFailTrend: rftProps }) => {
    const layerScores = lsProps || [];
    const cdes = cdesProps || [];
    return (
    <div className="dt-fade-up">
      <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px" }}><SectionTitle icon="layers">Layer scorecard</SectionTitle></div>
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
                <td style={{ padding: "11px 20px", color: "var(--fg-2)" }}>{l.anomalies}</td>
                <td style={{ padding: "11px 20px", color: "var(--red-500)", fontWeight: 600 }}>▼ {l.trend} pts</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <SectionTitle icon="columns-3">CDE column health{connName ? ` — ${connName}` : ""}</SectionTitle>
          {cdes.map(c => (
            <div key={c.name || c.column_name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--grey-100)" }}>
              <Mono style={{ flex: 1, fontWeight: 700 }}>{c.name || c.column_name}</Mono>
              <Chip intent="brand" size="sm">CDE</Chip>
              <span style={{ fontWeight: 700, fontSize: 13, color: scoreColor(c.score || c.cde_score || 80), width: 30, textAlign: "right" }}>{c.score || c.cde_score || "—"}</span>
              <Health status={c.health || (c.status === "PASS" ? "HEALTHY" : c.status === "WARN" ? "WARN" : "CRIT")} />
            </div>
          ))}
        </Card>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <SectionTitle icon="bar-chart-3" sub="Today 5 vs 7-day avg 2.3">Rule failures — last 7 days</SectionTitle>
          <div style={{ marginTop: 18 }}><BarSeries data={rftProps || []} height={120} highlightLast lastColor="var(--red-500)" baseColor="var(--blue-300)" /></div>
        </Card>
      </div>

      <Card>
        <SectionTitle icon="user-cog">Open issues with owners</SectionTitle>
        {[
          ["Re-run Silver pipeline (net_revenue null)", "Deepa Nair", "10:50 AM"],
          ["Investigate bronze duplicate orders (23)", "Ravi Kumar", "Today"],
          ["Clarify RTN_INIT status code (OMS team)", "Ravi Kumar", "This week"],
          ["WMS feed SLA — raise with infra team", "Ravi Kumar", "Today"],
        ].map(([t, o, eta], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--grey-100)" }}>
            <span style={{ flex: 1, fontSize: 13 }}>{t}</span>
            <Avatar name={o} size={24} color="blue" /><span style={{ fontSize: 12.5, color: "var(--fg-2)", width: 90 }}>{o}</span>
            <Chip intent="neutral" size="sm" icon="clock">{eta}</Chip>
          </div>
        ))}
      </Card>
    </div>
    );
  };

  const Steward = ({ cdes: cdesProps, auditTrail: auditProp }) => {
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
                <td style={{ padding: "11px 20px" }}><Chip intent={c.status === "PASS" ? "success" : c.status === "WARN" ? "warning" : "danger"} size="sm" dot>{c.status}</Chip></td>
                <td style={{ padding: "11px 20px", color: "var(--fg-2)" }}>{c.validated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <SectionTitle icon="book-open">Dictionary completeness</SectionTitle>
          {[["Raw", 48], ["Bronze", 72], ["Silver", 91], ["Gold", 83]].map(([l, p]) => (
            <div key={l} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 5 }}><span>{l}</span><span style={{ fontWeight: 700 }}>{p}%</span></div>
              <Bar pct={p} color={p >= 85 ? "var(--green-500)" : p >= 65 ? "var(--brand)" : "var(--yellow-500)"} height={7} />
            </div>
          ))}
        </Card>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <SectionTitle icon="percent">Rule coverage</SectionTitle>
          <div style={{ fontSize: 12, color: "var(--fg-2)", marginBottom: 14 }}>% of columns with at least one active rule</div>
          {[["Raw", 40], ["Bronze", 65], ["Silver", 88], ["Gold", 75]].map(([l, p]) => (
            <div key={l} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 5 }}><span>{l}</span><span style={{ fontWeight: 700 }}>{p}%</span></div>
              <Bar pct={p} color="var(--navy-500)" height={7} />
            </div>
          ))}
        </Card>
      </div>

      <Card>
        <SectionTitle icon="scroll-text" right={<Button size="sm" variant="soft" icon="download">Export for compliance</Button>}>Recent audit trail</SectionTitle>
        {auditTrail.map((a, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < auditTrail.length - 1 ? "1px solid var(--grey-100)" : "none" }}>
            <Mono style={{ fontSize: 11.5, color: "var(--fg-3)", width: 64 }}>{a.time}</Mono>
            <Avatar name={a.user} size={24} color={a.user.includes("Priya") ? "purple" : "blue"} />
            <span style={{ fontSize: 12.5, fontWeight: 600, width: 100 }}>{a.user}</span>
            <Chip intent={a.action === "APPROVE" ? "success" : a.action === "SUPPRESS" ? "warning" : "brand"} size="sm">{a.action}</Chip>
            <span style={{ flex: 1, fontSize: 12.5, color: "var(--fg-2)" }}>{a.entity}</span>
          </div>
        ))}
      </Card>
    </div>
    );
  };

  const Dashboard = () => {
    const { trustScore, activeConnectionId, activeConnectionName } = useApp();
    const [tab, setTab] = React.useState("tech");
    const { summary, trends, cdeStatus, layerScores, auditTrail, ruleFailTrend } = useDashboard(activeConnectionId);
    const effectiveTrustScore = summary ? Math.round(summary.overall_score) || trustScore : trustScore;
    useIcons();
    return (
      <div>
        <Tabs tab={tab} setTab={setTab} />
        {tab === "exec" ? <Exec trustScore={effectiveTrustScore} trustHistory={trends} /> : tab === "tech" ? <Tech layerScores={layerScores} cdes={cdeStatus} connName={activeConnectionName} ruleFailTrend={ruleFailTrend} /> : <Steward cdes={cdeStatus} auditTrail={auditTrail} />}
      </div>
    );
  };

  window.DTScreens.dashboard = Dashboard;
})();
