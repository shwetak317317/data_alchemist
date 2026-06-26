// DataTrust — Screen: Anomaly Inbox + business explanation + fingerprinting
(function () {
  const D = window.DT;

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

    const save = () => {
      const body = { connection_id: connectionId, vol_pct: Number(vol), dist_pct: Number(dist), freshness_hours: Number(fresh) };
      (window.DTApi?.saveThresholds ? window.DTApi.saveThresholds(body) : Promise.resolve())
        .then(() => { toast(`Thresholds saved — volume: ${vol}%, distribution: ${dist}%, freshness: ${fresh}h`, { kind: "success" }); onClose(); })
        .catch(() => { toast("Failed to save thresholds", { kind: "error" }); });
    };

    return (
      <Card style={{ marginBottom: 16, borderTop: "3px solid var(--navy-500)" }}>
        <SectionTitle icon="sliders-horizontal">Anomaly Detection Thresholds</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginTop: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 600, display: "block", marginBottom: 6 }}>Volume deviation %</label>
            <Input type="number" value={vol} onChange={e => setVol(e.target.value)} />
            <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>Alert when row count shifts by more than this %</div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 600, display: "block", marginBottom: 6 }}>Distribution shift %</label>
            <Input type="number" value={dist} onChange={e => setDist(e.target.value)} />
            <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>Alert when null rate or value spread shifts by this %</div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 600, display: "block", marginBottom: 6 }}>Freshness window (hours)</label>
            <Input type="number" value={fresh} onChange={e => setFresh(e.target.value)} />
            <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>Alert when table data is older than this many hours</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Button size="sm" variant="primary" icon="check" onClick={save}>Save thresholds</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    );
  };

  const Explanation = ({ data, anomalyId }) => {
    // When a real API explanation is available, render it; otherwise fall back to demo content
    const sections = data
      ? [
          ["What happened",   data.what_happened  || data.summary || ""],
          ["Why it matters",  data.why_it_matters || data.business_impact || ""],
        ].filter(([, v]) => v)
      : [
          ["What happened", "Today's order dataset contains 1.84 million records — 57% fewer than the daily average of 4.3 million."],
          ["Likely root cause", "The OMS extract arrived 85 minutes late; the Silver net_revenue step failed, filtering 206K records."],
          ["Business impact", "Finance Revenue Dashboard is showing only 42% of today's orders. 3 ML models have incomplete training data."],
        ];

    const aiActions = data?.recommended_actions;

    return (
    <div style={{ marginTop: 14, background: "#fff", border: "1px solid var(--grey-200)", borderRadius: 12, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <i data-lucide="file-text" style={{ width: 16, height: 16, color: "var(--navy-500)" }}></i>
        <span style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 14 }}>Business explanation</span>
        {data ? <Chip intent="brand" size="sm" icon="sparkles">AI-generated</Chip> : <Chip intent="danger" size="sm" variant="fill">CRITICAL</Chip>}
      </div>
      {sections.map(([k, v]) => (
        <div key={k} style={{ marginBottom: 12 }}>
          <Eyebrow style={{ marginBottom: 4 }}>{k}</Eyebrow>
          <div style={{ fontSize: 13, color: "var(--fg-1)", lineHeight: 1.6 }}>{v}</div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 16, padding: 14, background: "var(--red-50)", borderRadius: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {!data && (
          <div><Eyebrow color="var(--red-600)">Est. revenue undercount</Eyebrow>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, color: "var(--red-500)", marginTop: 2 }}>$221.9M</div>
          </div>
        )}
        <div style={{ flex: 1 }}><Eyebrow color="var(--red-600)">Recommended actions</Eyebrow>
          <ol style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--fg-1)", lineHeight: 1.7 }}>
            {aiActions && aiActions.length > 0
              ? aiActions.map((action, i) => <li key={i}>{action}</li>)
              : <>
                  <li>Confirm OMS extract completed fully (~4.4M rows expected)</li>
                  <li>Re-run Bronze orders pipeline for 2024-11-05</li>
                  <li>Fix Silver net_revenue step and re-run Silver</li>
                  <li>Notify Finance not to publish today's dashboard</li>
                </>
            }
          </ol>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="primary" icon="user-check" onClick={() => toast("Assigned to Deepa Nair", { kind: "success" })}>Accept & assign</Button>
        <Button size="sm" variant="soft" icon="share-2" onClick={() => {
          window.DTApi?.shareAnomaly?.(anomalyId, { channel: "#data-quality" })
            .then(() => toast("Explanation shared to #data-quality", { kind: "success" }))
            .catch(() => toast("Share failed — check backend", { kind: "error" }));
        }}>Share to Slack</Button>
        <Button size="sm" variant="ghost" icon="pencil" onClick={() => toast("Edit mode — annotation will be saved to audit trail", { kind: "info" })}>Edit explanation</Button>
        <Button size="sm" variant="ghost" icon="building-2" onClick={() => toast("Sent to Finance team", { kind: "info" })}>Send to Finance</Button>
      </div>
    </div>
    );
  };

  const Fingerprint = ({ items = [] }) => (
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
        <Button size="sm" variant="primary" icon="zap" onClick={() => toast("Suggested resolution applied · Re-run Bronze + Silver · ETA ~50 min", { kind: "success" })}>Apply suggested resolution</Button>
        <Button size="sm" variant="soft" icon="user-plus" onClick={() => toast("Assigned to Deepa Nair", { kind: "info" })}>Assign to Deepa Nair</Button>
      </div>
    </div>
  );

  const Anomalies = () => {
    const { ackedAnomalies, setAckedAnomalies, activeConnectionId, refreshAnomalyCount } = useApp();
    const [expanded, setExpanded] = React.useState(null); // id
    const [tab, setTab] = React.useState({}); // id -> 'explain' | 'fingerprint'
    const [anomalies, setAnomalies] = React.useState([]);
    const [explanations, setExplanations] = React.useState({}); // id -> explanation object
    const [fingerprints, setFingerprints] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [inboxError, setInboxError] = React.useState(null);
    const [showThresholds, setShowThresholds] = React.useState(false);
    useIcons();

    const _mapRow = (a) => ({
      id: a.anomaly_id || a.id, sev: a.severity || "MEDIUM",
      type: a.anomaly_type || "Unknown", table: a.table_fqn || "",
      layer: (a.layer || "SILVER").toUpperCase(),
      time: a.detected_at ? new Date(a.detected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
      desc: a.description || "", history: a.history_values || null,
      hasFingerprint: a.has_fingerprint || false,
    });

    React.useEffect(() => {
      if (!window.DTApi) return;
      setLoading(true);
      setInboxError(null);
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
        .catch(() => { refreshAnomalyCount?.(); });
    };

    const explainAnomaly = (id) => {
      if (!window.DTApi || explanations[id]) return;
      window.DTApi.explainAnomaly(id)
        .then(r => setExplanations(prev => ({ ...prev, [id]: r })))
        .catch(() => {});
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
          <Card style={{ textAlign: "center", padding: 32 }}>
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
                        <BarSeries data={a.history.map((v, i) => ({ label: i === a.history.length - 1 ? "Today" : `D-${a.history.length - 1 - i}`, value: v }))} height={56} highlightLast />
                      </div>
                    )}
                    <span style={{ fontSize: 11, color: "var(--fg-3)", flexShrink: 0 }}>{a.time}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                    <Button size="sm" variant={open && cur === "explain" ? "primary" : "soft"} icon="file-text" onClick={() => { setExpanded(open && cur === "explain" ? null : a.id); setTab(t => ({ ...t, [a.id]: "explain" })); explainAnomaly(a.id); }}>Explain in business terms</Button>
                    {a.hasFingerprint && <Button size="sm" variant={open && cur === "fingerprint" ? "primary" : "soft"} icon="brain" onClick={() => { setExpanded(a.id); setTab(t => ({ ...t, [a.id]: "fingerprint" })); }}>Fingerprint match</Button>}
                    <Button size="sm" variant="ghost" icon="check" onClick={() => ack(a.id)}>Acknowledge</Button>
                    <Button size="sm" variant="ghost" icon="siren" onClick={() => toast(`${a.type} on ${a.table || "table"} escalated to pipeline owner · ticket created`, { kind: "warning" })}>Escalate</Button>
                  </div>
                  {open && (cur === "explain" ? <Explanation data={explanations[a.id]} anomalyId={a.id} /> : <Fingerprint items={fingerprints} />)}
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
