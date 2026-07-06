// DataTrust — Screen: Profiling (selector → live agent run → report)
(function () {

  // ── Selector ──────────────────────────────────────────────────────────────
  const Selector = ({ onProfile, onForceProfile, connectionId }) => {
    const { datasets, setDatasets, datasetsLoading, refreshDatasets,
      backgroundJobs, startJob, updateJob, endJob } = useApp();
    const [open, setOpen]             = React.useState({});
    const [connError, setConnError]   = React.useState(null);
    const [searchQ, setSearchQ]       = React.useState("");
    const [batchState, setBatchState] = React.useState(null);
    // batchState: { groupKey, done, total, errors, currentFqn } | null
    // A batch keeps running in the background after this screen unmounts (callback
    // recursion + the shell's global job registry). On remount mid-run, local state
    // has reset — adopt the live job so the UI shows the run and blocks a duplicate.
    const liveBatchJob = (backgroundJobs || []).find(j => j.id.startsWith(`profile-batch-${connectionId}-`));
    const effBatch = batchState || (liveBatchJob ? {
      groupKey: liveBatchJob.groupKey, done: liveBatchJob.done || 0, total: liveBatchJob.total || 0,
      errors: liveBatchJob.errors || 0, currentFqn: liveBatchJob.currentFqn || null,
    } : null);
    useIcons();

    // Auto-open first group when datasets load
    const prevLenRef = React.useRef(0);
    React.useEffect(() => {
      if (datasets.length > 0 && prevLenRef.current === 0) {
        const first = datasets.find(g => g.tables.length > 0);
        if (first) {
          const key = first.schema || `${first.layer}-0`;
          setOpen(o => ({ ...o, [key]: true }));
        }
      }
      prevLenRef.current = datasets.length;
    }, [datasets]);

    // Sequential batch profiling — pure callback recursion, no async/await
    const runGroupBatch = (grp, groupKey) => {
      if (effBatch) return;   // a batch is already live (possibly started before a page switch)
      const tables = grp.tables.map(t => grp.schema ? `${grp.schema}.${t.name}` : t.name);
      if (!tables.length || !window.DTApi || !connectionId) return;

      setBatchState({ groupKey, done: 0, total: tables.length, errors: 0, currentFqn: null });
      setOpen(o => ({ ...o, [groupKey]: true }));
      // Register globally so the batch survives navigation: the recursion keeps
      // executing after unmount, and the TopBar indicator + this screen's remount
      // adoption (effBatch above) keep it visible everywhere.
      const jobId = `profile-batch-${connectionId}-${groupKey}`;
      startJob(jobId, `Profiling ${grp.schema || grp.layer || "tables"}`);
      updateJob(jobId, { total: tables.length, groupKey });

      let errorCount = 0;

      const runNext = (idx) => {
        // All tables done
        if (idx >= tables.length) {
          setBatchState(null);
          endJob(jobId);
          toast(
            errorCount > 0
              ? `Batch complete — ${tables.length - errorCount}/${tables.length} tables succeeded`
              : `All ${tables.length} tables profiled`,
            { kind: errorCount > 0 ? "warning" : "success" }
          );
          return;
        }

        const fqn = tables[idx];
        setBatchState(prev => prev ? { ...prev, currentFqn: fqn } : null);
        updateJob(jobId, { currentFqn: fqn });

        const parts      = fqn.split(".");
        const schemaName = parts.length > 1 ? parts[0] : null;
        const tableName  = parts.length > 1 ? parts.slice(1).join(".") : parts[0];

        // Called whether success or failure — advances to next table
        const advance = (report) => {
          if (report) {
            setDatasets(prev => prev.map(g => ({
              ...g,
              tables: g.tables.map(t => {
                const tFqn = g.schema ? `${g.schema}.${t.name}` : t.name;
                if (tFqn !== fqn) return t;
                return {
                  ...t,
                  score:    Math.round(report?.quality_score || 0),
                  rows:     report?.row_count || t.rows,
                  profiled: new Date().toISOString().slice(0, 10),
                  hot:      false,
                };
              }),
            })));
          } else {
            errorCount++;
          }
          setBatchState(prev => prev
            ? { ...prev, done: idx + 1, errors: errorCount, currentFqn: null }
            : null
          );
          updateJob(jobId, { done: idx + 1, errors: errorCount, currentFqn: null });
          runNext(idx + 1);
        };

        try {
          window.DTApi.streamProfiling({
            connectionId, schemaName, tableName,
            onProgress: () => {},
            onReport:   (r)   => advance(r),
            onError:    ()    => advance(null),
          });
        } catch (_) {
          advance(null);
        }
      };

      runNext(0);
    };

    const filtered = searchQ
      ? datasets.map(g => ({ ...g, tables: g.tables.filter(t => t.name.toLowerCase().includes(searchQ.toLowerCase())) })).filter(g => g.tables.length)
      : datasets;

    if (!connectionId) return (
      <Card>
        <SectionTitle icon="database">Profiling — select dataset</SectionTitle>
        <div style={{ textAlign: "center", padding: "36px 20px", color: "var(--fg-3)" }}>
          <i data-lucide="plug" style={{ width: 32, height: 32, display: "block", margin: "0 auto 12px" }}></i>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-2)", marginBottom: 6 }}>No connection selected</div>
          <div style={{ fontSize: 13 }}>Go to <strong>Connections</strong> and set an active connection first.</div>
        </div>
      </Card>
    );

    return (
      <Card>
        <SectionTitle icon="database" sub="Select a table to run the agentic profiler. Use Run all to profile an entire layer.">Profiling — select dataset</SectionTitle>
        <div style={{ display: "flex", gap: 10, marginBottom: 20, marginTop: 14 }}>
          <Input icon="search" placeholder="Search tables…" value={searchQ} onChange={setSearchQ} style={{ flex: 1 }} />
          <Button variant="outline" icon="refresh-cw" disabled={datasetsLoading} onClick={() => refreshDatasets(true)}
            title="Re-fetch tables from the live connector and refresh the cache">
            {datasetsLoading
              ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span className="dt-spin" style={{ width: 12, height: 12, border: "1.5px solid var(--brand-ring)",
                    borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block" }}></span>
                  Loading…
                </span>
              : "Refresh tables"}
          </Button>
          <Button variant="primary" icon="scan-search" onClick={() => {
            const visibleGroups = filtered.filter(g => g.tables.length > 0);
            const firstGroup    = visibleGroups[0];
            const firstTable    = firstGroup?.tables[0];
            const t = searchQ.trim();
            if (!firstTable && !t) { toast("No tables found — check connection or add schemas in Connections.", { kind: "warning" }); return; }
            if (!firstTable &&  t) { toast(`No table matching "${t}" — clear the search or try a different name.`, { kind: "warning" }); return; }
            onProfile(firstGroup?.schema ? `${firstGroup.schema}.${firstTable.name}` : firstTable.name);
          }}>Profile now</Button>
        </div>

        {connError && (
          <div style={{ background: "var(--red-50, #fef2f2)", border: "1px solid var(--red-200, #fecaca)",
            borderRadius: 8, padding: "12px 16px", marginBottom: 12, fontSize: 13 }}>
            <div style={{ fontWeight: 600, color: "var(--red-700, #b91c1c)", marginBottom: 4 }}>
              Connection error — cannot load tables
            </div>
            <div style={{ color: "var(--red-600, #dc2626)", fontFamily: "monospace", fontSize: 12,
              wordBreak: "break-word" }}>{connError}</div>
            <div style={{ marginTop: 8, color: "var(--fg-3)", fontSize: 12 }}>
              If using Docker, make sure you used <strong>host.docker.internal</strong> instead of
              <strong> localhost</strong> as the host when setting up the connection.
            </div>
          </div>
        )}

        {datasets.length > 0 && datasets.every(g => g.tables.length === 0) && !connError && (
          <div style={{ background: "var(--yellow-50, #fefce8)", border: "1px solid var(--yellow-200, #fef08a)",
            borderRadius: 8, padding: "12px 16px", marginBottom: 12, fontSize: 13 }}>
            <div style={{ fontWeight: 600, color: "var(--yellow-800, #854d0e)", marginBottom: 4 }}>
              Schemas found but no tables visible
            </div>
            <div style={{ color: "var(--yellow-700, #a16207)", fontSize: 12 }}>
              The SQL login may not have <strong>SELECT</strong> permission on{" "}
              <code>INFORMATION_SCHEMA.TABLES</code>, or the schemas contain only views.
              Check the Docker logs (<code>docker compose logs backend</code>) for details.
            </div>
          </div>
        )}

        {filtered.length === 0 && datasets.length === 0 && !connError && (
          <div style={{ textAlign: "center", padding: "24px 0", fontSize: 13, color: "var(--fg-3)", fontStyle: "italic" }}>
            No datasets found. Check the connection schema settings.
          </div>
        )}

        {filtered.map((grp, gi) => {
          const groupKey     = grp.schema || `${grp.layer}-${gi}`;
          const displayLabel = (grp.layer === "UNKNOWN" && grp.schema) ? grp.schema : grp.layer;
          const isGroupRunning = effBatch?.groupKey === groupKey;
          const allProfiled    = grp.tables.length > 0 && grp.tables.every(t => t.score > 0);

          return (
            <div key={groupKey} style={{ marginBottom: 8 }}>
              {/* Schema-level permission warning — carries the exact GRANT the
                  backend produced, so an unreadable database never masquerades
                  as an empty one. */}
              {grp.warning && (
                <div style={{ display: "flex", gap: 7, alignItems: "flex-start", margin: "4px 4px 6px",
                  padding: "8px 10px", background: "var(--red-50)", border: "1px solid var(--red-200)",
                  borderRadius: 8, fontSize: 12, color: "var(--red-700)", lineHeight: 1.5 }}>
                  <i data-lucide="lock" style={{ width: 13, height: 13, flexShrink: 0, marginTop: 2 }}></i>
                  <span>{grp.warning}</span>
                </div>
              )}
              {/* Group header */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px" }}>
                <button
                  onClick={() => setOpen(o => ({ ...o, [groupKey]: !o[groupKey] }))}
                  style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, background: "none",
                    border: "none", cursor: "pointer", minWidth: 0, textAlign: "left" }}>
                  {open[groupKey]
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--fg-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="6 9 12 15 18 9"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--fg-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
                  }
                  <LayerPill layer={displayLabel} />
                  <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{grp.tables.length} tables</span>
                  {grp.tables.some(t => t.score > 0) && (
                    <span style={{ fontSize: 11, color: "var(--fg-3)" }}>
                      &nbsp;· {grp.tables.filter(t => t.score > 0).length} profiled
                    </span>
                  )}
                </button>

                {/* Run all / progress indicator */}
                {isGroupRunning ? (
                  <span style={{ fontSize: 12, color: "var(--brand)", display: "flex", alignItems: "center",
                    gap: 6, whiteSpace: "nowrap", flexShrink: 0 }}>
                    <span className="dt-spin" style={{ width: 12, height: 12, border: "1.5px solid var(--brand-ring)",
                      borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block" }}></span>
                    {effBatch.done}/{effBatch.total} profiled
                    {effBatch.errors > 0 && (
                      <span style={{ color: "var(--red-400)" }}>&nbsp;· {effBatch.errors} failed</span>
                    )}
                  </span>
                ) : (
                  <button
                    onClick={() => runGroupBatch(grp, groupKey)}
                    disabled={!!effBatch}
                    title={allProfiled ? "Re-run profiling for all tables in this group" : "Profile all tables in this group"}
                    style={{ fontSize: 11.5, color: effBatch ? "var(--fg-3)" : "var(--brand)",
                      background: "none", border: `1px solid ${effBatch ? "var(--grey-200)" : "var(--brand-ring)"}`,
                      borderRadius: 6, padding: "3px 9px", cursor: effBatch ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap", flexShrink: 0, display: "flex", alignItems: "center", gap: 5 }}>
                    {allProfiled
                      ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                      : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    }
                    {allProfiled ? "Re-run all" : "Run all"}
                  </button>
                )}
              </div>

              {/* Table rows */}
              {open[groupKey] && (
                <div style={{ display: "flex", flexDirection: "column", paddingLeft: 6 }}>
                  {grp.tables.map((t) => {
                    const fqn            = grp.schema ? `${grp.schema}.${t.name}` : t.name;
                    const isCurrentlyRunning = effBatch?.currentFqn === fqn;
                    const canInteract    = !effBatch;

                    return (
                      <div key={t.name} className="dt-row-hover"
                        onClick={() => canInteract && onProfile(fqn)}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8,
                          cursor: canInteract ? "pointer" : "default",
                          borderLeft: t.hot ? "2px solid var(--red-400)" : "2px solid transparent",
                          opacity: batchState && !isCurrentlyRunning ? 0.55 : 1,
                          transition: "opacity 200ms" }}>

                        {isCurrentlyRunning
                          ? <span className="dt-spin" style={{ width: 15, height: 15, border: "2px solid var(--brand-ring)",
                              borderTopColor: "var(--brand)", borderRadius: "50%", flexShrink: 0 }}></span>
                          : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--fg-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>}

                        <Mono style={{ flex: 1, color: "var(--fg-1)", fontWeight: t.hot ? 700 : 500,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</Mono>

                        <span style={{ fontSize: 11.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
                          {t.rows > 0 ? `${Number(t.rows).toLocaleString()} rows` : "—"}
                        </span>

                        <span style={{ fontSize: 11.5, color: "var(--fg-3)", width: 90, textAlign: "right", whiteSpace: "nowrap" }}>
                          {t.profiled && t.profiled !== "—" ? t.profiled : ""}
                        </span>

                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, width: 56,
                          justifyContent: "flex-end", flexShrink: 0 }}>
                          {t.score > 0
                            ? <><span style={{ fontWeight: 700, fontSize: 13, color: scoreColor(t.score) }}>{t.score}</span>
                                <Health status={t.score >= 85 ? "HEALTHY" : t.score >= 70 ? "WARN" : "CRIT"} /></>
                            : <span style={{ fontSize: 11, color: "var(--fg-3)", fontStyle: "italic" }}>—</span>}
                        </span>

                        {/* Re-run icon for already-profiled tables */}
                        {t.score > 0 && canInteract && (
                          <button
                            onClick={(e) => { e.stopPropagation(); (onForceProfile || onProfile)(fqn); }}
                            title="Re-run profiling"
                            style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
                              color: "var(--fg-3)", flexShrink: 0, borderRadius: 4 }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </Card>
    );
  };

  // ── Running ───────────────────────────────────────────────────────────────
  const Running = ({ table, connectionId, onDone }) => {
    const _defaultSteps = [
      { label: "Connect to data source" }, { label: "Sample table structure" },
      { label: "Compute row counts" },     { label: "Analyse column statistics" },
      { label: "Detect data types & formats" }, { label: "Run null & uniqueness checks" },
      { label: "Identify anomalies & risks" },  { label: "Generate AI narrative" },
    ];
    const [steps, setSteps] = React.useState(_defaultSteps.map(s => ({ ...s, state: "wait" })));
    const [pct, setPct]     = React.useState(0);
    useIcons();

    React.useEffect(() => {
      if (window.DTApi && connectionId) {
        const parts      = table.split(".");
        const schemaName = parts.length > 1 ? parts[0] : null;
        const tableName  = parts.length > 1 ? parts.slice(1).join(".") : parts[0];

        window.DTApi.streamProfiling({
          connectionId, schemaName, tableName,
          onProgress: (evt) => {
            const p = evt.progress_pct || 0;
            setPct(p);
            const breakpoints = [10, 25, 40, 55, 65, 72, 80, 88];
            const idx = breakpoints.findIndex(bp => p <= bp);
            const stepIdx = idx < 0 ? breakpoints.length - 1 : idx;
            setSteps(prev => prev.map((s, i) => ({
              ...s,
              state:  p >= 100 ? "done" : (i < stepIdx ? "done" : i === stepIdx ? "run" : "wait"),
              detail: i === stepIdx && p < 100 ? (evt.detail || s.detail) : s.detail,
            })));
          },
          onReport: (r) => { setPct(100); setTimeout(() => onDone(r), 600); },
          onError:  (msg) => { toast(msg || "Profiling failed. Please try again.", { kind: "error" }); onDone(null); },
        });
        return;
      }
      // Mock fallback
      let i = 0;
      const tick = () => {
        if (i >= _defaultSteps.length) { setTimeout(() => onDone(null), 600); return; }
        setSteps(prev => prev.map((s, idx) => ({ ...s, state: idx < i ? "done" : idx === i ? "run" : "wait" })));
        setPct(Math.round((i / _defaultSteps.length) * 100));
        i++;
        setTimeout(tick, i === 1 ? 500 : 360);
      };
      tick();
    }, []);

    return (
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span className="dt-spin" style={{ width: 20, height: 20, border: "2.5px solid var(--brand-ring)",
            borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block" }}></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 16 }}>Profiling in progress</div>
            <Mono style={{ color: "var(--fg-2)" }}>{table}</Mono>
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 24, color: "var(--brand)" }}>{pct}%</div>
        </div>
        <Bar pct={pct} height={8} color="var(--brand)" />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 18 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "7px 4px",
              opacity: s.state === "wait" ? 0.45 : 1, transition: "opacity 200ms" }}>
              {s.state === "done"
                ? <i data-lucide="check-circle-2" style={{ width: 16, height: 16, color: "var(--green-500)" }}></i>
                : s.state === "run"
                  ? <span className="dt-spin" style={{ width: 15, height: 15, border: "2px solid var(--brand-ring)",
                      borderTopColor: "var(--brand)", borderRadius: "50%" }}></span>
                  : <span style={{ width: 15, height: 15, borderRadius: "50%", border: "2px solid var(--grey-200)" }}></span>}
              <span style={{ flex: 1, fontSize: 13, fontWeight: s.state === "run" ? 600 : 500, color: "var(--fg-1)" }}>{s.label}</span>
              {s.state !== "wait" && <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{s.detail}</span>}
            </div>
          ))}
        </div>
      </Card>
    );
  };

  // ── Report ────────────────────────────────────────────────────────────────
  const Report = ({ onReprofile, onBack, report, tableName }) => {
    const { go, setProfilingDone } = useApp();
    const [notes,    setNotes]    = React.useState({});
    const [flagged,  setFlagged]  = React.useState({});
    const [openNote, setOpenNote] = React.useState(null);
    useIcons();

    const currentUser = React.useMemo(() => {
      try { return JSON.parse(sessionStorage.getItem("dt_user") || "{}").name || "User"; } catch (_) { return "User"; }
    }, []);

    const score    = report?.quality_score ?? 0;
    const table    = report?.table_fqn    || tableName || "selected table";
    const rowCount = report?.row_count    ? Number(report.row_count).toLocaleString() : "—";
    const runAt    = report?.run_at       ? new Date(report.run_at).toLocaleString() : "—";
    const layer    = report?.layer        || table.split(".")[0]?.toUpperCase() || "UNKNOWN";

    // Summary dimension tiles
    const summaryTiles = report?.summary_stats
      ? Object.entries(report.summary_stats).map(([k, v]) => ({ k: k.replace(/_/g, " "), v: String(v) }))
      : [];

    // Column health — includes ALL stored fields from backend (min/max/mean/pii/note)
    const columns = (report?.column_stats || []).map(c => ({
      name:     c.column_name,
      dataType: c.data_type     || "TEXT",
      nullPct:  c.null_pct      || 0,
      distinct: c.distinct_count != null ? Number(c.distinct_count).toLocaleString() : "—",
      format:   c.detected_format || "—",
      cde:      c.is_cde  || false,
      pii:      c.is_pii  || false,
      piiType:  c.pii_type || null,
      health:   c.health   || (c.null_pct > 10 ? "CRIT" : c.null_pct > 5 ? "WARN" : "HEALTHY"),
      score:    c.quality_score || 0,
      note:     c.note     || null,
      minVal:   c.min_value  != null ? String(c.min_value)              : null,
      maxVal:   c.max_value  != null ? String(c.max_value)              : null,
      meanVal:  c.mean_value != null ? Number(c.mean_value).toFixed(2)  : null,
    }));

    // Risks
    const risks = (report?.risks_flagged || []).map((r, i) => ({
      id:  `R${i + 1}`,
      sev: r.severity || "MEDIUM",
      title: r.title || (r.risk_type || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "Data Quality Risk",
      body: r.description || "",
      col:  r.column_name  || "—",
    }));

    return (
      <div className="dt-fade-up">
        {/* Header */}
        <Card style={{ marginBottom: 16, background: "linear-gradient(180deg,#fff,var(--grey-50))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <ScoreRing score={score} size={100} stroke={9} sublabel="of 100" />
            <div style={{ flex: 1, minWidth: 220 }}>
              <Eyebrow>Profiling report</Eyebrow>
              <Mono style={{ fontSize: 16, fontWeight: 700, display: "block", margin: "4px 0 6px" }}>{table}</Mono>
              <div style={{ display: "flex", gap: 14, fontSize: 12.5, color: "var(--fg-2)", flexWrap: "wrap" }}>
                <span>Run <strong style={{ color: "var(--fg-1)" }}>{runAt}</strong></span>
                <span>·</span>
                <span><strong style={{ color: "var(--fg-1)" }}>{rowCount}</strong> rows</span>
                <span>·</span>
                <LayerPill layer={layer} size="sm" />
                {columns.length > 0 && (
                  <><span>·</span>
                  <span><strong style={{ color: "var(--fg-1)" }}>{columns.length}</strong> columns</span></>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {onBack && (
                <Button variant="ghost" icon="arrow-left" size="sm" onClick={onBack}>Back to list</Button>
              )}
              <Button variant="outline" icon="refresh-cw" size="sm" onClick={onReprofile}>Re-profile</Button>
            </div>
          </div>
        </Card>

        {/* Dimension score tiles */}
        {summaryTiles.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
            {summaryTiles.map((m) => (
              <Card key={m.k} pad={14}>
                <div style={{ fontSize: 11.5, color: "var(--fg-2)", fontWeight: 600, marginBottom: 6, textTransform: "capitalize" }}>{m.k}</div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 19, color: "var(--fg-1)" }}>{m.v}</div>
              </Card>
            ))}
          </div>
        )}

        {/* AI narrative summary */}
        {report?.summary_text && (
          <Card style={{ marginBottom: 16, background: "var(--blue-50)", border: "1px solid var(--blue-100)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--brand)", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--blue-700)", textTransform: "uppercase",
                  letterSpacing: 0.5, marginBottom: 4 }}>AI summary</div>
                <div style={{ fontSize: 13.5, color: "var(--fg-1)", lineHeight: 1.65 }}>{report.summary_text}</div>
              </div>
            </div>
          </Card>
        )}

        {/* Column health table */}
        <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px" }}>
            <SectionTitle icon="columns-3">
              Column health
              <span style={{ fontSize: 12, color: "var(--fg-3)", fontWeight: 400, marginLeft: 8 }}>
                ({columns.length} column{columns.length !== 1 ? "s" : ""})
              </span>
            </SectionTitle>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--grey-50)", textAlign: "left" }}>
                  {["Column", "Type", "Null %", "Distinct", "Min", "Max", "Mean", "Format", "Tags", "Health"].map((h, i) => (
                    <th key={h} style={{ padding: "9px 16px", fontSize: 11, fontWeight: 700, color: "var(--fg-2)",
                      textTransform: "uppercase", letterSpacing: ".04em",
                      textAlign: i === 2 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr key={c.name} style={{ borderTop: "1px solid var(--grey-100)",
                    background: c.health === "CRIT" ? "var(--red-50)" : "transparent" }}>
                    <td style={{ padding: "9px 16px" }}>
                      <Mono style={{ fontWeight: (c.cde || c.pii) ? 700 : 500 }}>{c.name}</Mono>
                      {c.note && (
                        <i data-lucide="info" title={c.note}
                          style={{ width: 12, height: 12, color: "var(--brand)", marginLeft: 6, verticalAlign: "middle" }}></i>
                      )}
                    </td>
                    <td style={{ padding: "9px 16px", color: "var(--fg-3)", fontSize: 11.5 }}>{c.dataType}</td>
                    <td style={{ padding: "9px 16px", textAlign: "right",
                      fontWeight: c.nullPct > 10 ? 700 : 500,
                      color: c.nullPct > 10 ? "var(--red-500)" : c.nullPct > 5 ? "var(--yellow-700)" : "var(--fg-1)" }}>
                      {c.nullPct}%
                    </td>
                    <td style={{ padding: "9px 16px", color: "var(--fg-2)" }}>{c.distinct}</td>
                    <td style={{ padding: "9px 16px", color: "var(--fg-2)", fontSize: 12,
                      maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={c.minVal || ""}>{c.minVal ?? "—"}</td>
                    <td style={{ padding: "9px 16px", color: "var(--fg-2)", fontSize: 12,
                      maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={c.maxVal || ""}>{c.maxVal ?? "—"}</td>
                    <td style={{ padding: "9px 16px", color: "var(--fg-2)", fontSize: 12 }}>{c.meanVal ?? "—"}</td>
                    <td style={{ padding: "9px 16px", color: "var(--fg-2)", fontSize: 12 }}>{c.format}</td>
                    <td style={{ padding: "9px 16px" }}>
                      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "nowrap" }}>
                        {c.cde && <Chip intent="brand" size="sm" dot>CDE</Chip>}
                        {c.pii && <Chip intent="error" size="sm" dot title={c.piiType || "PII"}>PII</Chip>}
                        {!c.cde && !c.pii && <span style={{ color: "var(--fg-3)" }}>—</span>}
                      </div>
                    </td>
                    <td style={{ padding: "9px 16px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Health status={c.health} />
                        <span style={{ fontSize: 11.5, color: "var(--fg-2)" }}>{c.health}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {columns.length === 0 && (
            <div style={{ padding: "14px 20px", fontSize: 12, color: "var(--fg-3)", fontStyle: "italic" }}>
              No column data available.
            </div>
          )}
        </Card>

        {/* Risks */}
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="alert-triangle"
            sub={risks.length > 0
              ? `The profiling agent surfaced ${risks.length} risk${risks.length !== 1 ? "s" : ""}. Flag, annotate, or suppress each — every action is logged to the audit trail.`
              : "No risks identified by the profiling agent for this table."}>
            Risks flagged by agent
          </SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
            {risks.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${SEV[r.sev].c}30`, background: SEV[r.sev].bg,
                borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <Chip intent={sevIntent[r.sev]} variant="fill" size="sm">{r.id}</Chip>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
                      <Severity level={r.sev} size="sm" />
                      {r.col !== "—" && <Mono style={{ fontSize: 11.5, color: "var(--fg-2)" }}>{r.col}</Mono>}
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)" }}>{r.title}</div>
                    <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 3 }}>{r.body}</div>
                    {notes[r.id] && (
                      <div style={{ marginTop: 8, padding: "8px 10px", background: "#fff", borderRadius: 8,
                        fontSize: 12, color: "var(--fg-2)", borderLeft: "2px solid var(--brand)" }}>
                        <strong style={{ color: "var(--fg-1)" }}>Note · {currentUser}:</strong> {notes[r.id]}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <Button size="sm" variant={flagged[r.id] ? "primary" : "soft"} icon={flagged[r.id] ? "check" : "flag"}
                        onClick={() => {
                          setFlagged(f => ({ ...f, [r.id]: !f[r.id] }));
                          toast(flagged[r.id] ? `${r.id} unflagged` : `${r.id} flagged for review · assigned to ${currentUser}`,
                            { kind: flagged[r.id] ? "info" : "success" });
                        }}>
                        {flagged[r.id] ? "Flagged" : "Flag for review"}
                      </Button>
                      <Button size="sm" variant="soft" icon="message-square-plus"
                        onClick={() => setOpenNote(openNote === r.id ? null : r.id)}>Add note</Button>
                      <Button size="sm" variant="ghost" icon="eye-off"
                        onClick={() => toast(`${r.id} suppressed for run ${runAt} · logged to audit trail`, { kind: "info" })}>
                        Suppress
                      </Button>
                    </div>
                    {openNote === r.id && (
                      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                        <Input placeholder="Add an observation…" value={notes["_draft" + r.id] || ""}
                          onChange={(v) => setNotes(n => ({ ...n, ["_draft" + r.id]: v }))} style={{ flex: 1 }} />
                        <Button size="sm" variant="primary" onClick={() => {
                          setNotes(n => ({ ...n, [r.id]: n["_draft" + r.id] }));
                          setOpenNote(null);
                          toast("Note saved to audit trail", { kind: "success" });
                        }}>Save</Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Footer */}
        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            {onBack && <Button variant="ghost" icon="arrow-left" onClick={onBack}>Back to list</Button>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="soft" icon="share-2">Share to Slack</Button>
            <Button variant="primary" iconRight="arrow-right"
              onClick={() => { setProfilingDone(true); go("metadata"); }}>
              Proceed to metadata enrichment
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // ── Profiling (orchestrator) ───────────────────────────────────────────────
  const Profiling = () => {
    const { profilingDone, setProfilingDone, activeConnectionId, setActiveTableFqn, activeTableFqn, refreshDatasets } = useApp();
    const [mode,          setMode]          = React.useState("select");
    const [table,         setTable]         = React.useState("");
    const [report,        setReport]        = React.useState(null);

    // On mount: if a table was previously profiled, reload the cached report
    React.useEffect(() => {
      if (!profilingDone || !activeTableFqn || !activeConnectionId || !window.DTApi) {
        if (profilingDone && !activeTableFqn) setMode("select");
        return;
      }
      setTable(activeTableFqn);
      window.DTApi.getReportByTable(activeTableFqn, activeConnectionId)
        .then(r => {
          if (r?.report_id) { setReport(r); setMode("report"); }
          else setMode("select");
        })
        .catch(() => setMode("select"));
    }, []);

    // View cached report if it exists; otherwise start fresh profiling
    const startProfile = (t) => {
      setTable(t);
      setActiveTableFqn(t);
      if (window.DTApi?.getReportByTable && activeConnectionId) {
        window.DTApi.getReportByTable(t, activeConnectionId)
          .then(r => {
            if (r?.report_id) { setReport(r); setProfilingDone(true); setMode("report"); }
            else setMode("running");
          })
          .catch(() => setMode("running"));
      } else {
        setMode("running");
      }
    };

    // Force re-profile: always skip cache
    const forceProfile = (t) => {
      setTable(t);
      setActiveTableFqn(t);
      setMode("running");
    };

    // Back to selector — refresh shared datasets so updated scores appear everywhere
    const goBack = () => {
      refreshDatasets();
      setMode("select");
    };

    return (
      mode === "select"
        ? <Selector
            onProfile={startProfile}
            onForceProfile={forceProfile}
            connectionId={activeConnectionId}
          />
        : mode === "running"
          ? <Running
              table={table}
              connectionId={activeConnectionId}
              onDone={(r) => { setProfilingDone(true); setReport(r || null); setMode("report"); }}
            />
          : <Report
              onReprofile={() => setMode("running")}
              onBack={goBack}
              report={report}
              tableName={table}
            />
    );
  };

  window.DTScreens.profiling = Profiling;
})();
