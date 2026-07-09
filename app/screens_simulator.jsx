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

  // Mini blast-radius diagram: BFS downstream from the scenario's grounded REAL
  // table over the connection's actual lineage edges. Renders nothing when the
  // table has no traced downstream — never decorative, always real data.
  const SimBlastRadius = ({ connectionId, tableFqn }) => {
    const [graph, setGraph] = React.useState(null);
    React.useEffect(() => {
      let alive = true;
      setGraph(null);
      if (!tableFqn || !window.DTApi?.getLineage) return;
      window.DTApi.getLineage(tableFqn, connectionId)
        .then(g => { if (alive) setGraph(g); })
        .catch(() => { if (alive) setGraph(null); });
      return () => { alive = false; };
    }, [connectionId, tableFqn]);

    if (!graph || !graph.nodes || !graph.nodes.length) return null;
    const byId = {};
    graph.nodes.forEach(n => { byId[n.external_id] = n; });
    if (!byId[tableFqn]) return null;
    const adj = {};
    (graph.edges || []).forEach(e => { (adj[e.source_ext_id] = adj[e.source_ext_id] || []).push(e.target_ext_id); });

    const hops = [[tableFqn]];
    const seen = new Set([tableFqn]);
    for (let h = 0; h < 3; h++) {
      const next = [];
      hops[h].forEach(id => (adj[id] || []).forEach(t => { if (!seen.has(t)) { seen.add(t); next.push(t); } }));
      if (!next.length) break;
      hops.push(next);
    }
    if (hops.length === 1) return null;

    const totalDown = seen.size - 1;
    const reportCnt = [...seen].filter(id => id !== tableFqn && byId[id] && byId[id].node_type === "report").length;

    const CAP = 5, COL_W = 240, NODE_W = 200, NODE_H = 30, ROW_H = 40, PAD = 10;
    const pos = {};
    hops.forEach((ids, h) => {
      ids.slice(0, CAP).forEach((id, i) => { pos[id] = { x: PAD + h * COL_W, y: PAD + i * ROW_H, hop: h }; });
    });
    const rows = Math.max(...hops.map(hl => Math.min(hl.length, CAP))) + (hops.some(hl => hl.length > CAP) ? 1 : 0);
    const width = PAD * 2 + (hops.length - 1) * COL_W + NODE_W;
    const height = PAD * 2 + rows * ROW_H;
    const hopStroke = h => h === 0 ? "var(--red-500)" : h === 1 ? "var(--orange-500)" : "var(--yellow-600)";
    const hopFill = h => h === 0 ? "rgba(239,68,68,.08)" : h === 1 ? "rgba(249,115,22,.07)" : "rgba(202,138,4,.06)";
    const short = (id) => {
      const n = byId[id];
      const label = (n && n.label) || id;
      return label.length > 26 ? label.slice(0, 25) + "…" : label;
    };
    const drawEdges = (graph.edges || []).filter(e => pos[e.source_ext_id] && pos[e.target_ext_id] && pos[e.target_ext_id].hop === pos[e.source_ext_id].hop + 1);

    return (
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: .5, color: "var(--fg-3)", textTransform: "uppercase", marginBottom: 6 }}>
          Blast radius — {totalDown} downstream object{totalDown === 1 ? "" : "s"} fed by {tableFqn}{reportCnt ? ` (including ${reportCnt} report${reportCnt === 1 ? "" : "s"})` : ""}
        </div>
        <div style={{ overflowX: "auto", border: "1px solid var(--grey-100)", borderRadius: 10, background: "var(--grey-25, #fcfcfd)" }}>
          <svg width={width} height={height} style={{ display: "block" }}>
            <defs>
              <marker id="sim-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--grey-300)" />
              </marker>
            </defs>
            {drawEdges.map(e => {
              const s = pos[e.source_ext_id], t = pos[e.target_ext_id];
              return <line key={e.edge_id} x1={s.x + NODE_W} y1={s.y + NODE_H / 2} x2={t.x - 3} y2={t.y + NODE_H / 2}
                stroke="var(--grey-300)" strokeWidth="1.4" markerEnd="url(#sim-arrow)" />;
            })}
            {Object.entries(pos).map(([id, p]) => {
              const n = byId[id] || {};
              const isReport = n.node_type === "report";
              return (
                <g key={id}>
                  <rect x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx="15"
                    fill={hopFill(p.hop)} stroke={hopStroke(p.hop)} strokeWidth={p.hop === 0 ? 1.6 : 1.1}
                    strokeDasharray={isReport ? "4 3" : "none"} />
                  <text x={p.x + 12} y={p.y + NODE_H / 2 + 4} fontSize="11.5" fontWeight={p.hop === 0 ? 700 : 500} fill="var(--fg-1)">
                    {isReport ? "📊 " : ""}{short(id)}
                    <title>{(byId[id] && byId[id].label) || id} · {(byId[id] && byId[id].tier_label) || ""}</title>
                  </text>
                </g>
              );
            })}
            {hops.map((hl, h) => hl.length > CAP ? (
              <text key={`more-${h}`} x={PAD + h * COL_W + 12} y={PAD + CAP * ROW_H + 14} fontSize="11" fill="var(--fg-3)">
                +{hl.length - CAP} more…
              </text>
            ) : null)}
          </svg>
        </div>
        <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 5 }}>
          From your connection's real lineage · <span style={{ color: "var(--red-500)" }}>■</span> incident source · <span style={{ color: "var(--orange-500)" }}>■</span> directly fed · <span style={{ color: "var(--yellow-600)" }}>■</span> second hop · dashed = report/dashboard
        </div>
      </div>
    );
  };

  const Simulator = () => {
    const { setTrustScore, setPipeline, trustScore, activeConnectionId } = useApp();
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
    // Sandbox contract: the simulation runs entirely on a LOCAL copy of the
    // trust score. The real header score, pipeline status, inbox, and trust
    // history are never touched — simScore seeds from the real score when a
    // run starts and evaporates on reset.
    const [simScore, setSimScore] = React.useState(null);   // null = no drill running
    const [simStatus, setSimStatus] = React.useState(null); // ISSUES | RECOVERING | HEALTHY
    const [simBaseline, setSimBaseline] = React.useState(null); // pre-incident score, captured at run start
    const timers = React.useRef([]);
    const abortRef = React.useRef(null);
    useIcons();

    const clearTimers = () => { timers.current.forEach(t => { if (t && t.ci) clearInterval(t.ci); else if (t && t.raf) cancelAnimationFrame(t.raf); else clearTimeout(t); }); timers.current = []; };
    React.useEffect(() => () => { clearTimers(); abortRef.current?.(); }, []);

    const injectLocal = (s) => {
      s.events.forEach((e, i) => {
        timers.current.push(setTimeout(() => {
          setEvents(prev => [...prev, e]);
          if (e.kind === "fail" || e.kind === "warn") setSimScore(ts => Math.max(s.drop, (ts ?? 100) - 5));
          if (i === s.events.length - 1) { setSimScore(s.drop); setTimeout(() => setPhase("done"), 400); }
        }, e.at + 300));
      });
    };

    const inject = () => {
      if (!text.trim()) return;
      clearTimers();
      abortRef.current?.();
      setEvents([]); setHealed(false); setRunId(null); setHealTarget(null);
      setPhase("classifying"); // show AI classifying state immediately
      // Seed the LOCAL sandbox score from the real one; the real header score
      // and pipeline status are never modified by a simulation.
      setSimScore(trustScore); setSimBaseline(trustScore); setSimStatus("ISSUES");

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
              grounded: meta.grounded_table || null,
              events: [],
            });
            setPhase("reacting");
          },
          onEvent: (e) => {
            setEvents(prev => [...prev, e]);
            if (e.kind === "fail" || e.kind === "warn") setSimScore(ts => Math.max(dropRef.current, (ts ?? 100) - 5));
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
          onDone: () => { setSimScore(dropRef.current); setTimeout(() => setPhase("done"), 400); },
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
      setRunId(null); setHealTarget(null); setSimScore(null); setSimStatus(null); setSimBaseline(null);
    };

    const heal = () => {
      if (!scn) return;
      setHealed(true); setSimStatus("RECOVERING");
      // The honest recovery target: fixing the incident returns you to where you
      // were before it — the score captured when the run started. (The backend's
      // recovery number came from stale trust-history rows and produced nonsense
      // like "after fix: 9".) Remediate is still called fire-and-forget so the
      // run history records the drill as closed.
      if (runId && window.DTApi?.remediateSimulation) {
        window.DTApi.remediateSimulation(runId, activeConnectionId).catch(() => {});
      }
      const to = simBaseline ?? trustScore ?? 88;
      setHealTarget(to);
      const from = scn.drop ?? simScore ?? 52, dur = 1300, t0 = Date.now();
      const id = setInterval(() => {
        const p = Math.min((Date.now() - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setSimScore(Math.round(from + (to - from) * eased));
        if (p >= 1) { clearInterval(id); setSimStatus("HEALTHY"); }
      }, 33);
      timers.current.push({ ci: id });
    };

    // The drill closes itself out immediately: there is no real repair for a
    // human to perform in a simulation, so the moment results are on screen the
    // fix applies and the (local, simulated) score animates back up. The full
    // drop → recovery arc is still visible in the before/after display.
    const healRef = React.useRef(null);
    healRef.current = heal;
    React.useEffect(() => {
      if (phase === "done" && !healed && scn) healRef.current?.();
    }, [phase, healed]);

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
              <div style={{ fontSize: 13, color: "rgba(255,255,255,.7)", marginTop: 2 }}>
                A flight simulator for your data: describe something going wrong in plain English and watch, live, how the platform would catch and explain it.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {activeConnectionId && <Chip intent="success" size="sm" dot>Connection active</Chip>}
              <Chip intent="success" variant="fill" dot title="Simulations never modify your warehouse, trust scores, or Anomaly Inbox. The whole drill plays out on this screen only and vanishes on reset.">100% safe — nothing real is touched</Chip>
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

        {/* How it works — visible until the first run so a first-time user knows
             exactly what this screen does and that it is safe. */}
        {phase === "idle" && (
          <Card style={{ marginBottom: 16, background: "var(--grey-50)" }}>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
              {[
                ["1", "Describe a what-if", "Plain English — “What if the orders feed stops?”. Name a real table, column or region if you know one."],
                ["2", "AI identifies the failure type", "It reads your words and matches them to a known data-failure pattern, with a confidence score."],
                ["3", "Watch the incident play out", "A live timeline shows how detection would unfold: alerts firing, checks failing, teams notified."],
                ["4", "Get the impact and the fix", "A business-language summary grounded in your real tables — then the fix applies automatically and the simulated score recovers. Nothing real changes."],
              ].map(([n, title, sub]) => (
                <div key={n} style={{ flex: "1 1 200px", display: "flex", gap: 9 }}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--brand)", color: "#fff",
                    fontSize: 11.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n}</span>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-1)" }}>{title}</div>
                    <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2, lineHeight: 1.5 }}>{sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 6 }}>
              <i data-lucide="shield-check" style={{ width: 12, height: 12, color: "var(--green-600)" }}></i>
              Nothing here touches your real data, trust scores, or Anomaly Inbox — the entire incident plays out inside this screen only, and “Reset simulator” clears it.
            </div>
          </Card>
        )}

        {/* Input */}
        <Card style={{ marginBottom: 16 }}>
          <Eyebrow style={{ marginBottom: 10 }}>What should we pretend just went wrong?</Eyebrow>
          <div style={{ display: "flex", gap: 10 }}>
            <Input icon="message-square" value={text} onChange={setText} placeholder="e.g. What if the nightly orders feed loads only half of its rows?" style={{ flex: 1 }}
              onKeyDown={(e) => { if (e.key === "Enter" && phase !== "reacting" && phase !== "classifying") inject(); }} />
            <Button variant="primary" icon="zap" disabled={phase === "reacting" || phase === "classifying"} onClick={inject}>
              {phase === "classifying" ? "Analyzing…" : "Run simulation"}
            </Button>
          </div>
          {/* Quick-pick chips — use s.title for setting text, s.scenario_type as label */}
          {scenarios.length > 0 && (
            <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>Try one:</span>
              {scenarios.map((s, i) => {
                const label = s.scenario_type || s.type || "Scenario";
                const question = s.title || s.description || label;
                // The full plain-English question IS the label — a fresher can read
                // exactly what will be simulated instead of decoding taxonomy terms
                // like "Whitelist breach". The category rides along as a tooltip.
                const short = question.length > 52 ? question.slice(0, 50) + "…" : question;
                return (
                  <button key={i} title={`${label}: ${question}`}
                    onClick={() => setText(question)}
                    style={{ fontSize: 11.5, color: "var(--brand)", background: "var(--blue-50)", border: "1px solid var(--blue-200)", borderRadius: 999, padding: "4px 11px", cursor: "pointer" }}>
                    {short}
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
              }>Incident timeline — how detection would unfold</SectionTitle>
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
                <div style={{ background: alertColor, color: "#fff", padding: "12px 16px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <i data-lucide="file-text" style={{ width: 16, height: 16 }}></i>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>What this would mean for the business — {scn.title}</span>
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

        {/* Impact panel — score hit, the alerts the inbox would receive, and the
            real downstream blast radius. Simulated numbers only. */}
        {phase === "done" && (() => {
          const alerts = events.filter(e => e.kind === "fail" || e.kind === "warn");
          const failCnt = alerts.filter(e => e.kind === "fail").length;
          const warnCnt = alerts.length - failCnt;
          const first = alerts[0];
          const detectSec = first && typeof first.at === "number" ? Math.max(1, Math.round(first.at / 1000)) : null;
          const delta = (simBaseline != null && scn?.drop != null) ? simBaseline - scn.drop : null;
          return (
            <Card style={{ marginBottom: 16 }}>
              {/* Headline: the incident in one line */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                <i data-lucide="flag" style={{ width: 16, height: 16, color: "var(--red-500)" }}></i>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{scn?.title || "Incident"}</span>
                <span style={{ fontSize: 12.5, color: "var(--fg-2)" }}>
                  {detectSec ? `caught by automated checks in ~${detectSec}s · ` : ""}
                  {failCnt} critical alert{failCnt === 1 ? "" : "s"}{warnCnt ? ` and ${warnCnt} warning${warnCnt === 1 ? "" : "s"}` : ""} would land in the Anomaly Inbox
                </span>
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <span title="Everything on this panel exists only in this simulation. Your connection's real trust score, pipeline status, and Anomaly Inbox are untouched.">
                    <Chip size="sm" intent="neutral">simulated</Chip>
                  </span>
                  <Button size="sm" variant="soft" icon="rotate-ccw" onClick={reset}>Reset simulator</Button>
                </span>
              </div>

              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
                {/* Score hit — one healthy number (before = after fix), one incident number */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ textAlign: "center", padding: "12px 22px", borderRadius: 10, border: "1.5px solid var(--red-500)", background: "rgba(239,68,68,.05)" }}>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 32, color: "var(--red-500)" }}>{scn?.drop ?? "—"}</div>
                    <div style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 2 }}>trust score during incident</div>
                  </div>
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--fg-2)" }}>
                    {delta != null && <span style={{ fontWeight: 700, color: "var(--red-500)" }}>−{delta} pts</span>}
                    {" "}vs healthy <strong>{simBaseline ?? "—"}</strong>
                    <div style={{ fontSize: 10.5, color: "var(--fg-3)" }}>(same before &amp; after the fix)</div>
                  </div>
                </div>

                {/* The alerts, styled like inbox rows — this IS the insight: what your team would see */}
                <div style={{ flex: 1, minWidth: 280 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: .5, color: "var(--fg-3)", textTransform: "uppercase", marginBottom: 6 }}>
                    Alerts your team would see
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {alerts.map((e, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--grey-100)", background: e.kind === "fail" ? "rgba(239,68,68,.04)" : "rgba(202,138,4,.04)" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 5, flexShrink: 0, background: e.kind === "fail" ? "var(--red-500)" : "var(--yellow-500)" }}></span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: e.kind === "fail" ? "var(--red-600, var(--red-500))" : "var(--yellow-700)" }}>{e.title}</span>
                          <span style={{ fontSize: 12, color: "var(--fg-2)", marginLeft: 8 }}>{e.detail}</span>
                        </div>
                        <Mono style={{ fontSize: 10.5, color: "var(--fg-3)", flexShrink: 0 }}>{fmtT(e.at)}</Mono>
                      </div>
                    ))}
                    {alerts.length === 0 && <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>No alerts fired in this scenario's timeline.</div>}
                  </div>
                </div>
              </div>

              {/* Real downstream blast radius from this connection's lineage */}
              {scn?.grounded && <SimBlastRadius connectionId={activeConnectionId} tableFqn={scn.grounded} />}
            </Card>
          );
        })()}

        {/* Simulation history (collapsible) */}
        <SimHistory connectionId={activeConnectionId} />
      </div>
    );
  };

  // ---------------- Task Board ----------------
  const PR = { CRITICAL: "var(--red-500)", HIGH: "var(--orange-500)", MEDIUM: "var(--yellow-500)", LOW: "var(--green-500)" };
  const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const selStyle = { fontSize: 11.5, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--grey-200)", background: "var(--bg-1, #fff)", color: "var(--fg-1)", cursor: "pointer", outline: "none" };
  const Tasks = () => {
    const { go, taskList, setTaskList, activeConnectionId } = useApp();
    const [adding, setAdding] = React.useState(false);
    const [draft, setDraft] = React.useState("");
    const [draftPrio, setDraftPrio] = React.useState("MEDIUM");
    const [draftDue, setDraftDue] = React.useState("");
    const [filter, setFilter] = React.useState("active"); // active | open | in_progress | done | all
    const [editingOwner, setEditingOwner] = React.useState(null); // task id
    const [ownerDraft, setOwnerDraft] = React.useState("");
    const ownerName = (() => { try { return JSON.parse(sessionStorage.getItem('dt_user') || '{}').name || 'User'; } catch(_) { return 'User'; } })();
    useIcons();

    const mapRow = (r) => ({
      id: r.task_id,
      prio: r.priority || "MEDIUM",
      title: r.title,
      phase: r.phase,
      owner: r.owner || r.created_by || "System",
      status: (r.status || "open").toLowerCase(),
      due: r.due_date || null,
      relType: r.related_entity_type || null,
      relId: r.related_entity_id || null,
      createdAt: r.created_at,
    });

    const load = () => {
      if (!window.DTApi) return;
      window.DTApi.listTasks(activeConnectionId)
        .then(rows => { if (rows) setTaskList(rows.map(mapRow)); })
        .catch(() => { console.warn('[Tasks] listTasks API failed'); });
    };
    React.useEffect(load, [activeConnectionId]);

    const addTask = async () => {
      if (!draft.trim()) return;
      try {
        const created = await window.DTApi.createTask({
          title: draft.trim(), priority: draftPrio, connection_id: activeConnectionId,
          owner: ownerName, due_date: draftDue || null,
        });
        setTaskList(t => [mapRow(created), ...t]);
        setDraft(""); setDraftDue(""); setDraftPrio("MEDIUM"); setAdding(false);
        toast("Task added", { kind: "success" });
      } catch (_) {
        toast("Failed to save task", { kind: "error" });
      }
    };

    const patch = async (id, body, optimistic) => {
      setTaskList(t => t.map(x => x.id === id ? { ...x, ...optimistic } : x));
      try {
        const updated = await window.DTApi.updateTask(id, body);
        setTaskList(t => t.map(x => x.id === id ? mapRow(updated) : x));
      } catch (_) {
        toast("Update failed — reloading", { kind: "error" });
        load();
      }
    };

    const remove = async (t) => {
      if (!window.confirm(`Delete task "${t.title}"? This cannot be undone.`)) return;
      setTaskList(list => list.filter(x => x.id !== t.id));
      try {
        await window.DTApi.deleteTask(t.id);
        toast("Task deleted", { kind: "success" });
      } catch (_) {
        toast("Delete failed — reloading", { kind: "error" });
        load();
      }
    };

    const todayStr = new Date().toISOString().slice(0, 10);
    const isOverdue = (t) => t.due && t.status !== "done" && String(t.due).slice(0, 10) < todayStr;

    const visible = taskList.filter(t =>
      filter === "all" ? true :
      filter === "active" ? t.status !== "done" :
      t.status === filter);
    const counts = {
      active: taskList.filter(t => t.status !== "done").length,
      done: taskList.filter(t => t.status === "done").length,
    };

    // Status advances one step per click: open → in progress → done → (reopen)
    const nextStatus = { open: "in_progress", in_progress: "done", done: "open", backlog: "open" };
    const statusBtn = (t) => {
      const label = t.status === "open" ? "Start" : t.status === "in_progress" ? "Mark done" : "Reopen";
      const icon = t.status === "open" ? "play" : t.status === "in_progress" ? "check" : "rotate-ccw";
      return <Button size="sm" variant={t.status === "in_progress" ? "primary" : "outline"} icon={icon}
        onClick={() => patch(t.id, { status: nextStatus[t.status] || "open" }, { status: nextStatus[t.status] || "open" })}>{label}</Button>;
    };
    const stChip = (s) => s === "done" ? <Chip intent="success" size="sm" icon="check">Done</Chip>
      : s === "in_progress" ? <Chip intent="brand" size="sm" dot>In progress</Chip>
      : s === "backlog" ? <Chip intent="neutral" size="sm">Backlog</Chip>
      : <Chip intent="warning" size="sm">Open</Chip>;

    return (
      <div className="dt-fade-up">
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="list-checks" sub="Any human can inject a task, note, or override at any point in any phase — the persistent human-in-the-loop layer."
            right={<Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(a => !a)}>Add task</Button>}>Human task board</SectionTitle>
          {adding && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              <Input placeholder="Describe the task…" value={draft} onChange={setDraft} style={{ flex: 1, minWidth: 220 }} onKeyDown={(e) => { if (e.key === "Enter") addTask(); }} />
              <select value={draftPrio} onChange={e => setDraftPrio(e.target.value)} style={selStyle} title="Priority">
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <input type="date" value={draftDue} onChange={e => setDraftDue(e.target.value)} style={selStyle} title="Due date (optional)" />
              <Button variant="primary" onClick={addTask}>Add</Button>
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            {[["active", `Active (${counts.active})`], ["open", "Open"], ["in_progress", "In progress"], ["done", `Done (${counts.done})`], ["all", "All"]].map(([f, label]) => (
              <Button key={f} size="sm" variant={filter === f ? "primary" : "ghost"} onClick={() => setFilter(f)}>{label}</Button>
            ))}
          </div>
        </Card>
        <Card pad={0} style={{ overflow: "hidden" }}>
          {visible.map((t, i) => (
            <div key={t.id || i} className="dt-row-hover" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderTop: i ? "1px solid var(--grey-100)" : "none", background: isOverdue(t) ? "rgba(239,68,68,.03)" : "transparent" }}>
              <select value={t.prio} onChange={e => patch(t.id, { priority: e.target.value }, { prio: e.target.value })}
                style={{ ...selStyle, color: PR[t.prio], fontWeight: 700, border: `1px solid ${PR[t.prio]}44` }} title="Priority — change anytime">
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: t.status === "done" ? "var(--fg-3)" : "var(--fg-1)", textDecoration: t.status === "done" ? "line-through" : "none" }}>{t.title}</div>
                <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {t.phase && <span>{t.phase}</span>}
                  {t.due && (
                    <span style={{ color: isOverdue(t) ? "var(--red-500)" : "var(--fg-3)", fontWeight: isOverdue(t) ? 700 : 400 }}>
                      due {String(t.due).slice(0, 10)}{isOverdue(t) ? " · OVERDUE" : ""}
                    </span>
                  )}
                  {t.relType === "anomaly" && (
                    <button onClick={() => go("anomalies")} title="This task was created from an anomaly — open the inbox"
                      style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                      from anomaly →
                    </button>
                  )}
                  {t.relType === "profiling_risk" && (
                    <button onClick={() => go("profiling")} title="This task was created from a profiling risk — open Profiling"
                      style={{ fontSize: 11, fontWeight: 600, color: "var(--brand)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                      from profiling risk →
                    </button>
                  )}
                </div>
              </div>
              {editingOwner === t.id ? (
                <input autoFocus value={ownerDraft} onChange={e => setOwnerDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && ownerDraft.trim()) { patch(t.id, { owner: ownerDraft.trim() }, { owner: ownerDraft.trim() }); setEditingOwner(null); }
                    if (e.key === "Escape") setEditingOwner(null);
                  }}
                  onBlur={() => setEditingOwner(null)}
                  style={{ ...selStyle, width: 110 }} placeholder="New owner…" />
              ) : (
                <button onClick={() => { setEditingOwner(t.id); setOwnerDraft(t.owner); }} title="Click to reassign"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  <Avatar name={t.owner.replace(" → ", " ")} size={24} color={["blue","purple","green","orange"][t.owner.charCodeAt(0) % 4]} />
                  <span style={{ fontSize: 12, color: "var(--fg-2)", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.owner}</span>
                </button>
              )}
              {stChip(t.status)}
              {statusBtn(t)}
              <button onClick={() => remove(t)} title="Delete task"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--fg-3)", padding: 4, borderRadius: 6 }}
                onMouseEnter={e => e.currentTarget.style.color = "var(--red-500)"}
                onMouseLeave={e => e.currentTarget.style.color = "var(--fg-3)"}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          ))}
          {visible.length === 0 && (
            <div style={{ padding: "24px 20px", textAlign: "center", fontSize: 12.5, color: "var(--fg-3)" }}>
              {filter === "done" ? "Nothing completed yet." : "No tasks here — add one above, or create one from an anomaly in the inbox."}
            </div>
          )}
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
    const [narrative, setNarrative] = React.useState(null);      // {narrative, watch_items, generated_by}
    const [narrativeState, setNarrativeState] = React.useState("loading"); // loading | ready | error
    useIcons();

    const loadNarrative = (regen) => {
      if (!activeConnectionId || !window.DTApi?.getDailyNarrative) { setNarrativeState("error"); return; }
      setNarrativeState("loading");
      window.DTApi.getDailyNarrative(activeConnectionId, regen)
        .then(d => { setNarrative(d); setNarrativeState("ready"); })
        .catch(() => setNarrativeState("error"));
    };
    React.useEffect(() => { setNarrative(null); loadNarrative(false); }, [activeConnectionId]);

    React.useEffect(() => {
      if (!window.DTApi) { setLoading(false); return; }
      setLoading(true);
      setError(null);
      setSummary(null); setAnomalies([]); setAuditTrail([]); setAdvisory(null); setCdeRows([]);
      Promise.all([
        window.DTApi.getDashboardSummary(activeConnectionId),
        window.DTApi.getAnomalyInbox(activeConnectionId).catch(() => []),
        window.DTApi.getAuditTrail(activeConnectionId, 50).catch(() => []),
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

    // "Today" means today: the backend now returns each entry's ISO date, so the
    // label stops lying when the last activity was three days ago.
    const decisions = auditTrail
      .filter(r => r.action && r.entity && (!r.date || r.date === todayStr))
      .slice(0, 10)
      .map(r => `${r.time && r.time !== "—" ? r.time + " · " : ""}${r.action} · ${r.entity}`);

    const anomalyBreakdown = (summary?.anomaly_breakdown || []).slice(0, 4);

    // Recommendations: advisory first when one exists, then live-derived signals
    // (open criticals, failing layers, stale profiling, unprofiled layers) so this
    // section is never empty just because no advisory was generated.
    const liveRecs = [];
    const critCount = (summary?.open_critical || 0);
    if (critCount > 0) liveRecs.push(`Triage the ${critCount} critical rule failure${critCount === 1 ? "" : "s"} first thing — they block the trust score.`);
    const openAnoms = anomalies.filter(a => a.status === "open");
    if (openAnoms.length > 0) {
      const worst = [...openAnoms].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9))[0];
      liveRecs.push(`Review ${openAnoms.length} open anomal${openAnoms.length === 1 ? "y" : "ies"} in the inbox — start with ${worst.table_fqn || "the most severe"}.`);
    }
    (summary?.layers || []).forEach(l => {
      if (l.open_issues > 0) liveRecs.push(`Re-run DQ execution for ${l.layer} once its ${l.open_issues} failing rule${l.open_issues === 1 ? " is" : "s are"} addressed.`);
      if ((l.score || 0) === 0) liveRecs.push(`${l.layer} layer has never been profiled — add coverage so its health is measurable.`);
    });
    if (summary?.last_run_at) {
      const ageDays = Math.floor((Date.now() - new Date(summary.last_run_at)) / 86400000);
      if (ageDays >= 2) liveRecs.push(`Last run was ${ageDays} days ago — re-profile and re-execute to refresh today's scores.`);
    }
    const recommendations = [
      ...(advisory?.risk_reasons || []).map(r => r.text).filter(Boolean),
      advisory?.recommendation && advisory.recommendation !== "No advisory available yet."
        ? advisory.recommendation : null,
      ...liveRecs,
    ].filter(Boolean).slice(0, 5);

    const pipelineChipIntent = pipelineStatus === "HEALTHY" ? "success" : pipelineStatus === "ISSUES" ? "danger" : "warning";
    const pipelineLabel = pipelineStatus === "HEALTHY" ? "Pipeline healthy" : pipelineStatus === "ISSUES" ? "Pipeline issues" : "Pipeline recovering";

    const buildMarkdown = () => {
      const lines = [
        `# Data trust daily summary — ${connectionLabel} · ${todayStr}`,
        `Trust score: **${score}/100**${delta ? ` (${delta > 0 ? "+" : ""}${delta} vs yesterday)` : ""} · ${pipelineLabel}`,
        "",
      ];
      if (narrative?.narrative) {
        lines.push(narrative.narrative, "");
        if ((narrative.watch_items || []).length) {
          lines.push("**Watch tomorrow:**");
          narrative.watch_items.forEach(w => lines.push(`- ${w}`));
          lines.push("");
        }
      }
      if (topIssues.length) {
        lines.push("## Top issues");
        topIssues.forEach((iss, i) => lines.push(`${i + 1}. [${iss[2]}] ${iss[0]} — ${iss[1]} (${iss[3]})`));
        lines.push("");
      }
      if (anomalyBreakdown.length) {
        lines.push("## Open anomalies");
        anomalyBreakdown.forEach(a => lines.push(`- ${a.label}: ${a.count}`));
        lines.push("");
      }
      if (decisions.length) {
        lines.push("## Human decisions today");
        decisions.forEach(d => lines.push(`- ${d}`));
        lines.push("");
      }
      if (recommendations.length) {
        lines.push("## Recommended for tomorrow");
        recommendations.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
      }
      return lines.join("\n");
    };

    const shareSummary = async () => {
      const md = buildMarkdown();
      try {
        await navigator.clipboard.writeText(md);
        toast("Summary copied to clipboard — paste into Slack or email", { kind: "success" });
      } catch (_) {
        // Clipboard API blocked (http / permissions) — fall back to a download.
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
        a.download = `daily-summary-${todayStr}.md`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast("Clipboard unavailable — downloaded as markdown instead", { kind: "warning" });
      }
    };

    const exportPDF = () => {
      // Print-friendly document in a hidden iframe → browser print dialog →
      // "Save as PDF". No popups, no external libraries.
      const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const html = `<!doctype html><html><head><title>Daily summary — ${esc(connectionLabel)} — ${todayStr}</title>
        <style>body{font-family:Segoe UI,Arial,sans-serif;color:#1a202c;margin:40px;font-size:13px}
        h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:22px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
        .meta{color:#4a5568;margin-bottom:6px}.score{font-size:34px;font-weight:800}
        .sev{font-weight:700}.CRITICAL{color:#c53030}.HIGH{color:#dd6b20}.MEDIUM{color:#b7791f}.LOW{color:#2f855a}
        ol,ul{margin:6px 0;padding-left:22px}li{margin:4px 0}</style></head><body>
        <h1>Data trust daily summary</h1>
        <div class="meta">${esc(connectionLabel)} · ${todayStr} · generated ${esc(generatedAt)} · ${esc(pipelineLabel)}</div>
        <div class="score">${score}/100${delta ? ` <span style="font-size:14px;color:${delta > 0 ? "#2f855a" : "#c53030"}">(${delta > 0 ? "+" : ""}${delta} vs yesterday)</span>` : ""}</div>
        ${narrative?.narrative ? `<p style="margin-top:10px;line-height:1.6">${esc(narrative.narrative)}</p>` : ""}
        ${(narrative?.watch_items || []).length ? `<h2>Watch tomorrow</h2><ul>${narrative.watch_items.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
        ${topIssues.length ? `<h2>Top issues</h2><ol>${topIssues.map(iss => `<li><span class="sev ${esc(iss[2])}">[${esc(iss[2])}]</span> ${esc(iss[0])} — <code>${esc(iss[1])}</code> (${esc(iss[3])})</li>`).join("")}</ol>` : ""}
        ${anomalyBreakdown.length ? `<h2>Open anomalies</h2><ul>${anomalyBreakdown.map(a => `<li>${esc(a.label)}: <b>${a.count}</b></li>`).join("")}</ul>` : ""}
        ${decisions.length ? `<h2>Human decisions today</h2><ul>${decisions.map(d => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
        ${recommendations.length ? `<h2>Recommended for tomorrow</h2><ol>${recommendations.map(r => `<li>${esc(r)}</li>`).join("")}</ol>` : ""}
        </body></html>`;
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
      document.body.appendChild(frame);
      frame.contentDocument.open();
      frame.contentDocument.write(html);
      frame.contentDocument.close();
      setTimeout(() => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(() => frame.remove(), 2000);
      }, 150);
    };

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
            <Button variant="soft" icon="file-down" onClick={exportPDF} title="Opens the print dialog — choose 'Save as PDF'">Export PDF</Button>
            <Button variant="soft" icon="share-2" onClick={shareSummary} title="Copies the summary as markdown for Slack/email">Share</Button>
          </div>
        </Card>

        {/* Today in one paragraph — LLM-composed from today's measured facts, cached per day */}
        <Card style={{ marginBottom: 16, borderLeft: "3px solid var(--brand)" }}>
          <SectionTitle icon="sparkles"
            right={
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                {narrative?.generated_by && <Chip size="sm" intent={narrative.generated_by === "ai" ? "brand" : "neutral"}>{narrative.generated_by === "ai" ? "AI-written" : "auto"}</Chip>}
                <Button size="sm" variant="ghost" icon="refresh-cw" onClick={() => loadNarrative(true)} disabled={narrativeState === "loading"}>
                  {narrativeState === "loading" ? "Writing…" : "Rewrite"}
                </Button>
              </span>
            }>Today in one paragraph</SectionTitle>
          {narrativeState === "loading" && !narrative && (
            <div style={{ fontSize: 13, color: "var(--fg-3)", padding: "10px 0" }}>
              <span className="dt-spin" style={{ width: 12, height: 12, marginRight: 8, borderRadius: "50%", display: "inline-block", border: "2px solid var(--grey-200)", borderTopColor: "var(--fg-3)", verticalAlign: "-2px" }}></span>
              Reading today's runs, anomalies, and decisions…
            </div>
          )}
          {narrativeState === "error" && <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "8px 0" }}>Narrative unavailable — the structured sections below are still live.</div>}
          {narrative && (
            <>
              <div style={{ fontSize: 13.5, color: "var(--fg-1)", lineHeight: 1.65, marginTop: 8 }}>{narrative.narrative}</div>
              {(narrative.watch_items || []).length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--grey-200)" }}>
                  <Eyebrow style={{ marginBottom: 6 }}>Watch tomorrow</Eyebrow>
                  {narrative.watch_items.map((w, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", fontSize: 12.5, color: "var(--fg-1)" }}>
                      <i data-lucide="eye" style={{ width: 14, height: 14, color: "var(--brand)", flexShrink: 0, marginTop: 2 }}></i>{w}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
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
