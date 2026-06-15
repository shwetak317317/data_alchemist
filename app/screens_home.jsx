// DataTrust — Screen: Workspace Home
(function () {
  const Home = () => {
    const { go, trustScore, pipeline, setTrustScore, setPipeline, activeConnectionId, activeConnectionName } = useApp();
    useIcons();
    const D = window.DT;

    // Resolve logged-in user's first name (from sessionStorage set during login/SSO)
    const storedUser = (() => { try { return JSON.parse(sessionStorage.getItem("dt_user") || "{}"); } catch { return {}; } })();
    const firstName = (storedUser.given_name || storedUser.name || "").split(" ")[0] || "there";
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    const [layerScores, setLayerScores] = React.useState(null);
    const [openIssues, setOpenIssues] = React.useState(null);
    const [activity, setActivity] = React.useState(null);

    React.useEffect(() => {
      if (!window.DTApi) return;
      window.DTApi.getDashboardSummary(activeConnectionId)
        .then(s => {
          if (!s) return;
          const score = Math.round(s.overall_score) || trustScore;
          setTrustScore(score);
          if (s.pipeline_status) setPipeline(s.pipeline_status);
          if (s.layers && s.layers.length) {
            setLayerScores(s.layers.map(l => ({
              layer: l.layer, score: Math.round(l.score || 0),
              rules: l.rule_count || 0, passed: (l.rule_count || 0) - (l.open_issues || 0),
              failed: l.open_issues || 0, trend: 0, anomalies: 0,
            })));
          }
          setOpenIssues({ CRITICAL: s.open_critical || 0, HIGH: s.open_high || 0, MEDIUM: s.open_medium || 0 });
          if (s.recent_activity && s.recent_activity.length) {
            setActivity(s.recent_activity.map(r => ({
              time: r.time || "—",
              sev: r.action === "APPROVE" ? "HIGH" : r.action === "SUPPRESS" ? "MEDIUM" : "CRITICAL",
              text: `${r.user || "System"} · ${r.action || "—"} · ${r.entity || "—"}`,
            })));
          }
        })
        .catch(() => {});
    }, [activeConnectionId]);

    const kpiCard = (title, children) => (
      <Card style={{ flex: 1, minWidth: 0 }}>
        <Eyebrow style={{ marginBottom: 14 }}>{title}</Eyebrow>
        {children}
      </Card>
    );

    return (
      <div className="dt-fade-up">
        {/* Greeting */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <h1 style={{ fontSize: 28, marginBottom: 6 }}>{greeting}, {firstName}.</h1>
            <div style={{ fontSize: 14, color: "var(--fg-2)" }}>
              {today} · Last pipeline run <strong style={{ color: "var(--fg-1)" }}>06:03 AM</strong> · Next run 18:00 PM
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="outline" icon="scan-search" onClick={() => go("profiling")}>Open today's run</Button>
            <Button variant="primary" icon="clapperboard" onClick={() => go("simulator")}>Live simulator</Button>
          </div>
        </div>

        {/* KPI row */}
        <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
          {kpiCard("Overall Trust", (
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <ScoreRing score={trustScore} size={96} stroke={9} />
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700,
                  color: trustScore < 75 ? "var(--red-500)" : "var(--green-500)" }}>
                  <i data-lucide={trustScore < 77 ? "trending-down" : "trending-up"} style={{ width: 15, height: 15 }}></i>
                  {trustScore < 77 ? `${trustScore - 77} pts` : `+${trustScore - 77} pts`}
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 3 }}>vs yesterday (77)</div>
              </div>
            </div>
          ))}
          {kpiCard("Open Issues", (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {[["CRITICAL", openIssues?.CRITICAL ?? 0], ["HIGH", openIssues?.HIGH ?? 0], ["MEDIUM", openIssues?.MEDIUM ?? 0]].map(([s, n]) => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: SEV[s].c }}></span>
                  <span style={{ flex: 1, fontSize: 13, color: "var(--fg-2)" }}>{s[0] + s.slice(1).toLowerCase()}</span>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20 }}>{n}</span>
                </div>
              ))}
            </div>
          ))}
          {kpiCard("Anomalies", (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {[["Volume drop", "danger", 1], ["Source late", "warning", 1], ["Segment / drift", "warning", 2]].map(([t, intent, n]) => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Chip intent={intent} size="sm">{n}</Chip>
                  <span style={{ flex: 1, fontSize: 13, color: "var(--fg-2)" }}>{t}</span>
                </div>
              ))}
              <button onClick={() => go("anomalies")} style={{ marginTop: 2, fontSize: 12.5, fontWeight: 600, color: "var(--brand)",
                background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>Go to Anomaly Inbox →</button>
            </div>
          ))}
        </div>

        {/* Layer scores */}
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="layers" right={<span style={{ fontSize: 12, color: "var(--fg-3)" }}>Medallion architecture</span>}>Layer scores</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            {(layerScores || []).map((l) => (
              <button key={l.layer} onClick={() => go("dashboard")} style={{ textAlign: "left", cursor: "pointer",
                border: "1px solid var(--grey-100)", borderRadius: 12, padding: 16, background: scoreTint(l.score),
                transition: "transform 150ms" }}
                onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
                onMouseLeave={(e) => e.currentTarget.style.transform = "none"}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <LayerPill layer={l.layer} />
                  <Health status={l.score >= 85 ? "HEALTHY" : l.score >= 70 ? "WARN" : "CRIT"} />
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 30, color: scoreColor(l.score), lineHeight: 1 }}>
                  {l.score}<span style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600 }}>/100</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--fg-2)", marginTop: 6 }}>{l.failed} failing · {l.anomalies} anomal{l.anomalies === 1 ? "y" : "ies"}</div>
              </button>
            ))}
          </div>
        </Card>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {/* Recent activity */}
          <Card style={{ flex: 2, minWidth: 360 }}>
            <SectionTitle icon="activity" sub={activeConnectionId ? `Live · ${activeConnectionName}` : "Demo data · connect a real database for live activity"}>Recent activity</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {(activity || []).map((a, i) => (
                <div key={i} className="dt-row-hover" onClick={() => go("execution")} style={{ display: "flex", alignItems: "center", gap: 12,
                  padding: "11px 8px", borderRadius: 8, cursor: "pointer", borderBottom: i < (activity || []).length - 1 ? "1px solid var(--grey-100)" : "none" }}>
                  <Mono style={{ color: "var(--fg-3)", fontSize: 12 }}>{a.time}</Mono>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: SEV[a.sev].c, flexShrink: 0 }}></span>
                  <span style={{ flex: 1, fontSize: 13, color: "var(--fg-1)" }}>{a.text}</span>
                  <i data-lucide="chevron-right" style={{ width: 15, height: 15, color: "var(--fg-3)" }}></i>
                </div>
              ))}
            </div>
          </Card>

          {/* Workflow progress */}
          <Card style={{ flex: 1, minWidth: 280 }}>
            <SectionTitle icon="git-branch">Agentic workflow</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {[
                ["Profiling", "profiling", "done"],
                ["Dictionary & CDEs", "metadata", "done"],
                ["Rule Studio", "rules", "active"],
                ["DQ Execution", "execution", "active"],
                ["Anomaly + Explain", "anomalies", "pending"],
                ["Trust Dashboard", "dashboard", "pending"],
              ].map(([label, id, st], i, arr) => (
                <div key={id} style={{ display: "flex", gap: 12, alignItems: "stretch", cursor: "pointer" }} onClick={() => go(id)}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: st === "done" ? "var(--green-500)" : st === "active" ? "var(--brand)" : "var(--grey-100)",
                      color: st === "pending" ? "var(--fg-3)" : "#fff", fontSize: 11, fontWeight: 700 }}>
                      {st === "done" ? <i data-lucide="check" style={{ width: 12, height: 12 }}></i> : i + 1}
                    </span>
                    {i < arr.length - 1 && <span style={{ flex: 1, width: 2, background: st === "done" ? "var(--green-200)" : "var(--grey-100)", minHeight: 14 }}></span>}
                  </div>
                  <div style={{ paddingBottom: 12, paddingTop: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: st === "active" ? 700 : 500, color: st === "pending" ? "var(--fg-3)" : "var(--fg-1)" }}>{label}</div>
                    {st === "active" && <div style={{ fontSize: 11, color: "var(--brand)", marginTop: 1 }}>In progress</div>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  };

  window.DTScreens.home = Home;
})();
