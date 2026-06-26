// DataTrust — Screens: Live Scenario Simulator (hero) + Task Board + Daily Summary
(function () {
  const D = window.DT;

  // ---- Local classification fallback (mirrors backend _classify_regex) ----
  function classifyLocal(text) {
    const t = text.toLowerCase();
    if (t.includes("northeast") || (t.includes("region") && (t.includes("stop") || t.includes("entirely") || t.includes("loss") || t.includes("offline") || t.includes("down")))) return SCN.segment;
    if (t.includes("revenue") || (t.includes("not") && t.includes("load")) || t.includes("null") || t.includes("missing")) return SCN.nullcol;
    if (t.includes("drop") || t.includes("60%") || t.includes("overnight") || t.includes("volume") || t.includes("batch") || t.includes("warehouse")) return SCN.volume;
    if (t.includes("ghost") || t.includes("status") || t.includes("invalid") || t.includes("code") || t.includes("whitelist")) return SCN.whitelist;
    if (t.includes("crm") || t.includes("feed") || t.includes("arriv") || t.includes("source") || t.includes("file")) return SCN.source;
    return SCN.nullcol;
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
    const [open, setOpen] = React.useState(false);
    useIcons();
    React.useEffect(() => {
      if (!open || !window.DTApi?.getSimulationHistory) return;
      window.DTApi.getSimulationHistory(connectionId)
        .then(rows => { if (rows && rows.length) setHistory(rows); })
        .catch(() => {});
    }, [open, connectionId]);
    if (!window.DTApi?.getSimulationHistory) return null;
    return (
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
          <SectionTitle icon="history">Recent simulations</SectionTitle>
          <i data-lucide={open ? "chevron-up" : "chevron-down"} style={{ width: 16, height: 16, color: "var(--fg-3)" }}></i>
        </div>
        {open && (
          <div style={{ marginTop: 10 }}>
            {history.length === 0
              ? <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "8px 0" }}>No simulations run yet.</div>
              : history.slice(0, 5).map((r, i) => (
                <div key={r.run_id || i} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--grey-100)" : "none", alignItems: "center" }}>
                  <Chip intent={r.status === "remediated" ? "success" : r.status === "completed" ? "brand" : "neutral"} size="sm">{r.status}</Chip>
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
        .catch(() => {});
    }, []);

    const [phase, setPhase] = React.useState("idle"); // idle | classifying | reacting | done
    const [scn, setScn] = React.useState(null);
    const [runId, setRunId] = React.useState(null);
    const [events, setEvents] = React.useState([]);
    const [healed, setHealed] = React.useState(false);
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
        let drop = 52;
        abortRef.current = window.DTApi.streamSimulation({
          scenarioText: text,
          connectionId: activeConnectionId,
          onMeta: (meta) => {
            drop = meta.drop;
            if (meta.run_id) setRunId(meta.run_id);
            setScn({
              type: meta.scenario_type, drop: meta.drop, undercount: meta.undercount,
              inject: meta.inject_sql, title: meta.title, body: meta.body,
              events: [],
            });
            setPhase("reacting");
          },
          onEvent: (e) => {
            setEvents(prev => [...prev, e]);
            if (e.kind === "fail" || e.kind === "warn") setTrustScore(ts => Math.max(drop, ts - 5));
          },
          onNarrative: (d) => {
            if (!d || !d.text) return;
            // Parse "- bullet" lines into array; keep existing body as fallback
            const lines = d.text.split('\n')
              .map(l => l.replace(/^[-•*]\s*/, '').trim())
              .filter(l => l.length > 0);
            if (lines.length > 0) {
              setScn(s => s ? { ...s, body: lines } : s);
            }
          },
          onDone: () => { setTrustScore(drop); setTimeout(() => setPhase("done"), 400); },
          onError: () => {
            const s = classifyLocal(text);
            setScn(s);
            setPhase("reacting");
            injectLocal(s);
          },
        });
      } else {
        const s = classifyLocal(text);
        setScn(s);
        setPhase("reacting");
        injectLocal(s);
      }
    };

    const reset = () => {
      clearTimers(); abortRef.current?.();
      setPhase("idle"); setScn(null); setEvents([]); setHealed(false);
      setRunId(null); setTrustScore(69); setPipeline("ISSUES");
    };

    const heal = () => {
      if (!scn) return;
      setHealed(true); setPipeline("RECOVERING");
      // Call backend remediation (fire-and-forget)
      if (runId && window.DTApi?.remediateSimulation) {
        window.DTApi.remediateSimulation(runId, activeConnectionId).catch(() => {});
      }
      const from = scn.drop ?? trustScore, to = 91, dur = 1300, t0 = Date.now();
      const id = setInterval(() => {
        const p = Math.min((Date.now() - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setTrustScore(Math.round(from + (to - from) * eased));
        if (p >= 1) { clearInterval(id); setPipeline("HEALTHY"); }
      }, 33);
      timers.current.push({ ci: id });
      toast("Remediation applied · pipeline re-running · trust score recovering", { kind: "success" });
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
              <SectionTitle icon="activity" right={<Chip intent="brand" dot>Classified: {scn.type}</Chip>}>Live system reaction</SectionTitle>
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
                    {scn.body.map((b, i) => <li key={i}>{b}</li>)}
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
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 30, color: "var(--green-500)" }}>91</div>
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
        .catch(() => {});
    }, [activeConnectionId]);

    const addTask = () => {
      if (!draft) return;
      const newTask = { prio: "MEDIUM", title: draft, meta: "Added by Ravi Kumar · just now", owner: "Ravi Kumar", status: "OPEN" };
      setTaskList(t => [newTask, ...t]);
      setDraft(""); setAdding(false);
      toast("Task added", { kind: "success" });
      if (window.DTApi) {
        window.DTApi.createTask({ title: draft, priority: "MEDIUM", connection_id: activeConnectionId, assigned_to: "Ravi Kumar" }).catch(() => {});
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
              <Avatar name={t.owner.replace(" → ", " ")} size={26} color={t.owner.includes("Priya") ? "purple" : t.owner === "Deepa Nair" ? "green" : "blue"} />
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
    const { go, activeConnectionId } = useApp();
    const [cdeRows, setCdeRows] = React.useState([]);
    useIcons();

    React.useEffect(() => {
      if (!window.DTApi || !activeConnectionId) return;
      window.DTApi.listCDEs(activeConnectionId)
        .then(rows => {
          if (!rows) return;
          setCdeRows(rows.map(r => ({ name: r.column_name, status: r.health || "PASS" })));
        })
        .catch(() => {});
    }, [activeConnectionId]);
    const issues = [
      ["net_revenue NULL for 206K records (11.2%)", "Silver pipeline discount calc step failed", "CRITICAL", "Fixing"],
      ["Row count 57% below avg (1.84M vs 4.3M)", "Caused by early pipeline + null filter", "CRITICAL", "Fixing"],
      ["WMS shipment feed 85 mins late", "Downstream delivery status stale", "HIGH", "Open"],
      ["status='RTN_INIT' — 882 unknown codes", "Northeast region only — OMS clarification", "HIGH", "Open"],
      ["23 duplicate order_ids in Bronze", "Dedup logic review needed", "MEDIUM", "Open"],
    ];
    const decisions = [
      "Suppressed R4 (days_to_deliver) — expected null today",
      "Updated net_revenue description (Priya)",
      "Promoted status to CDE (Priya)",
      "Approved net_revenue_max_threshold rule (NL→DQ)",
      "Edited status whitelist — added PEND_REVIEW",
      "Escalated pipeline failure to Deepa Nair",
      "Blocked Finance Dashboard publish (Sunita notified)",
    ];
    return (
      <div className="dt-fade-up">
        <Card style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <ScoreRing score={69} size={104} stroke={10} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <Eyebrow>Data trust daily summary</Eyebrow>
            <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 19, margin: "6px 0 4px" }}>RetailCo · 2024-11-05</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--fg-2)" }}>
              <span>Generated 11:05 AM</span><span>·</span><Chip intent="warning" dot>Pipeline recovering</Chip><span>·</span><span style={{ color: "var(--red-500)", fontWeight: 600 }}>▼ 8 from yesterday</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="soft" icon="file-down">Export PDF</Button>
            <Button variant="soft" icon="share-2">Share</Button>
          </div>
        </Card>

        <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px" }}><SectionTitle icon="alert-circle">Top issues</SectionTitle></div>
          {issues.map((iss, i) => (
            <div key={i} style={{ display: "flex", gap: 14, padding: "12px 20px", borderTop: "1px solid var(--grey-100)", alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, color: "var(--fg-3)", width: 16 }}>{i + 1}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{iss[0]}</div>
                <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2 }}>{iss[1]}</div>
              </div>
              <Severity level={iss[2]} size="sm" />
              <Chip intent={iss[3] === "Fixing" ? "brand" : "neutral"} size="sm" dot={iss[3] === "Fixing"}>{iss[3]}</Chip>
            </div>
          ))}
        </Card>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <Card style={{ flex: 1, minWidth: 280 }}>
            <SectionTitle icon="radar">Anomaly summary</SectionTitle>
            {[["Volume: orders_enriched −57%", "Pipeline re-run in progress", "CRITICAL"], ["Source: WMS feed 85 min late", "Raised with infra team", "HIGH"], ["Segment: RTN_INIT in Northeast", "OMS team notified", "MEDIUM"], ["Drift: return_rate 4× above avg", "Under investigation", "MEDIUM"]].map(([t, s, sev], i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: i < 3 ? "1px solid var(--grey-100)" : "none", alignItems: "center" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: SEV[sev].c }}></span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>{t}</div><div style={{ fontSize: 11, color: "var(--fg-3)" }}>{s}</div></div>
              </div>
            ))}
          </Card>
          <Card style={{ flex: 1, minWidth: 280 }}>
            <SectionTitle icon="shield-alert">CDE status</SectionTitle>
            {cdeRows.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < cdeRows.length - 1 ? "1px solid var(--grey-100)" : "none" }}>
                <Mono style={{ flex: 1, fontWeight: 600 }}>{c.name}</Mono>
                <Chip intent={c.status === "PASS" ? "success" : c.status === "WARN" ? "warning" : "danger"} size="sm" dot>{c.status}</Chip>
              </div>
            ))}
          </Card>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Card style={{ flex: 1, minWidth: 280 }}>
            <SectionTitle icon="user-check" right={<Chip intent="brand">{decisions.length}</Chip>}>Human decisions today</SectionTitle>
            {decisions.map((d, i) => (
              <div key={i} style={{ display: "flex", gap: 9, padding: "7px 0", fontSize: 12.5, color: "var(--fg-1)" }}>
                <i data-lucide="check-circle-2" style={{ width: 15, height: 15, color: "var(--green-500)", flexShrink: 0, marginTop: 1 }}></i>{d}
              </div>
            ))}
          </Card>
          <Card style={{ flex: 1, minWidth: 280 }}>
            <SectionTitle icon="lightbulb">Recommended for tomorrow</SectionTitle>
            {["Implement Bronze pipeline dependency check — wait for full OMS extract", "Fix Silver net_revenue null filter — don't drop records silently", "Add WMS SLA monitoring rule — alert if file > 30 min late", "Resolve RTN_INIT status code with OMS team", "Review return rate spike — real or artifact?"].map((d, i) => (
              <div key={i} style={{ display: "flex", gap: 9, padding: "7px 0", fontSize: 12.5, color: "var(--fg-1)" }}>
                <span style={{ fontWeight: 700, color: "var(--brand)", width: 14 }}>{i + 1}</span>{d}
              </div>
            ))}
          </Card>
        </div>
      </div>
    );
  };

  window.DTScreens.simulator = Simulator;
  window.DTScreens.tasks = Tasks;
  window.DTScreens.summary = Summary;
})();
