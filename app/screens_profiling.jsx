// DataTrust — Screen: Profiling (selector → live agent run → report)
(function () {
  const D = window.DT;

  const Selector = ({ onProfile, connectionId }) => {
    const [open, setOpen] = React.useState({ RAW: false, BRONZE: false, SILVER: true, GOLD: false });
    const [datasets, setDatasets] = React.useState([]);
    const [searchQ, setSearchQ] = React.useState("");
    useIcons();

    React.useEffect(() => {
      if (!window.DTApi || !connectionId) return;
      window.DTApi.listDatasets(connectionId)
        .then(data => { if (data) setDatasets(data); })
        .catch(() => {});
    }, [connectionId]);

    const filtered = searchQ
      ? datasets.map(g => ({ ...g, tables: g.tables.filter(t => t.name.toLowerCase().includes(searchQ.toLowerCase())) })).filter(g => g.tables.length)
      : datasets;

    return (
      <Card>
        <SectionTitle icon="database" sub="Select a table on the connected platform to run the agentic profiler.">Profiling — select dataset</SectionTitle>
        <div style={{ display: "flex", gap: 10, marginBottom: 20, marginTop: 14 }}>
          <Input icon="search" placeholder="Search table — e.g. silver.orders_enriched" value={searchQ} onChange={setSearchQ} style={{ flex: 1 }} />
          <Button variant="primary" icon="scan-search" onClick={() => {
            const first = datasets.flatMap(g => g.tables)[0]?.name;
            const t = searchQ || first;
            if (!t) { toast("Select a table first or type a table name above", { kind: "warning" }); return; }
            onProfile(t.includes(".") ? t : `silver.${t}`);
          }}>Profile now</Button>
        </div>

        {filtered.map((grp) => (
          <div key={grp.layer} style={{ marginBottom: 8 }}>
            <button onClick={() => setOpen(o => ({ ...o, [grp.layer]: !o[grp.layer] }))} style={{ display: "flex", alignItems: "center", gap: 8,
              width: "100%", background: "none", border: "none", cursor: "pointer", padding: "8px 4px" }}>
              <i data-lucide={open[grp.layer] ? "chevron-down" : "chevron-right"} style={{ width: 16, height: 16, color: "var(--fg-2)" }}></i>
              <LayerPill layer={grp.layer} />
              <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{grp.tables.length} tables</span>
            </button>
            {open[grp.layer] && (
              <div style={{ display: "flex", flexDirection: "column", paddingLeft: 6 }}>
                {grp.tables.map((t) => (
                  <div key={t.name} className="dt-row-hover" onClick={() => onProfile(t.name)} style={{ display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 12px", borderRadius: 8, cursor: "pointer", borderLeft: t.hot ? "2px solid var(--red-400)" : "2px solid transparent" }}>
                    <i data-lucide="table-2" style={{ width: 15, height: 15, color: "var(--fg-3)" }}></i>
                    <Mono style={{ flex: 1, color: "var(--fg-1)", fontWeight: t.hot ? 700 : 500 }}>{t.name}</Mono>
                    <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{t.rows} rows</span>
                    <span style={{ fontSize: 11.5, color: "var(--fg-3)", width: 90, textAlign: "right" }}>{t.profiled}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, width: 56, justifyContent: "flex-end" }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: scoreColor(t.score) }}>{t.score}</span>
                      <Health status={t.score >= 85 ? "HEALTHY" : t.score >= 70 ? "WARN" : "CRIT"} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </Card>
    );
  };

  const Running = ({ table, connectionId, onDone }) => {
    const _defaultSteps = [
      { label: "Connect to data source" }, { label: "Sample table structure" },
      { label: "Compute row counts" }, { label: "Analyse column statistics" },
      { label: "Detect data types & formats" }, { label: "Run null & uniqueness checks" },
      { label: "Identify anomalies & risks" }, { label: "Generate AI narrative" },
    ];
    const [steps, setSteps] = React.useState(_defaultSteps.map(s => ({ ...s, state: "wait" })));
    const [pct, setPct] = React.useState(0);
    useIcons();

    React.useEffect(() => {
      // Try real SSE stream; fall back to mock animation
      if (window.DTApi && connectionId) {
        const parts = table.split(".");
        const schemaName = parts.length > 1 ? parts[0] : null;
        const tableName = parts.length > 1 ? parts.slice(1).join(".") : parts[0];

        window.DTApi.streamProfiling({
          connectionId,
          schemaName,
          tableName,
          onProgress: (evt) => {
            setSteps(prev => {
              const next = [...prev];
              const idx = Math.min(evt.node_index || 0, next.length - 1);
              return next.map((s, i) => ({
                ...s,
                state: i < idx ? "done" : i === idx ? "run" : "wait",
                detail: i === idx ? (evt.detail || s.detail) : s.detail,
                label: i === idx ? (evt.label || s.label) : s.label,
              }));
            });
            setPct(evt.pct || Math.round(((evt.node_index || 0) / steps.length) * 100));
          },
          onReport: (r) => { setPct(100); setTimeout(() => onDone(r), 600); },
          onError: () => { /* fall through to mock */ },
        });
        return;
      }
      // Mock fallback
      let i = 0;
      const tick = () => {
        if (i >= steps.length) { setTimeout(onDone, 600); return; }
        setSteps(prev => prev.map((s, idx) => ({ ...s, state: idx < i ? "done" : idx === i ? "run" : "wait" })));
        setPct(Math.round((i / steps.length) * 100));
        i++;
        setTimeout(tick, i === 1 ? 500 : 360);
      };
      tick();
    }, []);

    return (
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span className="dt-spin" style={{ width: 20, height: 20, border: "2.5px solid var(--brand-ring)", borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block" }}></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 16 }}>Profiling in progress</div>
            <Mono style={{ color: "var(--fg-2)" }}>{table}</Mono>
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 24, color: "var(--brand)" }}>{pct}%</div>
        </div>
        <Bar pct={pct} height={8} color="var(--brand)" />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 18 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "7px 4px", opacity: s.state === "wait" ? 0.45 : 1, transition: "opacity 200ms" }}>
              {s.state === "done" ? <i data-lucide="check-circle-2" style={{ width: 16, height: 16, color: "var(--green-500)" }}></i>
                : s.state === "run" ? <span className="dt-spin" style={{ width: 15, height: 15, border: "2px solid var(--brand-ring)", borderTopColor: "var(--brand)", borderRadius: "50%" }}></span>
                : <span style={{ width: 15, height: 15, borderRadius: "50%", border: "2px solid var(--grey-200)" }}></span>}
              <span style={{ flex: 1, fontSize: 13, fontWeight: s.state === "run" ? 600 : 500, color: "var(--fg-1)" }}>{s.label}</span>
              {s.state !== "wait" && <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{s.detail}</span>}
            </div>
          ))}
        </div>
      </Card>
    );
  };

  const Report = ({ onReprofile, report, tableName }) => {
    const { go, setProfilingDone } = useApp();
    const [notes, setNotes] = React.useState({});
    const [flagged, setFlagged] = React.useState({ R1: true, R2: true });
    const [openNote, setOpenNote] = React.useState(null);
    useIcons();

    // Map real report or fall back to mock
    const score = report?.quality_score ?? 61;
    const table = report?.table_fqn || tableName || "selected table";
    const rowCount = report?.row_count ? report.row_count.toLocaleString() : "1,842,300";
    const runAt = report?.run_at ? new Date(report.run_at).toLocaleString() : "2024-11-05 08:04 AM";
    const layer = table.split(".")[0]?.toUpperCase() || "SILVER";

    const profileSummary = report?.summary_stats ? Object.entries(report.summary_stats).map(([k, v]) => ({
      k: k.replace(/_/g, " "), v: String(v), bad: false, warn: false,
    })) : [];

    const columns = (report?.column_stats || []).length
      ? report.column_stats.map(c => ({
          name: c.column_name, nullPct: c.null_pct || 0, distinct: c.distinct_count?.toLocaleString() || "—",
          format: c.detected_format || "—", cde: c.is_cde || false,
          health: c.null_pct > 10 ? "CRIT" : c.null_pct > 5 ? "WARN" : "HEALTHY", score: c.quality_score || 100,
        }))
      : [];

    const risks = (report?.risks_flagged || []).length
      ? report.risks_flagged.map((r, i) => ({
          id: `R${i+1}`, sev: r.severity || "MEDIUM", title: r.title, body: r.description, col: r.column_name || "—",
        }))
      : [];

    return (
      <div className="dt-fade-up">
        {/* header */}
        <Card style={{ marginBottom: 16, background: "linear-gradient(180deg,#fff, var(--grey-50))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <ScoreRing score={score} size={100} stroke={9} sublabel="of 100" />
            <div style={{ flex: 1, minWidth: 220 }}>
              <Eyebrow>Profiling report</Eyebrow>
              <Mono style={{ fontSize: 16, fontWeight: 700, display: "block", margin: "4px 0 6px" }}>{table}</Mono>
              <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: "var(--fg-2)", flexWrap: "wrap" }}>
                <span>Run <strong style={{ color: "var(--fg-1)" }}>{runAt}</strong></span>
                <span>·</span><span><strong style={{ color: "var(--fg-1)" }}>{rowCount}</strong> rows</span>
                <span>·</span><LayerPill layer={layer} size="sm" />
              </div>
            </div>
            <Button variant="outline" icon="refresh-cw" size="sm" onClick={onReprofile}>Re-profile</Button>
          </div>
        </Card>

        {/* summary tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
          {profileSummary.map((m) => (
            <Card key={m.k} pad={14}>
              <div style={{ fontSize: 11.5, color: "var(--fg-2)", fontWeight: 600, marginBottom: 6 }}>{m.k}</div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 19, color: m.bad ? "var(--red-500)" : m.warn ? "var(--yellow-600)" : "var(--fg-1)" }}>{m.v}</div>
              {m.note && <div style={{ fontSize: 10.5, color: m.bad ? "var(--red-500)" : "var(--fg-3)", marginTop: 3 }}>{m.note}</div>}
            </Card>
          ))}
        </div>

        {/* column health */}
        <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px" }}><SectionTitle icon="columns-3">Column health</SectionTitle></div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--grey-50)", textAlign: "left" }}>
                  {["Column", "Null %", "Distinct", "Format", "CDE", "Health"].map((h, i) => (
                    <th key={h} style={{ padding: "9px 20px", fontSize: 11, fontWeight: 700, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: ".04em", textAlign: i === 1 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr key={c.name} style={{ borderTop: "1px solid var(--grey-100)", background: c.health === "CRIT" ? "var(--red-50)" : "transparent" }}>
                    <td style={{ padding: "9px 20px" }}><Mono style={{ fontWeight: c.cde ? 700 : 500 }}>{c.name}</Mono>{c.note && <i data-lucide="info" title={c.note} style={{ width: 12, height: 12, color: "var(--fg-3)", marginLeft: 6, verticalAlign: "middle" }}></i>}</td>
                    <td style={{ padding: "9px 20px", textAlign: "right", fontWeight: c.nullPct > 10 ? 700 : 500, color: c.nullPct > 10 ? "var(--red-500)" : c.nullPct > 5 ? "var(--yellow-700)" : "var(--fg-1)" }}>{c.nullPct}%</td>
                    <td style={{ padding: "9px 20px", color: "var(--fg-2)" }}>{c.distinct}</td>
                    <td style={{ padding: "9px 20px", color: "var(--fg-2)" }}>{c.format}</td>
                    <td style={{ padding: "9px 20px" }}>{c.cde ? <Chip intent="brand" size="sm" dot>CDE</Chip> : <span style={{ color: "var(--fg-3)" }}>—</span>}</td>
                    <td style={{ padding: "9px 20px" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Health status={c.health} /><span style={{ fontSize: 11.5, color: "var(--fg-2)" }}>{c.health}</span></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "10px 20px", fontSize: 11.5, color: "var(--fg-3)", background: "var(--grey-50)" }}>* refund_amount 91.3% null is EXPECTED — most orders are not returned.</div>
        </Card>

        {/* risks */}
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="alert-triangle" sub="The profiling agent surfaced 4 risks. Flag, annotate, or suppress each — every action is logged to the audit trail.">Risks flagged by agent</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
            {risks.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${SEV[r.sev].c}30`, background: SEV[r.sev].bg, borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <Chip intent={sevIntent[r.sev]} variant="fill" size="sm">{r.id}</Chip>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
                      <Severity level={r.sev} size="sm" />
                      {r.col !== "—" && <Mono style={{ fontSize: 11.5, color: "var(--fg-2)" }}>{r.col}</Mono>}
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)" }}>{r.title}</div>
                    <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 3 }}>{r.body}</div>
                    {notes[r.id] && <div style={{ marginTop: 8, padding: "8px 10px", background: "#fff", borderRadius: 8, fontSize: 12, color: "var(--fg-2)", borderLeft: "2px solid var(--brand)" }}><strong style={{ color: "var(--fg-1)" }}>Note · Ravi Kumar:</strong> {notes[r.id]}</div>}
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <Button size="sm" variant={flagged[r.id] ? "primary" : "soft"} icon={flagged[r.id] ? "check" : "flag"}
                        onClick={() => { setFlagged(f => ({ ...f, [r.id]: !f[r.id] })); toast(flagged[r.id] ? `${r.id} unflagged` : `${r.id} flagged for review · assigned to Ravi Kumar`, { kind: flagged[r.id] ? "info" : "success" }); }}>
                        {flagged[r.id] ? "Flagged" : "Flag for review"}</Button>
                      <Button size="sm" variant="soft" icon="message-square-plus" onClick={() => setOpenNote(openNote === r.id ? null : r.id)}>Add note</Button>
                      <Button size="sm" variant="ghost" icon="eye-off" onClick={() => toast(`${r.id} suppressed for run 2024-11-05 · logged to audit trail`, { kind: "info" })}>Suppress</Button>
                    </div>
                    {openNote === r.id && (
                      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                        <Input placeholder="Add an observation…" value={notes["_draft" + r.id] || ""} onChange={(v) => setNotes(n => ({ ...n, ["_draft" + r.id]: v }))} style={{ flex: 1 }} />
                        <Button size="sm" variant="primary" onClick={() => { setNotes(n => ({ ...n, [r.id]: n["_draft" + r.id] })); setOpenNote(null); toast("Note saved to audit trail", { kind: "success" }); }}>Save</Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button variant="soft" icon="share-2">Share to Slack</Button>
          <Button variant="primary" iconRight="arrow-right" onClick={() => { setProfilingDone(true); go("metadata"); }}>Proceed to metadata enrichment</Button>
        </div>
      </div>
    );
  };

  const Profiling = () => {
    const { profilingDone, setProfilingDone, activeConnectionId } = useApp();
    const [mode, setMode] = React.useState(profilingDone ? "report" : "select");
    const [table, setTable] = React.useState("");
    const [report, setReport] = React.useState(null);

    const startProfile = (t) => {
      setTable(t);
      // Try to load existing report from DB first
      if (window.DTApi?.getReportByTable && activeConnectionId) {
        window.DTApi.getReportByTable(t, activeConnectionId)
          .then(r => {
            if (r && r.report_id) { setReport(r); setProfilingDone(true); setMode("report"); }
            else setMode("running");
          })
          .catch(() => setMode("running"));
      } else {
        setMode("running");
      }
    };

    return (
      mode === "select" ? <Selector onProfile={startProfile} connectionId={activeConnectionId} />
      : mode === "running" ? <Running table={table} connectionId={activeConnectionId} onDone={(r) => { setProfilingDone(true); setReport(r || null); setMode("report"); }} />
      : <Report onReprofile={() => setMode("running")} report={report} tableName={table} />
    );
  };

  window.DTScreens.profiling = Profiling;
})();
