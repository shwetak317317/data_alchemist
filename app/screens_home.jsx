// DataTrust — Screen: Workspace Home
(function () {
  const Home = () => {
    const { go, trustScore, pipeline, setTrustScore, setPipeline, activeConnectionId, activeConnectionName } = useApp();
    useIcons();

    // Logged-in user
    const storedUser = (() => { try { return JSON.parse(sessionStorage.getItem("dt_user") || "{}"); } catch { return {}; } })();
    const firstName = (storedUser.given_name || storedUser.name || "").split(" ")[0] || "there";
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    const [summary, setSummary] = React.useState(null);
    const [attention, setAttention] = React.useState(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
      if (!window.DTApi) { setLoading(false); return; }
      setLoading(true);
      setAttention(null);
      window.DTApi.getDashboardSummary(activeConnectionId)
        .then(s => {
          if (!s) return;
          setSummary(s);
          const score = Math.round(s.overall_score) || 0;
          setTrustScore(score);
          if (s.pipeline_status) setPipeline(s.pipeline_status);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
      if (window.DTApi.getAttention) {
        window.DTApi.getAttention(activeConnectionId)
          .then(a => setAttention(a))
          .catch(() => setAttention({ items: [], since: null, freshness: [] }));
      }
    }, [activeConnectionId]);

    // Format last_run_at timestamp → "06:03 AM" (local time)
    const lastRunLabel = React.useMemo(() => {
      if (!summary?.last_run_at) return null;
      try {
        const d = new Date(summary.last_run_at);
        return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      } catch { return null; }
    }, [summary?.last_run_at]);

    // Yesterday score: either from backend or estimate from current - delta
    const yesterdayScore = React.useMemo(() => {
      if (!summary) return null;
      if (summary.yesterday_score != null) return Math.round(summary.yesterday_score);
      if (summary.score_delta != null) return Math.round((summary.overall_score || 0) - summary.score_delta);
      return null;
    }, [summary]);

    const scoreDelta = summary?.score_delta ?? 0;

    // Workflow steps: derive from summary.workflow_states
    const WORKFLOW_STEPS = [
      { label: "Profiling",        id: "profiling",  screen: "profiling" },
      { label: "Dictionary & CDEs",id: "metadata",   screen: "metadata"  },
      { label: "Rule Studio",      id: "rules",      screen: "rules"     },
      { label: "DQ Execution",     id: "execution",  screen: "execution" },
      { label: "Anomaly + Explain",id: "anomalies",  screen: "anomalies" },
      { label: "Trust Dashboard",  id: "dashboard",  screen: "dashboard" },
    ];
    const workflowStates = summary?.workflow_states || {};

    // Anomaly breakdown — from backend, not hardcoded
    const anomalyBreakdown = summary?.anomaly_breakdown || [];
    const totalAnomalies   = summary?.active_anomalies ?? 0;

    // Layer scores enriched with fail + anomaly counts
    const layerScores = React.useMemo(() => {
      if (!summary?.layers) return [];
      return summary.layers.map(l => ({
        layer:     l.layer,
        score:     Math.round(l.score || 0),
        failed:    l.open_issues || 0,
        anomalies: summary.layer_anomaly_counts?.[l.layer] || 0,
      }));
    }, [summary]);

    // Open issues
    const openIssues = {
      CRITICAL: summary?.open_critical ?? 0,
      HIGH:     summary?.open_high     ?? 0,
      MEDIUM:   summary?.open_medium   ?? 0,
      ERRORS:   summary?.open_errors   ?? 0,
    };

    // Recent activity
    const activity = summary?.recent_activity || [];

    const kpiCard = (title, children) => (
      <Card style={{ flex: 1, minWidth: 0 }}>
        <Eyebrow style={{ marginBottom: 14 }}>{title}</Eyebrow>
        {children}
      </Card>
    );

    return (
      <div className="dt-fade-up">
        {/* ── Greeting ───────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <h1 style={{ fontSize: 28, marginBottom: 6 }}>{greeting}, {firstName}.</h1>
            <div style={{ fontSize: 14, color: "var(--fg-2)" }}>
              {today}
              {lastRunLabel && (
                <> · Last pipeline run <strong style={{ color: "var(--fg-1)" }}>{lastRunLabel}</strong></>
              )}
              {!lastRunLabel && !loading && (
                <span style={{ color: "var(--fg-3)" }}> · No pipeline runs yet</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="outline" icon="scan-search" onClick={() => go("profiling")}>Open today's run</Button>
            <Button variant="primary" icon="clapperboard" onClick={() => go("simulator")}>Live simulator</Button>
          </div>
        </div>

        {/* ── KPI row ────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>

          {/* Overall Trust */}
          {kpiCard("Overall Trust", (
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <ScoreRing score={trustScore} size={96} stroke={9} />
              <div>
                {yesterdayScore != null ? (
                  <>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700,
                      color: scoreDelta < 0 ? "var(--red-500)" : "var(--green-500)" }}>
                      {scoreDelta < 0
                        ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
                        : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                      }
                      {scoreDelta > 0 ? "+" : ""}{Math.round(scoreDelta)} pts
                    </div>
                    <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 3 }}>vs yesterday ({yesterdayScore})</div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
                    {loading ? "Loading…" : summary?.profiled_table_count
                      ? `${summary.profiled_table_count} table${summary.profiled_table_count !== 1 ? "s" : ""} profiled`
                      : "No history yet"}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Open Issues */}
          {kpiCard("Open Issues", (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {[["CRITICAL", openIssues.CRITICAL], ["HIGH", openIssues.HIGH], ["MEDIUM", openIssues.MEDIUM]].map(([s, n]) => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: SEV[s].c }}></span>
                  <span style={{ flex: 1, fontSize: 13, color: "var(--fg-2)" }}>{s[0] + s.slice(1).toLowerCase()}</span>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20,
                    color: n > 0 && s === "CRITICAL" ? "var(--red-500)" : n > 0 && s === "HIGH" ? "var(--yellow-600)" : "var(--fg-1)" }}>{n}</span>
                </div>
              ))}
              {openIssues.ERRORS > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 6, borderTop: "1px dashed var(--grey-200)" }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--purple-500, #8b5cf6)" }}></span>
                  <span style={{ flex: 1, fontSize: 13, color: "var(--fg-2)" }}>Couldn't run (source unreachable)</span>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, color: "var(--purple-500, #8b5cf6)" }}>{openIssues.ERRORS}</span>
                </div>
              )}
              {!loading && openIssues.CRITICAL === 0 && openIssues.HIGH === 0 && openIssues.MEDIUM === 0 && openIssues.ERRORS === 0 && (
                <div style={{ fontSize: 11.5, color: "var(--green-600)", marginTop: 2, fontWeight: 600 }}>No open issues</div>
              )}
            </div>
          ))}

          {/* Anomalies — fully dynamic */}
          {kpiCard("Anomalies", (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {anomalyBreakdown.length > 0 ? (
                <>
                  {anomalyBreakdown.map((a) => (
                    <div key={a.type} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Chip intent={a.intent} size="sm">{a.count}</Chip>
                      <span style={{ flex: 1, fontSize: 13, color: "var(--fg-2)" }}>{a.label}</span>
                    </div>
                  ))}
                  <button onClick={() => go("anomalies")} style={{ marginTop: 2, fontSize: 12.5, fontWeight: 600,
                    color: "var(--brand)", background: "none", border: "none", cursor: "pointer",
                    textAlign: "left", padding: 0 }}>Go to Anomaly Inbox →</button>
                </>
              ) : (
                <div style={{ fontSize: 13, color: "var(--fg-3)", fontStyle: "italic" }}>
                  {loading ? "Loading…" : totalAnomalies === 0 ? "No open anomalies" : `${totalAnomalies} anomalies — details unavailable`}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Layer scores ───────────────────────────────────────────────── */}
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="layers" right={<span style={{ fontSize: 12, color: "var(--fg-3)" }}>Medallion architecture</span>}>Layer scores</SectionTitle>
          {layerScores.length === 0 && !loading ? (
            <div style={{ fontSize: 13, color: "var(--fg-3)", fontStyle: "italic", padding: "8px 0" }}>
              Profile at least one table to see layer scores.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
              {(layerScores.length > 0 ? layerScores : [{ layer:"RAW",score:0,failed:0,anomalies:0 },{ layer:"BRONZE",score:0,failed:0,anomalies:0 },{ layer:"SILVER",score:0,failed:0,anomalies:0 },{ layer:"GOLD",score:0,failed:0,anomalies:0 }]).map((l) => (
                <button key={l.layer} onClick={() => go("dashboard")} style={{ textAlign: "left", cursor: "pointer",
                  border: "1px solid var(--grey-100)", borderRadius: 12, padding: 16,
                  background: l.score === 0 ? "var(--grey-50)" : scoreTint(l.score),
                  transition: "transform 150ms", opacity: l.score === 0 && layerScores.length > 0 ? 0.55 : 1 }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
                  onMouseLeave={(e) => e.currentTarget.style.transform = "none"}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <LayerPill layer={l.layer} />
                    {l.score > 0
                      ? <Health status={l.score >= 85 ? "HEALTHY" : l.score >= 70 ? "WARN" : "CRIT"} />
                      : <span style={{ fontSize: 11, color: "var(--fg-3)", fontStyle: "italic" }}>—</span>}
                  </div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 30,
                    color: l.score > 0 ? scoreColor(l.score) : "var(--fg-3)", lineHeight: 1 }}>
                    {l.score > 0 ? l.score : "—"}
                    {l.score > 0 && <span style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 600 }}>/100</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-2)", marginTop: 6 }}>
                    {l.score > 0
                      ? <>{l.failed} failing · {l.anomalies} anomal{l.anomalies !== 1 ? "ies" : "y"}</>
                      : <span style={{ color: "var(--fg-3)" }}>Not profiled</span>}
                  </div>
                  {(() => {
                    const f = (attention?.freshness || []).find(x => x.layer === l.layer);
                    if (!f) return null;
                    const label = f.state === "never" ? "never checked"
                      : f.age_hours < 1 ? "checked just now"
                      : f.age_hours < 24 ? `checked ${Math.round(f.age_hours)}h ago`
                      : `checked ${Math.round(f.age_hours / 24)}d ago`;
                    const color = f.state === "fresh" ? "var(--green-600)" : f.state === "aging" ? "var(--yellow-700)" : f.state === "stale" ? "var(--red-500)" : "var(--fg-3)";
                    return <div style={{ fontSize: 10.5, marginTop: 4, fontWeight: 600, color }} title="Most recent profiling or DQ execution touching this layer">⏱ {label}</div>;
                  })()}
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* ── Since you left ─────────────────────────────────────────────── */}
        {attention?.since && (attention.since.new_anomalies > 0 || attention.since.newly_failing_rules.length > 0) && (
          <Card style={{ marginBottom: 16, padding: "10px 16px", background: "var(--yellow-50, #fefce8)", border: "1px solid var(--yellow-200, #fde68a)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
            <i data-lucide="history" style={{ width: 15, height: 15, color: "var(--yellow-700)" }}></i>
            <strong>In the last 24h:</strong>
            {attention.since.new_anomalies > 0 && <span>{attention.since.new_anomalies} new anomal{attention.since.new_anomalies === 1 ? "y" : "ies"}</span>}
            {attention.since.newly_failing_rules.length > 0 && (
              <span>· {attention.since.newly_failing_rules.length} rule{attention.since.newly_failing_rules.length === 1 ? "" : "s"} started failing ({attention.since.newly_failing_rules.slice(0, 2).join(", ")}{attention.since.newly_failing_rules.length > 2 ? "…" : ""})</span>
            )}
            <button onClick={() => go("anomalies")} style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--brand)", background: "none", border: "none", cursor: "pointer" }}>Review →</button>
          </Card>
        )}

        {/* ── Needs your attention ───────────────────────────────────────── */}
        {attention === null ? null : attention.items.length > 0 ? (
          <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px 10px", display: "flex", alignItems: "center", gap: 8 }}>
              <SectionTitle icon="inbox" sub="Everything that needs a human right now — worst first. Click a row to act on it.">Needs your attention</SectionTitle>
              <Chip intent={attention.items.some(i => i.severity === "CRITICAL") ? "danger" : "warning"} style={{ marginLeft: "auto" }}>{attention.items.length}</Chip>
            </div>
            {attention.items.slice(0, 6).map((it, i) => (
              <div key={i} className="dt-row-hover" onClick={() => go(it.action)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", borderTop: "1px solid var(--grey-100)", cursor: "pointer" }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: it.severity === "CRITICAL" ? "var(--red-500)" : it.severity === "HIGH" ? "var(--orange-500)" : "var(--yellow-500)" }}></span>
                <Chip size="sm" intent="neutral">{it.kind}</Chip>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.detail}</div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--brand)", flexShrink: 0 }}>
                  {it.kind === "anomaly" ? "Open inbox →" : it.kind === "rule" ? "View run →" : "Open tasks →"}
                </span>
              </div>
            ))}
            {attention.items.length > 6 && (
              <div style={{ padding: "8px 20px", borderTop: "1px solid var(--grey-100)", fontSize: 11.5, color: "var(--fg-3)" }}>
                +{attention.items.length - 6} more in their respective screens
              </div>
            )}
          </Card>
        ) : !loading && (
          <Card style={{ marginBottom: 16, padding: "12px 20px", display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--green-700, var(--green-600))" }}>
            <i data-lucide="check-circle-2" style={{ width: 16, height: 16, color: "var(--green-500)" }}></i>
            Nothing needs your attention — no open critical issues, failing rules, or overdue tasks.
          </Card>
        )}

        {/* ── Bottom row ─────────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>

          {/* Recent activity */}
          <Card style={{ flex: 2, minWidth: 360 }}>
            <SectionTitle icon="activity" sub={activeConnectionId ? `Live · ${activeConnectionName || "connected"}` : "Connect a database to see live activity"}>Recent activity</SectionTitle>
            {activity.length === 0 ? (
              <div style={{ padding: "16px 0", fontSize: 13, color: "var(--fg-3)", fontStyle: "italic" }}>
                {loading ? "Loading…" : "No activity recorded yet. Run profiling or execute rules to generate audit events."}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {activity.map((a, i) => (
                  <div key={i} className="dt-row-hover" onClick={() => go("execution")} style={{ display: "flex", alignItems: "center", gap: 12,
                    padding: "11px 8px", borderRadius: 8, cursor: "pointer",
                    borderBottom: i < activity.length - 1 ? "1px solid var(--grey-100)" : "none" }}>
                    <Mono style={{ color: "var(--fg-3)", fontSize: 12 }}>{a.time}</Mono>
                    <span style={{ width: 8, height: 8, borderRadius: "50%",
                      background: a.action === "APPROVE" ? "var(--green-500)" : a.action === "REJECT" ? "var(--red-500)" : "var(--yellow-500)",
                      flexShrink: 0 }}></span>
                    <span style={{ flex: 1, fontSize: 13, color: "var(--fg-1)" }}>
                      <strong>{a.user}</strong> · {a.action} · <span style={{ color: "var(--fg-2)" }}>{a.entity}</span>
                    </span>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--fg-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Agentic workflow — fully dynamic */}
          <Card style={{ flex: 1, minWidth: 280 }}>
            <SectionTitle icon="git-branch">Agentic workflow</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {WORKFLOW_STEPS.map(({ label, id, screen }, i, arr) => {
                const st = workflowStates[id] || (loading ? "pending" : (i === 0 ? "active" : "pending"));
                return (
                  <div key={id} style={{ display: "flex", gap: 12, alignItems: "stretch", cursor: "pointer" }} onClick={() => go(screen)}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "inline-flex",
                        alignItems: "center", justifyContent: "center",
                        background: st === "done" ? "var(--green-500)" : st === "active" ? "var(--brand)" : "var(--grey-100)",
                        color: st === "pending" ? "var(--fg-3)" : "#fff", fontSize: 11, fontWeight: 700 }}>
                        {st === "done"
                          ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          : i + 1}
                      </span>
                      {i < arr.length - 1 && (
                        <span style={{ flex: 1, width: 2, minHeight: 14,
                          background: st === "done" ? "var(--green-200)" : "var(--grey-100)" }}></span>
                      )}
                    </div>
                    <div style={{ paddingBottom: 12, paddingTop: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: st === "active" ? 700 : 500,
                        color: st === "pending" ? "var(--fg-3)" : "var(--fg-1)" }}>{label}</div>
                      {st === "active" && <div style={{ fontSize: 11, color: "var(--brand)", marginTop: 1 }}>In progress</div>}
                      {st === "done"   && <div style={{ fontSize: 11, color: "var(--green-600)", marginTop: 1 }}>Complete</div>}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Summary stats */}
            {summary && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--grey-100)",
                display: "flex", gap: 16, flexWrap: "wrap" }}>
                {[
                  ["Tables profiled", summary.profiled_table_count],
                  ["CDE health", `${Math.round(summary.cde_health_pct || 100)}%`],
                  ["Open issues", (summary.open_critical + summary.open_high + summary.open_medium)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 10.5, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: ".04em" }}>{k}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>{v}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    );
  };

  window.DTScreens.home = Home;
})();
