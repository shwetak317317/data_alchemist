// DataTrust — Screen: Anomaly Inbox + business explanation + fingerprinting
(function () {

  // ── Thresholds configuration panel ─────────────────────────────────────────
  const ThresholdsPanel = ({ onClose, connectionId }) => {
    const [vol,   setVol]   = React.useState(30);
    const [dist,  setDist]  = React.useState(20);
    const [fresh, setFresh] = React.useState(24);

    // Load persisted thresholds when the panel opens
    React.useEffect(() => {
      if (!window.DTApi || !connectionId) return;
      window.DTApi.getThresholds(connectionId)
        .then(t => {
          if (t.vol_pct        != null) setVol(t.vol_pct);
          if (t.dist_pct       != null) setDist(t.dist_pct);
          if (t.freshness_hours != null) setFresh(t.freshness_hours);
        })
        .catch(() => {});
    }, [connectionId]);

    const invalid = [vol, dist, fresh].some(v => !(Number(v) > 0));
    const save = () => {
      if (invalid) { toast("Thresholds must be positive numbers", { kind: "warning" }); return; }
      if (!window.DTApi?.saveThresholds) { toast("Backend unavailable — thresholds not saved", { kind: "error" }); return; }
      window.DTApi.saveThresholds({ connection_id: connectionId, vol_pct: Number(vol), dist_pct: Number(dist), freshness_hours: Number(fresh) })
        .then(() => { toast(`Thresholds saved — volume: ${vol}%, distribution: ${dist}%, freshness: ${fresh}h`, { kind: "success" }); onClose(); })
        .catch(() => { toast("Failed to save thresholds", { kind: "error" }); });
    };

    return (
      <Card style={{ marginBottom: 16, borderTop: "3px solid var(--navy-500)" }}>
        <SectionTitle icon="sliders-horizontal">Anomaly Detection Thresholds</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginTop: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 600, display: "block", marginBottom: 6 }}>Volume deviation %</label>
            {/* Input's onChange passes the VALUE, not an event (see primitives.jsx) —
                the old `e => setVol(e.target.value)` threw on every keystroke and
                crashed the whole screen to the error boundary. */}
            <Input type="number" value={vol} onChange={setVol} />
            <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>Alert when row count shifts by more than this %</div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 600, display: "block", marginBottom: 6 }}>Distribution shift %</label>
            <Input type="number" value={dist} onChange={setDist} />
            <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>Alert when null rate or value spread shifts by this %</div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 600, display: "block", marginBottom: 6 }}>Freshness window (hours)</label>
            <Input type="number" value={fresh} onChange={setFresh} />
            <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>Alert when table data is older than this many hours</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Button size="sm" variant="primary" icon="check" disabled={invalid} onClick={save}>Save thresholds</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    );
  };

  const Explanation = ({ data, anomalyId, anomaly, loading, error, connectionId }) => {
    if (loading) {
      return (
        <div style={{ marginTop: 14, background: "#fff", border: "1px solid var(--grey-200)", borderRadius: 12, padding: 24, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
          Generating business explanation…
        </div>
      );
    }
    if (error) {
      return (
        <div style={{ marginTop: 14, background: "var(--red-50)", border: "1px solid var(--red-200)", borderRadius: 12, padding: 18, color: "var(--red-700)", fontSize: 13 }}>
          Could not generate an explanation — {error}
        </div>
      );
    }
    if (!data) return null;

    const sections = [
      ["What happened",  data.what_happened  || data.summary || ""],
      ["Why it matters", data.why_it_matters || data.business_impact || ""],
    ].filter(([, v]) => v);
    const aiActions = data.recommended_actions;

    const createAnomalyTask = (extraTitle) => {
      window.DTApi?.createTask?.({
        title: `${extraTitle || "Anomaly"}: ${anomaly?.type || "Unknown"} on ${anomaly?.table || "table"}`,
        description: anomaly?.desc || null,
        priority: (anomaly?.sev === "HIGH" || anomaly?.sev === "CRITICAL") ? anomaly.sev : "MEDIUM",
        related_entity_type: "anomaly",
        related_entity_id: anomalyId,
        connection_id: connectionId || null,
      })
        .then(() => toast("Task created in Task Board", { kind: "success" }))
        .catch(() => toast("Failed to create task — check backend", { kind: "error" }));
    };

    return (
    <div style={{ marginTop: 14, background: "#fff", border: "1px solid var(--grey-200)", borderRadius: 12, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <i data-lucide="file-text" style={{ width: 16, height: 16, color: "var(--navy-500)" }}></i>
        <span style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 14 }}>Business explanation</span>
        {data.fallback
          ? <Chip intent="neutral" size="sm" icon="shield">Auto-generated (AI unavailable)</Chip>
          : <Chip intent="brand" size="sm" icon="sparkles">AI-generated</Chip>}
      </div>
      {sections.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--fg-3)", marginBottom: 12 }}>No explanation content was returned for this anomaly.</div>
      )}
      {sections.map(([k, v]) => (
        <div key={k} style={{ marginBottom: 12 }}>
          <Eyebrow style={{ marginBottom: 4 }}>{k}</Eyebrow>
          <div style={{ fontSize: 13, color: "var(--fg-1)", lineHeight: 1.6 }}>{v}</div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 16, padding: 14, background: "var(--red-50)", borderRadius: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}><Eyebrow color="var(--red-600)">Recommended actions</Eyebrow>
          <ol style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--fg-1)", lineHeight: 1.7 }}>
            {aiActions && aiActions.length > 0
              ? aiActions.map((action, i) => <li key={i}>{action}</li>)
              : <li style={{ color: "var(--fg-3)", listStyle: "none", marginLeft: -18 }}>No recommended actions were generated for this anomaly.</li>
            }
          </ol>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="primary" icon="user-check" onClick={() => createAnomalyTask("Anomaly")}>Accept & create task</Button>
        <Button size="sm" variant="soft" icon="share-2" onClick={() => {
          window.DTApi?.shareAnomaly?.(anomalyId, { channel: "#data-quality" })
            .then(() => toast("Explanation shared to #data-quality", { kind: "success" }))
            .catch(() => toast("Share failed — check backend", { kind: "error" }));
        }}>Share to Slack</Button>
        <span title="Editing explanations isn't wired to a backend annotation endpoint yet">
          <Button size="sm" variant="ghost" icon="pencil" disabled>Edit explanation</Button>
        </span>
        <span title="No Finance notification integration is configured yet">
          <Button size="sm" variant="ghost" icon="building-2" disabled>Send to Finance</Button>
        </span>
      </div>
    </div>
    );
  };

  const Fingerprint = ({ items = [], anomaly, anomalyId, connectionId }) => (
    <div style={{ marginTop: 12, background: "linear-gradient(180deg, var(--purple-50), #fff)", border: "1px solid var(--purple-200)", borderRadius: 12, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <i data-lucide="brain" style={{ width: 16, height: 16, color: "var(--purple-500)" }}></i>
        <span style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 14 }}>Anomaly fingerprint</span>
        <Chip intent="purple" size="sm">Institutional memory</Chip>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginBottom: 14 }}>This pattern has been seen before. {items.length} similar past incident{items.length !== 1 ? "s" : ""} found — including how they were resolved and how long it took.</div>
      {items.map((f, i) => (
        <div key={i} style={{ display: "flex", gap: 14, padding: 14, background: "#fff", borderRadius: 10, border: "1px solid var(--grey-100)", marginBottom: 10 }}>
          <div style={{ textAlign: "center", flexShrink: 0, width: 64 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22, color: "var(--purple-500)" }}>{f.sim}%</div>
            <div style={{ fontSize: 10, color: "var(--fg-3)" }}>match</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <Mono style={{ fontWeight: 700 }}>{f.date}</Mono><Chip intent="neutral" size="sm">{f.day}</Chip>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--fg-1)", lineHeight: 1.55, marginBottom: 6 }}><strong>Root cause:</strong> {f.cause}</div>
            <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--fg-2)", flexWrap: "wrap" }}>
              <span><i data-lucide="wrench" style={{ width: 12, height: 12, verticalAlign: "-1px", marginRight: 4 }}></i>{f.resolution}</span>
              <span><i data-lucide="clock" style={{ width: 12, height: 12, verticalAlign: "-1px", marginRight: 4 }}></i>Fixed in {f.time}</span>
              <span><i data-lucide="user" style={{ width: 12, height: 12, verticalAlign: "-1px", marginRight: 4 }}></i>{f.by}</span>
            </div>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <span title="No pipeline re-run integration is wired yet — trigger the re-run manually in your orchestrator">
          <Button size="sm" variant="primary" icon="zap" disabled>Apply suggested resolution</Button>
        </span>
        <Button size="sm" variant="soft" icon="user-plus" onClick={() => {
          window.DTApi?.createTask?.({
            title: `Anomaly (recurring pattern): ${anomaly?.type || "Unknown"} on ${anomaly?.table || "table"}`,
            description: anomaly?.desc || null,
            priority: (anomaly?.sev === "HIGH" || anomaly?.sev === "CRITICAL") ? anomaly.sev : "MEDIUM",
            related_entity_type: "anomaly",
            related_entity_id: anomalyId,
            connection_id: connectionId || null,
          })
            .then(() => toast("Task created in Task Board", { kind: "success" }))
            .catch(() => toast("Failed to create task — check backend", { kind: "error" }));
        }}>Create task</Button>
      </div>
    </div>
  );

  const Anomalies = () => {
    const { ackedAnomalies, setAckedAnomalies, activeConnectionId, refreshAnomalyCount, go, setActiveTableFqn } = useApp();
    const [expanded, setExpanded] = React.useState(null); // id
    const [escalatedIds, setEscalatedIds] = React.useState({}); // id -> true once a task exists
    const [taskedIds, setTaskedIds] = React.useState({});       // id -> true once a follow-up task exists
    const [tab, setTab] = React.useState({}); // id -> 'explain' | 'fingerprint'
    const [anomalies, setAnomalies] = React.useState([]);
    const [explanations, setExplanations] = React.useState({}); // id -> explanation object
    const [explainLoading, setExplainLoading] = React.useState({}); // id -> bool
    const [explainError, setExplainError] = React.useState({}); // id -> message
    const [fingerprints, setFingerprints] = React.useState([]);
    // Start in the loading state (not false): effects run AFTER the first paint, so a
    // false initial value flashes the "All clear" zero-state (or a previous
    // connection's rows) for a beat before the fetch even starts — the reader sees
    // wrong data first, then the correction. First paint must be the spinner.
    const [loading, setLoading] = React.useState(!!window.DTApi);
    const [inboxError, setInboxError] = React.useState(null);
    const [showThresholds, setShowThresholds] = React.useState(false);
    useIcons();

    const _mapRow = (a) => ({
      id: a.anomaly_id || a.id, sev: a.severity || "MEDIUM",
      type: a.anomaly_type || "Unknown", table: a.table_fqn || "",
      layer: (a.layer || "SILVER").toUpperCase(),
      time: a.detected_at ? new Date(a.detected_at).toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + new Date(a.detected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
      desc: a.description || "", history: a.history_values || null,
      hasFingerprint: a.has_fingerprint || false,
    });

    React.useEffect(() => {
      if (!window.DTApi) return;
      setLoading(true);
      setInboxError(null);
      // Clear the previous connection's rows immediately — leaving them on screen
      // while the new connection's inbox loads reads as wrong data, not as caching.
      setAnomalies([]);
      setFingerprints([]);
      setExpanded(null);
      window.DTApi.getFingerprints?.(activeConnectionId)
        .then(rows => { if (rows) setFingerprints(rows); })
        .catch(() => {});
      window.DTApi.getAnomalyInbox(activeConnectionId)
        .then(rows => { if (rows) setAnomalies(rows.map(_mapRow)); })
        .catch(err => {
          setInboxError("Could not load anomaly inbox — " + (err?.message || "check backend"));
          toast("Failed to load inbox", { kind: "error" });
        })
        .finally(() => setLoading(false));
    }, [activeConnectionId]);

    const runScan = () => {
      if (!window.DTApi || !activeConnectionId) return;
      window.DTApi.scanAnomalies({ connection_id: activeConnectionId })
        .then(r => {
          toast(`Scan complete — ${r.detected || 0} new anomaly${r.detected !== 1 ? "s" : ""} detected`,
            { kind: r.detected > 0 ? "warning" : "success" });
          return window.DTApi.getAnomalyInbox(activeConnectionId);
        })
        .then(rows => { if (rows) setAnomalies(rows.map(_mapRow)); refreshAnomalyCount?.(); })
        .catch(err => toast("Scan failed: " + (err?.message || "error"), { kind: "error" }));
    };

    const ack = (id) => {
      setAckedAnomalies(a => ({ ...a, [id]: true }));
      toast("Anomaly acknowledged · alert suppressed for 4 hours", { kind: "info" });
      window.DTApi?.acknowledgeAnomaly?.(id, { note: "Suppressed for 4 hours" })
        .then(() => refreshAnomalyCount?.())
        .catch(() => {
          // The server still counts it open — showing it acked would be a lie.
          setAckedAnomalies(a => { const next = { ...a }; delete next[id]; return next; });
          toast("Acknowledge failed — the anomaly is still open", { kind: "error" });
          refreshAnomalyCount?.();
        });
    };

    const explainAnomaly = (id) => {
      if (!window.DTApi || explanations[id] || explainLoading[id]) return;
      setExplainLoading(prev => ({ ...prev, [id]: true }));
      setExplainError(prev => ({ ...prev, [id]: null }));
      window.DTApi.explainAnomaly(id)
        .then(r => setExplanations(prev => ({ ...prev, [id]: r })))
        .catch(err => setExplainError(prev => ({ ...prev, [id]: err?.message || "check backend" })))
        .finally(() => setExplainLoading(prev => ({ ...prev, [id]: false })));
    };

    return (
      <div className="dt-fade-up">
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="siren" sub="Issues that rule checks alone cannot catch — volume, distribution, source, and segment anomalies across all 4 layers."
            right={<div style={{ display: "flex", gap: 8 }}><Button size="sm" variant="soft" icon="radar" onClick={runScan}>Run full scan</Button><Button size="sm" variant={showThresholds ? "primary" : "soft"} icon="sliders-horizontal" onClick={() => setShowThresholds(v => !v)}>Thresholds</Button></div>}>
            Anomaly Inbox — {loading ? "…" : anomalies.length} active</SectionTitle>
        </Card>

        {showThresholds && <ThresholdsPanel onClose={() => setShowThresholds(false)} connectionId={activeConnectionId} />}

        {inboxError && (
          <Card style={{ borderLeft: "3px solid var(--red-500)", padding: 16, marginBottom: 12 }}>
            <div style={{ color: "var(--red-600)", fontSize: 13 }}>{inboxError}</div>
          </Card>
        )}

        {loading && (
          <Card style={{ textAlign: "center", padding: 40 }}>
            <span className="dt-spin" style={{ width: 22, height: 22, border: "2.5px solid var(--brand-ring)",
              borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block", marginBottom: 12 }}></span>
            <div style={{ color: "var(--fg-3)", fontSize: 13 }}>Loading anomaly inbox…</div>
          </Card>
        )}

        {!loading && !inboxError && anomalies.length === 0 && (
          <Card style={{ textAlign: "center", padding: 48 }}>
            <i data-lucide="shield-check" style={{ width: 48, height: 48, color: "var(--green-400)", display: "block", margin: "0 auto 16px" }}></i>
            <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 18, marginBottom: 8 }}>All clear</div>
            <div style={{ color: "var(--fg-2)", fontSize: 13 }}>No open anomalies detected across all layers. Run a full scan to check for new issues.</div>
          </Card>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {anomalies.map((a) => {
            const open = expanded === a.id;
            const acked = ackedAnomalies[a.id];
            const cur = tab[a.id] || "explain";
            return (
              <Card key={a.id} pad={0} style={{ borderLeft: `3px solid ${SEV[a.sev].c}`, opacity: acked ? 0.7 : 1 }}>
                <div style={{ padding: 18 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 6 }}>
                        <Severity level={a.sev} size="sm" />
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{a.type}</span>
                        <LayerPill layer={a.layer} size="sm" />
                        {acked && <Chip intent="neutral" size="sm" icon="check">Acknowledged</Chip>}
                        {a.hasFingerprint && <Chip intent="purple" size="sm" icon="brain">Seen before</Chip>}
                      </div>
                      <Mono style={{ fontSize: 11.5, color: "var(--fg-3)", display: "block", marginBottom: 4 }}>{a.table}</Mono>
                      <div style={{ fontSize: 13, color: "var(--fg-1)", lineHeight: 1.5 }}>{a.desc}</div>
                    </div>
                    {a.history && (
                      <div style={{ width: 180, flexShrink: 0 }}>
                        <BarSeries data={a.history.map((v, i) => ({ label: i === a.history.length - 1 ? "Latest" : `−${a.history.length - 1 - i}`, value: v }))} height={56} highlightLast />
                      </div>
                    )}
                    <span style={{ fontSize: 11, color: "var(--fg-3)", flexShrink: 0 }}>{a.time}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                    <Button size="sm" variant={open && cur === "explain" ? "primary" : "soft"} icon="file-text" onClick={() => { setExpanded(open && cur === "explain" ? null : a.id); setTab(t => ({ ...t, [a.id]: "explain" })); explainAnomaly(a.id); }}>Explain in business terms</Button>
                    {a.hasFingerprint && <Button size="sm" variant={open && cur === "fingerprint" ? "primary" : "soft"} icon="brain" onClick={() => { setExpanded(a.id); setTab(t => ({ ...t, [a.id]: "fingerprint" })); }}>Fingerprint match</Button>}
                    <Button size="sm" variant="ghost" icon="check" onClick={() => ack(a.id)}>Acknowledge</Button>
                    <Button size="sm" variant="ghost" icon="siren" disabled={!!escalatedIds[a.id]} onClick={() => {
                      window.DTApi?.createTask?.({
                        title: `ESCALATED: ${a.type} on ${a.table || "table"}`,
                        description: a.desc || null,
                        priority: "CRITICAL",
                        related_entity_type: "anomaly",
                        related_entity_id: a.id,
                        connection_id: activeConnectionId || null,
                      })
                        .then(() => {
                          setEscalatedIds(prev => ({ ...prev, [a.id]: true }));
                          toast(`${a.type} on ${a.table || "table"} escalated · task created in Task Board`, { kind: "warning" });
                        })
                        .catch(() => toast("Escalation failed — check backend", { kind: "error" }));
                    }}>{escalatedIds[a.id] ? "Escalated" : "Escalate"}</Button>
                    <Button size="sm" variant="ghost" icon="clipboard-list" disabled={!!taskedIds[a.id]}
                      title="Create a follow-up task on the Task Board, linked back to this anomaly"
                      onClick={() => {
                        const me = (() => { try { return JSON.parse(sessionStorage.getItem('dt_user') || '{}').name || 'User'; } catch(_) { return 'User'; } })();
                        window.DTApi?.createTask?.({
                          title: `Investigate: ${a.type} on ${a.table || "table"}`,
                          description: a.desc || null,
                          priority: a.sev === "CRITICAL" ? "CRITICAL" : a.sev === "HIGH" ? "HIGH" : "MEDIUM",
                          owner: me,
                          related_entity_type: "anomaly",
                          related_entity_id: a.id,
                          connection_id: activeConnectionId || null,
                        })
                          .then(() => {
                            setTaskedIds(prev => ({ ...prev, [a.id]: true }));
                            toast("Task created — find it on the Task Board", { kind: "success" });
                          })
                          .catch(() => toast("Task creation failed — check backend", { kind: "error" }));
                      }}>{taskedIds[a.id] ? "Task created" : "Create task"}</Button>
                    {a.table && (
                      <Button size="sm" variant="ghost" icon="network" title="Open the Impact Graph with this table selected — see what feeds it and what it feeds"
                        onClick={() => { setActiveTableFqn?.(a.table); go("impact"); }}>
                        View impact
                      </Button>
                    )}
                  </div>
                  {open && (cur === "explain"
                    ? <Explanation data={explanations[a.id]} anomalyId={a.id} anomaly={a} loading={explainLoading[a.id]} error={explainError[a.id]} connectionId={activeConnectionId} />
                    : <Fingerprint items={fingerprints.filter(f => !f.table || f.table === a.table)} anomaly={a} anomalyId={a.id} connectionId={activeConnectionId} />)}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    );
  };

  window.DTScreens.anomalies = Anomalies;
})();
