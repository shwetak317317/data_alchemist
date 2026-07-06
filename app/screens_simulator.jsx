// DataTrust — Screens: Live Scenario Simulator (hero) + Task Board + Daily Summary
(function () {

  // ---- Demo preset picker — used only when the backend is unreachable ----
  // This is NOT a classifier. It maps quick-pick preset phrases to their scenario object
  // so the UI still works in demo mode. Classification is the backend's job.
  function _demoPreset(text) {
    const t = text.toLowerCase();
    const checks = [
      [["northeast", "apac", "emea", "region", "segment", "partition"], SCN.segment],
      [["null", "blank", "revenue", "not loaded"],                      SCN.nullcol],
      [["drop", "volume", "overnight", "60%", "row count"],             SCN.volume],
      [["ghost", "invalid value", "whitelist", "unapproved"],           SCN.whitelist],
      [["crm", "feed", "arrive", "source file", "sla"],                 SCN.source],
    ];
    for (const [keywords, preset] of checks) {
      if (keywords.some(kw => t.includes(kw))) return preset;
    }
    return SCN.volume; // most common DQ issue type as default
  }

  const ev = (at, kind, title, detail) => ({ at, kind, title, detail });
  const SCN = {
    segment: {
      type: "Segment loss", drop: 54, undercount: "$73.5M",
      inject: "DELETE FROM silver.orders_enriched WHERE region='Northeast' → 841,200 rows (18.4% of avg daily volume)",
      events: [
        ev(0, "inject", "Scenario injected", "Northeast region orders removed — 841,200 rows"),
        ev(900, "scan", "Monitoring agent triggered incremental DQ scan", "watching silver + gold"),
        ev(2100, "fail", "ANOMALY: Volume — silver.orders_enriched", "Northeast segment: 0 rows today vs avg 841,200 · 100% drop · CRITICAL"),
        ev(2700, "fail", "ANOMALY: Cross-segment imbalance", "Northeast share 0% today vs avg 18.4% · West + Central spiking"),
        ev(3300, "fail", "RULE FAILURE: gold.daily_revenue_summary", "net_revenue 22% below 7-day avg (Northeast ≈ 21% of revenue)"),
        ev(3900, "explain", "Business explanation generated", "regional data loss narrative ready"),
      ],
      title: "CRITICAL DATA TRUST ALERT — Regional Data Loss",
      body: [
        "The Northeast region has sent zero orders today, vs its daily average of 841,000 — a 100% data loss for that region.",
        "Revenue undercount of approximately $73.5M.",
        "Northeast regional KPIs will show as zero; customer segmentation misses 18% of daily customers.",
        "Fulfilment SLA for Northeast appears as 100% (no orders = no breach detected — a false positive).",
        "Downstream: 4 Gold tables, 2 dashboards, 1 ML model. Recommend contacting Northeast OMS team and holding the Gold re-run.",
      ],
    },
    nullcol: {
      type: "Column NULL", drop: 52, undercount: "$221.9M",
      inject: "UPDATE silver.orders_enriched SET net_revenue=NULL WHERE order_date=CURRENT_DATE → 228,445 rows",
      events: [
        ev(0, "inject", "Scenario injected", "net_revenue set to NULL for today's orders"),
        ev(800, "scan", "Monitoring agent triggered DQ execution", "re-running Silver rule set"),
        ev(2000, "fail", "CRITICAL ALERT: revenue_not_null FAILED", "228,445 records · 12.4% null · Silver layer"),
        ev(2600, "fail", "Anomaly detected", "null rate 15× above baseline (0.8% → 12.4%)"),
        ev(3200, "explain", "Business explanation generated", "Finance + ML impact narrative ready"),
      ],
      title: "CRITICAL DATA TRUST ALERT — Revenue Data Missing",
      body: [
        "Today's revenue data is missing for 12.4% of orders (228,445 records).",
        "Revenue undercount of approximately $221.9M.",
        "Impacts the Finance Daily Revenue Dashboard and 3 production ML models.",
        "Likely caused by an incomplete pipeline run — the discount calculation step did not populate net_revenue.",
        "Recommend re-running the Bronze + Silver pipelines for today's partition.",
      ],
    },
    volume: {
      type: "Volume drop", drop: 50, undercount: "$132M",
      inject: "DELETE FROM bronze.orders WHERE order_date=CURRENT_DATE LIMIT 60% → 2.6M rows removed",
      events: [
        ev(0, "inject", "Scenario injected", "60% of today's Bronze orders deleted"),
        ev(900, "scan", "Monitoring agent triggered volume scan", "comparing vs 7-day rolling average"),
        ev(2100, "fail", "ANOMALY: Volume drop — bronze.orders", "row count −60% vs baseline · ±2σ breach · CRITICAL"),
        ev(2800, "fail", "Cascade: silver.orders_enriched under-populated", "downstream Gold aggregates will undercount"),
        ev(3400, "explain", "Business explanation generated", "volume anomaly narrative ready"),
      ],
      title: "CRITICAL DATA TRUST ALERT — Volume Collapse",
      body: [
        "Today's order volume is 60% below the 7-day rolling average.",
        "Revenue undercount of approximately $132M.",
        "All channels and regions affected proportionally — points to an ingestion/source issue, not a business event.",
        "Downstream Gold revenue and segment tables will undercount until reloaded.",
        "Recommend verifying the source extract completeness and re-ingesting the Bronze partition.",
      ],
    },
    whitelist: {
      type: "Whitelist breach", drop: 63, undercount: "—",
      inject: "INSERT INTO silver.orders_enriched (status) VALUES ('GHOST') × 5,000 rows",
      events: [
        ev(0, "inject", "Scenario injected", "5,000 rows with status='GHOST' inserted"),
        ev(800, "scan", "Monitoring agent triggered rule scan", "status whitelist check"),
        ev(1900, "fail", "RULE FAILURE: status IN whitelist", "5,000 rows with unapproved value 'GHOST' · HIGH"),
        ev(2600, "warn", "ANOMALY: Segment concentration", "GHOST appears in 1 channel only — possible deploy bug"),
        ev(3200, "explain", "Business explanation generated", "invalid code narrative ready"),
      ],
      title: "HIGH DATA TRUST ALERT — Unapproved Status Code",
      body: [
        "5,000 orders carry status 'GHOST', which is not in the approved whitelist.",
        "Order lifecycle reporting and fulfilment routing for these orders is undefined.",
        "Concentrated in a single channel — suggests a code deployment introduced the value.",
        "Recommend confirming with the OMS team whether 'GHOST' is intentional; if not, quarantine the rows.",
      ],
    },
    source: {
      type: "Source non-arrival", drop: 58, undercount: "—",
      inject: "Remove raw.crm_customers arrival timestamp for today (file never landed)",
      events: [
        ev(0, "inject", "Scenario injected", "CRM source file removed for today"),
        ev(1000, "scan", "Monitoring agent checked source arrivals", "expected by 05:30 AM"),
        ev(2200, "fail", "SOURCE NON-ARRIVAL: raw.crm_customers", "file not seen · SLA breached · HIGH"),
        ev(2900, "warn", "Downstream freshness at risk", "bronze.customers + 3 Silver joins will use stale data"),
        ev(3500, "explain", "Business explanation generated", "source SLA narrative ready"),
      ],
      title: "HIGH DATA TRUST ALERT — Source Feed Missing",
      body: [
        "The CRM customer extract has not arrived (expected by 05:30 AM).",
        "Customer attributes (region, loyalty tier) will be stale or missing in today's joins.",
        "3 Silver tables and downstream segmentation depend on this feed.",
        "Recommend contacting the CRM source team and holding dependent pipelines until the file lands.",
      ],
    },
  };

  // Event kind → [lucide icon, color]. classify = AI classification step.
  const EVI = {
    classify: ["sparkles", "var(--purple-500, #a855f7)"],
    inject:   ["zap",           "var(--grey-600)"],
    scan:     ["radar",         "var(--brand)"],
    fail:     ["alert-octagon", "var(--red-500)"],
    warn:     ["alert-triangle","var(--yellow-600)"],
    explain:  ["file-text",     "var(--navy-500)"],
  };
  const fmtT = (ms) => { const s = Math.round(ms / 1000); return `00:${String(s).padStart(2, "0")}`; };

  // ---- Simulation history strip ----
  const SimHistory = ({ connectionId }) => {
    const [history, setHistory] = React.useState([]);
    const [accuracy, setAccuracy] = React.useState(null);
    const [open, setOpen] = React.useState(false);
    useIcons();
    React.useEffect(() => {
      if (!open) return;
      if (window.DTApi?.getSimulationHistory) {
        window.DTApi.getSimulationHistory(connectionId)
          .then(rows => { if (rows && rows.length) setHistory(rows); })
          .catch(() => { console.warn('[SimHistory] getSimulationHistory failed'); });
      }
      if (window.DTApi?.getSimulationAccuracy) {
        window.DTApi.getSimulationAccuracy(connectionId)
          .then(data => { if (data) setAccuracy(data); })
          .catch(() => { console.warn('[SimHistory] getSimulationAccuracy failed'); });
      }
    }, [open, connectionId]);
    // Do not return null at module level — window.DTApi may not be defined on first render
    // (ES module deferred load). Always render the collapsible shell.

    const confColor = (c) => c == null ? 'var(--fg-3)' : c >= 0.8 ? '#22c55e' : c >= 0.6 ? '#f59e0b' : '#ef4444';

    return (
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
          <SectionTitle icon="history">Recent simulations</SectionTitle>
          <i data-lucide={open ? "chevron-up" : "chevron-down"} style={{ width: 16, height: 16, color: "var(--fg-3)" }}></i>
        </div>
        {open && (
          <div style={{ marginTop: 10 }}>
            {accuracy && accuracy.total_runs > 0 && (
              <div style={{ display: "flex", gap: 20, padding: "6px 0 12px", borderBottom: "1px solid var(--grey-100)", flexWrap: "wrap", marginBottom: 4 }}>
                <div style={{ fontSize: 11.5, color: "var(--fg-3)" }}>
                  <span style={{ fontWeight: 600, color: "var(--fg-1)" }}>{accuracy.total_runs}</span> runs ({accuracy.days}d)
                </div>
                {accuracy.mean_confidence != null && (
                  <div style={{ fontSize: 11.5, color: "var(--fg-3)" }}>
                    Avg confidence: <span style={{ fontWeight: 600, color: confColor(accuracy.mean_confidence) }}>{Math.round(accuracy.mean_confidence * 100)}%</span>
                  </div>
                )}
                {accuracy.low_confidence_rate != null && (
                  <div style={{ fontSize: 11.5, color: "var(--fg-3)" }}>
                    Low-conf: <span style={{ fontWeight: 600, color: accuracy.low_confidence_rate > 0.2 ? "#ef4444" : "var(--fg-2)" }}>{Math.round(accuracy.low_confidence_rate * 100)}%</span>
                  </div>
                )}
                {accuracy.real_metrics_rate != null && (
                  <div style={{ fontSize: 11.5, color: "var(--fg-3)" }}>
                    Grounded: <span style={{ fontWeight: 600, color: "var(--fg-2)" }}>{Math.round(accuracy.real_metrics_rate * 100)}%</span>
                  </div>
                )}
              </div>
            )}
            {history.length === 0
              ? <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "8px 0" }}>No simulations run yet.</div>
              : history.slice(0, 5).map((r, i) => (
                <div key={r.run_id || i} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--grey-100)" : "none", alignItems: "center" }}>
                  <Chip intent={r.status === "remediated" ? "success" : r.status === "completed" ? "brand" : "neutral"} size="sm">{r.status}</Chip>
                  {r.confidence != null && (
                    <span style={{ fontSize: 11, color: confColor(r.confidence), fontWeight: 600, flexShrink: 0 }}>{Math.round(r.confidence * 100)}%</span>
                  )}
                  <div style={{ flex: 1, fontSize: 12.5, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.scenario_text}</div>
                  <Mono style={{ fontSize: 11, color: "var(--fg-3)", flexShrink: 0 }}>{r.started_at ? r.started_at.slice(0, 16).replace("T", " ") : "—"}</Mono>
                </div>
              ))}
          </div>
        )}
      </Card>
    );
  };

  const Simulator = () => {
    const { go, setTrustScore, setPipeline, trustScore, activeConnectionId } = useApp();
    const [text, setText] = React.useState("What if the Northeast region stops sending order data entirely?");
    const [scenarios, setScenarios] = React.useState([]);

    React.useEffect(() => {
      if (!window.DTApi?.listScenarios) return;
      window.DTApi.listScenarios()
        .then(rows => { if (rows && rows.length) setScenarios(rows); })
        .catch(() => { console.warn('[Simulator] listScenarios API failed'); });
    }, []);

    // Sync the header/before-score to the real current trust score — without this,
    // navigating here directly (skipping Home/DQ Execution) leaves the stale useState(69)
    // default as the simulation's "before" baseline instead of the connection's real score.
    React.useEffect(() => {
      if (!window.DTApi?.getDashboardSummary) return;
      window.DTApi.getDashboardSummary(activeConnectionId)
        .then(s => {
          if (!s) return;
          setTrustScore(Math.round(s.overall_score) || 0);
          if (s.pipeline_status) setPipeline(s.pipeline_status);
        })
        .catch(() => { console.warn('[Simulator] getDashboardSummary failed'); });
    }, [activeConnectionId]);

    const [phase, setPhase] = React.useState("idle"); // idle | classifying | reacting | done
    const [scn, setScn] = React.useState(null);
    const [runId, setRunId] = React.useState(null);
    const [events, setEvents] = React.useState([]);
    const [healed, setHealed] = React.useState(false);
    const [healTarget, setHealTarget] = React.useState(null);
    const timers = React.useRef([]);
    const abortRef = React.useRef(null);
    useIcons();

    const clearTimers = () => { timers.current.forEach(t => { if (t && t.ci) clearInterval(t.ci); else if (t && t.raf) cancelAnimationFrame(t.raf); else clearTimeout(t); }); timers.current = []; };
    React.useEffect(() => () => { clearTimers(); abortRef.current?.(); }, []);

    const injectLocal = (s) => {
      s.events.forEach((e, i) => {
        timers.current.push(setTimeout(() => {
          setEvents(prev => [...prev, e]);
          if (e.kind === "fail" || e.kind === "warn") setTrustScore(ts => Math.max(s.drop, ts - 5));
          if (i === s.events.length - 1) { setTrustScore(s.drop); setTimeout(() => setPhase("done"), 400); }
        }, e.at + 300));
      });
    };

    const inject = () => {
      if (!text.trim()) return;
      clearTimers();
      abortRef.current?.();
      setEvents([]); setHealed(false); setRunId(null);
      setPhase("classifying"); // show AI classifying state immediately
      setPipeline("ISSUES");

      if (window.DTApi?.streamSimulation) {
        // Use a ref-like object so onEvent/onDone closures always see the latest drop value
        // even when SSE event frames arrive before the meta frame.
        const dropRef = { current: 52 };
        abortRef.current = window.DTApi.streamSimulation({
          scenarioText: text,
          connectionId: activeConnectionId,
          onMeta: (meta) => {
            dropRef.current = meta.drop;
            if (meta.run_id) setRunId(meta.run_id);
            setScn({
              type: meta.scenario_type, drop: meta.drop, undercount: meta.undercount,
              inject: meta.inject_sql, title: meta.title, body: meta.body || [],
              confidence: meta.confidence,
              compound: meta.compound,
              events: [],
            });
            setPhase("reacting");
          },
          onEvent: (e) => {
            setEvents(prev => [...prev, e]);
            if (e.kind === "fail" || e.kind === "warn") setTrustScore(ts => Math.max(dropRef.current, ts - 5));
          },
          onNarrative: (d) => {
            if (!d) return;
            // Prefer structured bullets array (P3); fall back to parsing text lines.
            const bullets = (d.bullets && d.bullets.length > 0)
              ? d.bullets
              : (d.text
                ? d.text.split('\n').map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(l => l.length > 0)
                : []);
            if (bullets.length > 0) {
              setScn(s => s ? { ...s, body: bullets } : s);
            }
          },
          onDone: () => { setTrustScore(dropRef.current); setTimeout(() => setPhase("done"), 400); },
          onError: () => {
            // Backend unreachable — show the closest preset with a demo-mode flag.
            const s = { ..._demoPreset(text), demoMode: true };
            setScn(s);
            setPhase("reacting");
            injectLocal(s);
          },
        });
      } else {
        // No streamSimulation API — full demo mode (no backend running).
        const s = { ..._demoPreset(text), demoMode: true };
        setScn(s);
        setPhase("reacting");
        injectLocal(s);
      }
    };

    const reset = () => {
      clearTimers(); abortRef.current?.();
      setPhase("idle"); setScn(null); setEvents([]); setHealed(false);
      setRunId(null); setHealTarget(null); setTrustScore(69); setPipeline("ISSUES");
    };

    const heal = async () => {
      if (!scn) return;
      setHealed(true); setPipeline("RECOVERING");
      // Await backend remediation to get the real computed recovery score.
      let to = 88;
      let remediationFailed = false;
      if (runId && window.DTApi?.remediateSimulation) {
        try {
          const res = await window.DTApi.remediateSimulation(runId, activeConnectionId);
          if (res && typeof res.trust_score === 'number') to = res.trust_score;
        } catch (_) {
          remediationFailed = true;
          toast("Remediation API failed — trust score estimate only", { kind: "warning" });
        }
      }
      setHealTarget(to);
      const from = scn.drop ?? trustScore, dur = 1300, t0 = Date.now();
      const id = setInterval(() => {
        const p = Math.min((Date.now() - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setTrustScore(Math.round(from + (to - from) * eased));
        if (p >= 1) { clearInterval(id); setPipeline("HEALTHY"); }
      }, 33);
      timers.current.push({ ci: id });
      if (!remediationFailed) {
        toast("Remediation applied · pipeline re-running · trust score recovering", { kind: "success" });
      }
    };

    const alertColor = scn && (scn.type === "Segment loss" || scn.type === "Column NULL" || scn.type === "Volume drop") ? "var(--red-500)" : "var(--orange-500)";

    return (
      <div className="dt-fade-up">
        {/* Header banner */}
        <Card style={{ marginBottom: 16, background: "linear-gradient(135deg, var(--grey-900), var(--navy-700))", border: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 42, height: 42, borderRadius: 11, background: "rgba(255,255,255,.12)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <i data-lucide="clapperboard" style={{ width: 22, height: 22, color: "#fff" }}></i>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 18, color: "#fff" }}>Live Scenario Simulator</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,.7)", marginTop: 2 }}>Give the system any scenario. AI classifies, injects, detects, and explains — live, in under 90 seconds.</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {activeConnectionId && <Chip intent="success" size="sm" dot>Connection active</Chip>}
              <Chip intent="warning" variant="fill" dot>Must-have demo</Chip>
            </div>
          </div>
        </Card>

        {/* No-connection warning */}
        {!activeConnectionId && (
          <Card style={{ marginBottom: 16, background: "var(--yellow-50)", border: "1px solid var(--yellow-200)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: "var(--yellow-800)" }}>
              <i data-lucide="alert-triangle" style={{ width: 16, height: 16, flexShrink: 0 }}></i>
              <span>No active connection — simulation will run in demo mode. Anomaly records require an active data connection.</span>
            </div>
          </Card>
        )}

        {/* Input */}
        <Card style={{ marginBottom: 16 }}>
          <Eyebrow style={{ marginBottom: 10 }}>Reviewer scenario</Eyebrow>
          <div style={{ display: "flex", gap: 10 }}>
            <Input icon="message-square" value={text} onChange={setText} placeholder="Describe any data issue in plain English…" style={{ flex: 1 }}
              onKeyDown={(e) => { if (e.key === "Enter" && phase !== "reacting" && phase !== "classifying") inject(); }} />
            <Button variant="primary" icon="zap" disabled={phase === "reacting" || phase === "classifying"} onClick={inject}>
              {phase === "classifying" ? "Classifying…" : "Inject scenario"}
            </Button>
          </div>
          {/* Quick-pick chips — use s.title for setting text, s.scenario_type as label */}
          {scenarios.length > 0 && (
            <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap" }}>
              {scenarios.map((s, i) => {
                const label = s.scenario_type || s.type || "Scenario";
                const question = s.title || s.description || label;
                return (
                  <button key={i} title={question}
                    onClick={() => setText(question)}
                    style={{ fontSize: 11.5, color: "var(--brand)", background: "var(--blue-50)", border: "1px solid var(--blue-200)", borderRadius: 999, padding: "4px 11px", cursor: "pointer" }}>
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* AI classifying state (before meta arrives) */}
        {phase === "classifying" && !scn && (
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0" }}>
              <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--purple-50, #faf5ff)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <i data-lucide="sparkles" style={{ width: 16, height: 16, color: "var(--purple-500, #a855f7)" }} className="dt-pulse"></i>
              </span>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--fg-1)" }}>AI is analyzing your scenario…</div>
                <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 2 }}>LLM classifying intent — identifying scenario type</div>
              </div>
            </div>
          </Card>
        )}

        {/* Reaction timeline */}
        {scn && (
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <SectionTitle icon="activity" right={
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Chip intent={scn.demoMode ? "neutral" : "brand"} dot>Classified: {scn.type}</Chip>
                  {scn.demoMode && (
                    <Chip intent="warning" title="Backend unavailable — showing nearest preset, no AI classification">Demo mode</Chip>
                  )}
                  {!scn.demoMode && scn.confidence !== undefined && scn.confidence < 0.80 && (
                    <Chip intent="warning" title="Classification confidence below 80% — result may be approximate">
                      {Math.round(scn.confidence * 100)}% confidence
                    </Chip>
                  )}
                  {scn.compound && (
                    <Chip intent="neutral" title="Multiple issue types detected in this scenario">compound</Chip>
                  )}
                </div>
              }>Live system reaction</SectionTitle>
            </div>
            <Mono style={{ display: "block", background: "var(--grey-900)", color: "var(--green-300)", padding: "10px 12px", borderRadius: 8, fontSize: 11.5, marginBottom: 16, overflowX: "auto" }}>$ {scn.inject}</Mono>

            <div style={{ position: "relative" }}>
              {events.map((e, i) => {
                const [icon, color] = EVI[e.kind] || ["activity", "var(--fg-2)"];
                const isLast = i === events.length - 1 && phase === "reacting";
                const titleColor = e.kind === "fail" ? "var(--red-500)" : e.kind === "warn" ? "var(--yellow-700)" : e.kind === "classify" ? "var(--purple-600, #7c3aed)" : "var(--fg-1)";
                return (
                  <div key={i} className="dt-fade-up" style={{ display: "flex", gap: 12, paddingBottom: 16, position: "relative" }}>
                    {(phase === "reacting" || i < events.length - 1) && <span style={{ position: "absolute", left: 15, top: 30, bottom: 0, width: 2, background: "var(--grey-100)" }}></span>}
                    <span style={{ width: 32, height: 32, borderRadius: "50%", background: color + "18", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, zIndex: 1 }}>
                      <i data-lucide={icon} style={{ width: 16, height: 16, color }} className={isLast ? "dt-pulse" : ""}></i>
                    </span>
                    <div style={{ flex: 1, paddingTop: 2 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Mono style={{ fontSize: 11, color: "var(--fg-3)" }}>⏱ {fmtT(e.at)}</Mono>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: titleColor }}>{e.title}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 2 }}>{e.detail}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Business explanation card — shows after simulation completes */}
            {phase === "done" && (
              <div className="dt-fade-up" style={{ marginTop: 6, border: `1.5px solid ${alertColor}33`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ background: alertColor, color: "#fff", padding: "12px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                  <i data-lucide="file-text" style={{ width: 16, height: 16 }}></i>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{scn.title}</span>
                  <Chip size="sm" style={{ marginLeft: "auto", background: "rgba(255,255,255,.2)", color: "#fff", border: "none" }}>AI-generated</Chip>
                </div>
                <div style={{ padding: 16 }}>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--fg-1)", lineHeight: 1.7 }}>
                    {(scn.body || []).map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Recovery / actions panel */}
        {phase === "done" && (
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 30, color: scoreColor(trustScore), transition: "color 200ms" }}>{trustScore}</div>
                  <div style={{ fontSize: 10, color: "var(--fg-3)" }}>trust score</div>
                </div>
                {healed && <i data-lucide="arrow-right" style={{ width: 18, height: 18, color: "var(--fg-3)" }}></i>}
                {healed && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 30, color: "var(--green-500)" }}>{healTarget ?? trustScore}</div>
                    <div style={{ fontSize: 10, color: "var(--fg-3)" }}>after fix</div>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 200, fontSize: 13, color: "var(--fg-2)" }}>
                {healed
                  ? "Closed loop: the system detected, explained, and recovered. Trust score healing in real time."
                  : "Detected and explained. Now close the loop — apply remediation and watch the trust score heal."}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {!healed && <Button variant="primary" icon="wrench" onClick={heal}>Apply remediation</Button>}
                {healed && <Button variant="outline" icon="inbox" onClick={() => go("anomalies")}>View anomaly inbox</Button>}
                {healed && <Button variant="outline" icon="network" onClick={() => go("impact")}>View impact graph</Button>}
                <Button variant="soft" icon="rotate-ccw" onClick={reset}>Reset to clean state</Button>
              </div>
            </div>
          </Card>
        )}

        {/* Simulation history (collapsible) */}
        <SimHistory connectionId={activeConnectionId} />
      </div>
    );
  };

  // ---------------- Task Board ----------------
  const PR = { CRITICAL: "var(--red-500)", HIGH: "var(--orange-500)", MEDIUM: "var(--yellow-500)", LOW: "var(--green-500)" };
  const Tasks = () => {
    const { taskList, setTaskList, activeConnectionId } = useApp();
    const [adding, setAdding] = React.useState(false);
    const [draft, setDraft] = React.useState("");
    const ownerName = (() => { try { return JSON.parse(sessionStorage.getItem('dt_user') || '{}').name || 'User'; } catch(_) { return 'User'; } })();
    useIcons();

    React.useEffect(() => {
      if (!window.DTApi) return;
      window.DTApi.listTasks(activeConnectionId)
        .then(rows => {
          if (!rows) return;
          setTaskList(rows.map(r => ({
            id: r.task_id,
            prio: r.priority || "MEDIUM",
            title: r.title,
            meta: `${r.phase ? r.phase + " · " : ""}${r.owner ? r.owner : ""}`,
            owner: r.owner || r.created_by || "System",
            status: (r.status || "OPEN").toUpperCase().replace("IN_PROGRESS", "IN PROGRESS"),
          })));
        })
        .catch(() => { console.warn('[Tasks] listTasks API failed'); });
    }, [activeConnectionId]);

    const addTask = () => {
      if (!draft) return;
      const newTask = { prio: "MEDIUM", title: draft, meta: `Added by ${ownerName} · just now`, owner: ownerName, status: "OPEN" };
      setTaskList(t => [newTask, ...t]);
      setDraft(""); setAdding(false);
      toast("Task added", { kind: "success" });
      if (window.DTApi) {
        window.DTApi.createTask({ title: draft, priority: "MEDIUM", connection_id: activeConnectionId, owner: ownerName }).catch(() => {
          toast("Failed to save task", { kind: "error" });
          // Roll back the optimistic add
          setTaskList(t => t.filter(item => item.title !== draft || item.meta !== newTask.meta));
        });
      }
    };

    const stChip = (s) => s === "DONE" ? <Chip intent="success" size="sm" icon="check">Done</Chip>
      : s === "IN PROGRESS" ? <Chip intent="brand" size="sm" dot>In progress</Chip>
      : s === "BACKLOG" ? <Chip intent="neutral" size="sm">Backlog</Chip>
      : <Chip intent="warning" size="sm">Open</Chip>;
    return (
      <div className="dt-fade-up">
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="list-checks" sub="Any human can inject a task, note, or override at any point in any phase — the persistent human-in-the-loop layer."
            right={<Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(a => !a)}>Add task</Button>}>Human task board</SectionTitle>
          {adding && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Input placeholder="Describe the task…" value={draft} onChange={setDraft} style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") addTask(); }} />
              <Button variant="primary" onClick={addTask}>Add</Button>
            </div>
          )}
        </Card>
        <Card pad={0} style={{ overflow: "hidden" }}>
          {taskList.map((t, i) => (
            <div key={t.id || i} className="dt-row-hover" style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderTop: i ? "1px solid var(--grey-100)" : "none" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: PR[t.prio], flexShrink: 0 }}></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: t.status === "DONE" ? "var(--fg-3)" : "var(--fg-1)", textDecoration: t.status === "DONE" ? "line-through" : "none" }}>{t.title}</div>
                <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2 }}>{t.meta}</div>
              </div>
              <Avatar name={t.owner.replace(" → ", " ")} size={26} color={["blue","purple","green","orange"][t.owner.charCodeAt(0) % 4]} />
              <span style={{ fontSize: 12, color: "var(--fg-2)", width: 96 }}>{t.owner}</span>
              {stChip(t.status)}
            </div>
          ))}
        </Card>
      </div>
    );
  };

  // ---------------- Daily Summary ----------------
  const Summary = () => {
    const { go, activeConnectionId, activeConnectionName } = useApp();
    const [summary, setSummary] = React.useState(null);
    const [anomalies, setAnomalies] = React.useState([]);
    const [auditTrail, setAuditTrail] = React.useState([]);
    const [advisory, setAdvisory] = React.useState(null);
    const [cdeRows, setCdeRows] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(null);
    useIcons();

    React.useEffect(() => {
      if (!window.DTApi) { setLoading(false); return; }
      setLoading(true);
      setError(null);
      setSummary(null); setAnomalies([]); setAuditTrail([]); setAdvisory(null); setCdeRows([]);
      Promise.all([
        window.DTApi.getDashboardSummary(activeConnectionId),
        window.DTApi.getAnomalyInbox(activeConnectionId).catch(() => []),
        window.DTApi.getAuditTrail(activeConnectionId, 10).catch(() => []),
        window.DTApi.getAdvisory(activeConnectionId).catch(() => null),
        activeConnectionId ? window.DTApi.listCDEs(activeConnectionId).catch(() => []) : Promise.resolve([]),
      ]).then(([sum, anoms, audit, adv, cdes]) => {
        setSummary(sum);
        setAnomalies(anoms || []);
        setAuditTrail(audit || []);
        setAdvisory(adv);
        setCdeRows((cdes || []).map(r => ({ name: r.column_name, status: r.health || "PASS" })));
        setLoading(false);
      }).catch(err => {
        setError(err?.message || "Failed to load summary");
        setLoading(false);
      });
    }, [activeConnectionId]);

    const todayStr = new Date().toISOString().slice(0, 10);
    const connectionLabel = activeConnectionName || "Demo";
    const score = Math.round(summary?.overall_score ?? 0);
    const delta = summary?.score_delta ?? 0;
    const pipelineStatus = summary?.pipeline_status || "HEALTHY";
    const generatedAt = summary?.last_run_at
      ? new Date(summary.last_run_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const topIssues = [...anomalies]
      .sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9))
      .slice(0, 5)
      .map(a => [
        (a.description || "").replace(/^\[SIM\]\s*/, ""),
        a.table_fqn || "—",
        a.severity || "MEDIUM",
        a.status === "open" ? "Open" : "Acknowledged",
      ]);

    const decisions = auditTrail
      .filter(r => r.action && r.entity)
      .map(r => `${r.action} · ${r.entity}`);

    const anomalyBreakdown = (summary?.anomaly_breakdown || []).slice(0, 4);

    const recommendations = [
      ...(advisory?.risk_reasons || []).map(r => r.text).filter(Boolean),
      advisory?.recommendation && advisory.recommendation !== "No advisory available yet."
        ? advisory.recommendation : null,
    ].filter(Boolean).slice(0, 5);

    const pipelineChipIntent = pipelineStatus === "HEALTHY" ? "success" : pipelineStatus === "ISSUES" ? "danger" : "warning";
    const pipelineLabel = pipelineStatus === "HEALTHY" ? "Pipeline healthy" : pipelineStatus === "ISSUES" ? "Pipeline issues" : "Pipeline recovering";

    if (loading) return (
      <div className="dt-fade-up">
        <Card style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-3)", fontSize: 13 }}>
          {/* Plain CSS spinner (not a lucide data-lucide icon): lucide.createIcons() replaces
              <i data-lucide> nodes outside React's control, and when this loading tree is
              discarded on data arrival, React's own unmount can throw removeChild errors. */}
          <span style={{ width: 14, height: 14, marginRight: 8, borderRadius: "50%", display: "inline-block", border: "2px solid var(--grey-200)", borderTopColor: "var(--fg-3)" }} className="dt-spin"></span>Loading daily summary…
        </Card>
      </div>
    );

    if (error) return (
      <div className="dt-fade-up">
        <Card style={{ background: "var(--red-50)", border: "1px solid var(--red-200)", fontSize: 13, color: "var(--red-700)", display: "flex", gap: 10, alignItems: "center" }}>
          <i data-lucide="alert-circle" style={{ width: 16, height: 16 }}></i>
          Failed to load summary: {error}
        </Card>
      </div>
    );

    return (
      <div className="dt-fade-up">
        <Card style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <ScoreRing score={score} size={104} stroke={10} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <Eyebrow>Data trust daily summary</Eyebrow>
            <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 19, margin: "6px 0 4px" }}>{connectionLabel} · {todayStr}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--fg-2)" }}>
              <span>Generated {generatedAt}</span><span>·</span>
              <Chip intent={pipelineChipIntent} dot>{pipelineLabel}</Chip>
              {delta !== 0 && (
                <span style={{ color: delta >= 0 ? "var(--green-500)" : "var(--red-500)", fontWeight: 600 }}>
                  {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} vs yesterday
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="soft" icon="file-down">Export PDF</Button>
            <Button variant="soft" icon="share-2">Share</Button>
          </div>
        </Card>

        {topIssues.length > 0 && (
          <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px" }}><SectionTitle icon="alert-circle">Top issues</SectionTitle></div>
            {topIssues.map((iss, i) => (
              <div key={i} style={{ display: "flex", gap: 14, padding: "12px 20px", borderTop: "1px solid var(--grey-100)", alignItems: "center" }}>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, color: "var(--fg-3)", width: 16 }}>{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{iss[0]}</div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2 }}>{iss[1]}</div>
                </div>
                <Severity level={iss[2]} size="sm" />
                <Chip intent={iss[3] === "Open" ? "warning" : "neutral"} size="sm" dot={iss[3] === "Open"}>{iss[3]}</Chip>
              </div>
            ))}
          </Card>
        )}
        {topIssues.length === 0 && (
          <Card style={{ marginBottom: 16, fontSize: 13, color: "var(--fg-3)", display: "flex", gap: 8, alignItems: "center" }}>
            <i data-lucide="check-circle-2" style={{ width: 15, height: 15, color: "var(--green-500)" }}></i>
            No open issues for this connection.
          </Card>
        )}

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <Card style={{ flex: 1, minWidth: 280 }}>
            <SectionTitle icon="radar">Anomaly summary</SectionTitle>
            {anomalyBreakdown.length > 0 ? anomalyBreakdown.map(({ label, intent, count }, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: i < anomalyBreakdown.length - 1 ? "1px solid var(--grey-100)" : "none", alignItems: "center" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: intent === "danger" ? "var(--red-500)" : "var(--yellow-500)", flexShrink: 0 }}></span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</div></div>
                <Chip intent={intent === "danger" ? "danger" : "warning"} size="sm">{count}</Chip>
              </div>
            )) : (
              <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "8px 0" }}>No open anomalies.</div>
            )}
          </Card>
          {cdeRows.length > 0 && (
            <Card style={{ flex: 1, minWidth: 280 }}>
              <SectionTitle icon="shield-alert">CDE status</SectionTitle>
              {cdeRows.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < cdeRows.length - 1 ? "1px solid var(--grey-100)" : "none" }}>
                  <Mono style={{ flex: 1, fontWeight: 600 }}>{c.name}</Mono>
                  <Chip intent={c.status === "PASS" || c.status === "HEALTHY" ? "success" : c.status === "WARN" ? "warning" : "danger"} size="sm" dot>
                    {c.status === "HEALTHY" ? "PASS" : c.status}
                  </Chip>
                </div>
              ))}
            </Card>
          )}
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {decisions.length > 0 && (
            <Card style={{ flex: 1, minWidth: 280 }}>
              <SectionTitle icon="user-check" right={<Chip intent="brand">{decisions.length}</Chip>}>Human decisions today</SectionTitle>
              {decisions.map((d, i) => (
                <div key={i} style={{ display: "flex", gap: 9, padding: "7px 0", fontSize: 12.5, color: "var(--fg-1)" }}>
                  <i data-lucide="check-circle-2" style={{ width: 15, height: 15, color: "var(--green-500)", flexShrink: 0, marginTop: 1 }}></i>{d}
                </div>
              ))}
            </Card>
          )}
          {recommendations.length > 0 && (
            <Card style={{ flex: 1, minWidth: 280 }}>
              <SectionTitle icon="lightbulb">Recommended for tomorrow</SectionTitle>
              {recommendations.map((d, i) => (
                <div key={i} style={{ display: "flex", gap: 9, padding: "7px 0", fontSize: 12.5, color: "var(--fg-1)" }}>
                  <span style={{ fontWeight: 700, color: "var(--brand)", width: 14 }}>{i + 1}</span>{d}
                </div>
              ))}
            </Card>
          )}
          {decisions.length === 0 && recommendations.length === 0 && (
            <Card style={{ flex: 1, fontSize: 13, color: "var(--fg-3)" }}>No decisions or recommendations recorded yet.</Card>
          )}
        </div>
      </div>
    );
  };

  window.DTScreens.simulator = Simulator;
  window.DTScreens.tasks = Tasks;
  window.DTScreens.summary = Summary;
})();
