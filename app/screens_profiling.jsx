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
    const [configured, setConfigured]       = React.useState(false);
    const [windowMode, setWindowMode]       = React.useState("full");
    const [partitionColumn, setPartitionColumn] = React.useState("");
    const [customFrom, setCustomFrom]       = React.useState("");
    const [customTo, setCustomTo]           = React.useState("");
    const [lastRunAt, setLastRunAt]         = React.useState(null);
    useIcons();

    // Best-effort lookup of the last run's timestamp, to anchor "Since last run"
    React.useEffect(() => {
      if (window.DTApi?.getReportByTable && connectionId && table) {
        window.DTApi.getReportByTable(table, connectionId)
          .then(r => setLastRunAt(r?.run_at || null))
          .catch(() => setLastRunAt(null));
      }
    }, []);

    const WINDOW_PRESETS = [
      { id: "full",       label: "Full table",      hint: "Scan every row (default)" },
      { id: "24h",        label: "Last 24 hours",   hint: "Recent inserts/updates only" },
      { id: "7d",         label: "Last 7 days" },
      { id: "30d",        label: "Last 30 days" },
      { id: "since_last", label: "Since last run",
        hint: lastRunAt ? `From ${_fmtWhen(lastRunAt)}` : "No prior run for this table yet",
        disabled: !lastRunAt },
      { id: "custom",     label: "Custom range" },
    ];

    const computeWindow = () => {
      const now = new Date();
      const daysAgo = (n) => new Date(now.getTime() - n * 24 * 3600 * 1000).toISOString();
      if (windowMode === "24h")        return { windowFrom: daysAgo(1),  windowTo: now.toISOString() };
      if (windowMode === "7d")         return { windowFrom: daysAgo(7),  windowTo: now.toISOString() };
      if (windowMode === "30d")        return { windowFrom: daysAgo(30), windowTo: now.toISOString() };
      if (windowMode === "since_last") return { windowFrom: lastRunAt,  windowTo: now.toISOString() };
      if (windowMode === "custom")     return {
        windowFrom: customFrom ? new Date(customFrom).toISOString() : null,
        windowTo:   customTo   ? new Date(customTo).toISOString()   : null,
      };
      return { windowFrom: null, windowTo: null };   // full table
    };

    const needsColumn = windowMode !== "full";
    const canStart = !needsColumn || partitionColumn.trim().length > 0;

    React.useEffect(() => {
      if (!configured) return;
      if (window.DTApi && connectionId) {
        const parts      = table.split(".");
        const schemaName = parts.length > 1 ? parts[0] : null;
        const tableName  = parts.length > 1 ? parts.slice(1).join(".") : parts[0];
        const { windowFrom, windowTo } = computeWindow();

        window.DTApi.streamProfiling({
          connectionId, schemaName, tableName,
          partitionColumn: needsColumn ? partitionColumn.trim() : null,
          windowFrom, windowTo,
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
    }, [configured]);

    if (!configured) {
      return (
        <Card>
          <SectionTitle icon="calendar-range"
            sub="Windowed runs scan only recent data — faster and cheaper on large, frequently-updated tables. Full table is always safe as a baseline.">
            Configure this run
          </SectionTitle>
          <Mono style={{ display: "block", margin: "6px 0 16px", color: "var(--fg-2)" }}>{table}</Mono>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8, marginBottom: 16 }}>
            {WINDOW_PRESETS.map(p => (
              <button key={p.id} disabled={p.disabled} onClick={() => !p.disabled && setWindowMode(p.id)}
                style={{
                  textAlign: "left", padding: "10px 12px", borderRadius: 10,
                  cursor: p.disabled ? "not-allowed" : "pointer",
                  border: `1.5px solid ${windowMode === p.id ? "var(--brand)" : "var(--grey-200)"}`,
                  background: windowMode === p.id ? "var(--blue-50)" : "#fff",
                  opacity: p.disabled ? 0.45 : 1,
                }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{p.label}</div>
                {p.hint && <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>{p.hint}</div>}
              </button>
            ))}
          </div>
          {needsColumn && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8, alignItems: "flex-end" }}>
              <Input label="Date/timestamp column" placeholder="e.g. order_date, updated_at, created_at"
                value={partitionColumn} onChange={setPartitionColumn} style={{ flex: 1, minWidth: 240 }} />
              {windowMode === "custom" && (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>From</label>
                    <input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--grey-400)", fontSize: 14, fontFamily: "var(--font-ui)" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>To</label>
                    <input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--grey-400)", fontSize: 14, fontFamily: "var(--font-ui)" }} />
                  </div>
                </>
              )}
            </div>
          )}
          {needsColumn && !canStart && (
            <div style={{ fontSize: 12, color: "var(--amber-600, #d97706)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <i data-lucide="alert-triangle" style={{ width: 13, height: 13 }}></i>
              Enter the date/timestamp column to window on — an unknown or missing column falls back to a full-table scan.
            </div>
          )}
          <Button variant="primary" icon="play" disabled={!canStart} onClick={() => setConfigured(true)}>Start profiling</Button>
        </Card>
      );
    }

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

  // ── Report — Agentic Data Quality Workspace ─────────────────────────────────
  // Small, focused derivation of "why is this column flagged" from fields the
  // backend actually persists today (null_pct / distinct vs row_count / format).
  // The profiling agent computes a richer health_reasons list in-memory but it
  // isn't persisted yet (see backend/app/models/profiling.py ColumnStats) — this
  // is the honest client-side approximation until that lands.
  function _columnWhy(c, rowCount) {
    const reasons = [];
    if (c.nullPct >= 30) reasons.push(`${c.nullPct}% of rows are missing this value — too high to trust joins or aggregates on it.`);
    else if (c.nullPct >= 10) reasons.push(`${c.nullPct}% null — above the typical 5% comfort threshold.`);
    else if (c.nullPct >= 5) reasons.push(`${c.nullPct}% null — worth watching, not yet critical.`);
    if (rowCount > 0 && c.distinctRaw != null) {
      const ratio = c.distinctRaw / rowCount;
      if (ratio >= 0.98 && rowCount > 5) reasons.push("Every value is nearly unique — looks like a candidate key or identifier.");
      else if (ratio <= 0.02 && rowCount > 20) reasons.push("Very few distinct values relative to row count — likely a flag, status, or category column.");
    }
    if (c.format === "MIXED") reasons.push("Inconsistent value formats detected — some rows won't parse the same way as others.");
    return reasons;
  }

  const _fmtWhen = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso), diffH = (Date.now() - d.getTime()) / 3600000;
    if (diffH < 1) return "just now";
    if (diffH < 24) return `${Math.round(diffH)}h ago`;
    return `${Math.round(diffH / 24)}d ago`;
  };

  // Icon + label per risk_type — keeps DUPLICATE_KEY / REFERENTIAL_ORPHAN visually
  // distinct from generic null/format risks in the Risk & Action Center.
  const RISK_TYPE_META = {
    DUPLICATE_KEY:       { icon: "copy-x",         label: "Duplicate key" },
    REFERENTIAL_ORPHAN:  { icon: "unlink",         label: "Referential orphan" },
    NULL_HIGH:            { icon: "circle-off",     label: "High nulls" },
    NULL_MODERATE:        { icon: "circle-dashed",  label: "Moderate nulls" },
    FORMAT_MIXED:         { icon: "shuffle",        label: "Mixed format" },
  };

  // Renders sample_failed_records (list of {col: value} row dicts) as a compact table
  const SampleRecordsTable = ({ samples }) => {
    if (!samples || samples.length === 0) return null;
    const cols = Object.keys(samples[0]);
    return (
      <div style={{ marginTop: 8, overflowX: "auto", border: "1px solid var(--grey-200)", borderRadius: 8 }}>
        <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--grey-50)" }}>
              {cols.map(c => (
                <th key={c} style={{ textAlign: "left", padding: "5px 8px", fontWeight: 700, color: "var(--fg-2)", borderBottom: "1px solid var(--grey-200)" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {samples.map((row, i) => (
              <tr key={i} style={{ borderTop: i > 0 ? "1px solid var(--grey-100)" : "none" }}>
                {cols.map(c => (
                  <td key={c} style={{ padding: "5px 8px", fontFamily: "var(--font-mono, monospace)", color: "var(--fg-1)" }}>
                    {row[c] === null || row[c] === undefined ? <span style={{ color: "var(--fg-3)" }}>null</span> : String(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const MiniSpinner = () => (
    <span className="dt-spin" style={{ width: 13, height: 13, border: "2px solid var(--grey-200)",
      borderTopColor: "var(--fg-3)", borderRadius: "50%", display: "inline-block" }}></span>
  );

  // Tiny inline trend arrow for score/dimension tiles
  const TrendArrow = ({ delta, invert }) => {
    if (delta == null || delta === 0) return <span style={{ fontSize: 11, color: "var(--fg-3)" }}>· steady</span>;
    const good = invert ? delta < 0 : delta > 0;
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: good ? "var(--green-600)" : "var(--red-500)" }}>
        {delta > 0 ? "↑" : "↓"} {Math.abs(delta)}
      </span>
    );
  };

  const Report = ({ onReprofile, onBack, report, tableName }) => {
    const { go, setProfilingDone, activeConnectionId, activeConnectionName, setActiveTableFqn } = useApp();
    const [risks, setRisks] = React.useState([]);
    const [history, setHistory] = React.useState(null);   // {runs:[...], delta:{...}} | null while loading
    const [context, setContext] = React.useState(null);   // cross-module signals | null while loading
    const [expandedCol, setExpandedCol] = React.useState(null);
    const [showSuppressed, setShowSuppressed] = React.useState(false);
    const [riskBusy, setRiskBusy] = React.useState({});
    const [openRiskNote, setOpenRiskNote] = React.useState(null);
    const [openRiskSamples, setOpenRiskSamples] = React.useState({});
    const [riskNoteDraft, setRiskNoteDraft] = React.useState({});
    const [colSort, setColSort] = React.useState({ key: "health", dir: 1 });
    useIcons();

    const currentUser = React.useMemo(() => {
      try { return JSON.parse(sessionStorage.getItem("dt_user") || "{}").email || JSON.parse(sessionStorage.getItem("dt_user") || "{}").name || "User"; } catch (_) { return "User"; }
    }, []);

    const score    = report?.quality_score ?? 0;
    const table    = report?.table_fqn    || tableName || "selected table";
    const rowCountRaw = report?.row_count || 0;
    const rowCount = report?.row_count    ? Number(report.row_count).toLocaleString() : "—";
    const runAt    = report?.run_at       ? new Date(report.run_at).toLocaleString() : "—";
    const layer    = report?.layer        || table.split(".")[0]?.toUpperCase() || "UNKNOWN";
    const reportId = report?.report_id;

    // Fetch trend history + cross-module context once we have a real report to anchor them to
    React.useEffect(() => {
      setHistory(null); setContext(null);
      if (!table || table === "selected table" || !window.DTApi) return;
      if (window.DTApi.getReportHistory) {
        window.DTApi.getReportHistory(table, activeConnectionId, 14)
          .then(setHistory).catch(() => setHistory({ runs: [], delta: null }));
      }
      if (reportId && window.DTApi.getReportContext) {
        window.DTApi.getReportContext(reportId)
          .then(setContext).catch(() => setContext(null));
      }
    }, [reportId, table]);

    // Risks — now carrying real risk_id + persisted suppress/note state from the backend
    React.useEffect(() => {
      setRisks((report?.risks_flagged || []).map((r, i) => ({
        id: `R${i + 1}`, riskId: r.risk_id || null,
        sev: r.severity || "MEDIUM",
        type: r.risk_type || null,
        title: r.title || (r.risk_type || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "Data Quality Risk",
        body: r.description || "", col: r.column_name || "—",
        suppressed: !!r.is_suppressed, suppressedBy: r.suppressed_by || null,
        suppressionReason: r.suppression_reason || null, note: r.note || null,
        samples: Array.isArray(r.sample_failed_records) ? r.sample_failed_records : [],
      })));
    }, [report]);

    // Summary dimension tiles — now trend-aware via history.delta
    const dimDeltas = history?.delta || {};
    const summaryTiles = report?.summary_stats
      ? Object.entries(report.summary_stats)
          .filter(([k]) => k !== "quality_score" && k !== "row_count" && k !== "total_columns")
          .map(([k, v]) => ({ k: k.replace(/_/g, " "), v: String(v) }))
      : [];

    // Column health — includes ALL stored fields from backend (min/max/mean/pii/note/sample_values)
    const columns = (report?.column_stats || []).map(c => {
      const nullPct = c.null_pct || 0;
      const cObj = {
        name:     c.column_name,
        dataType: c.data_type     || "TEXT",
        nullPct,
        distinctRaw: c.distinct_count,
        distinct: c.distinct_count != null ? Number(c.distinct_count).toLocaleString() : "—",
        format:   c.detected_format || "—",
        cde:      c.is_cde  || false,
        pii:      c.is_pii  || false,
        piiType:  c.pii_type || null,
        health:   c.health   || (nullPct > 10 ? "CRIT" : nullPct > 5 ? "WARN" : "HEALTHY"),
        score:    c.quality_score || 0,
        note:     c.note     || null,
        minVal:   c.min_value  != null ? String(c.min_value)              : null,
        maxVal:   c.max_value  != null ? String(c.max_value)              : null,
        meanVal:  c.mean_value != null ? Number(c.mean_value).toFixed(2)  : null,
        stdDev:   c.std_dev    != null ? Number(c.std_dev).toFixed(2)     : null,
        topValues: Array.isArray(c.sample_values) ? c.sample_values.slice(0, 8) : [],
      };
      cObj.why = _columnWhy(cObj, rowCountRaw);
      const rc = context?.rules?.by_column?.[c.column_name];
      cObj.ruleTotal = rc?.total || 0;
      cObj.ruleActive = rc?.active || 0;
      cObj.hasDictEntry = !!context?.dictionary_by_column?.[c.column_name];
      return cObj;
    });

    const HEALTH_RANK = { CRIT: 0, WARN: 1, HEALTHY: 2 };
    const sortedColumns = [...columns].sort((a, b) => {
      const { key, dir } = colSort;
      let av, bv;
      if (key === "health") { av = HEALTH_RANK[a.health] ?? 3; bv = HEALTH_RANK[b.health] ?? 3; }
      else if (key === "nullPct") { av = a.nullPct; bv = b.nullPct; }
      else if (key === "rules") { av = a.ruleActive; bv = b.ruleActive; }
      else { av = (a.name || "").toLowerCase(); bv = (b.name || "").toLowerCase(); }
      if (av < bv) return -1 * dir; if (av > bv) return 1 * dir; return 0;
    });
    const toggleSort = (key) => setColSort(s => s.key === key ? { key, dir: -s.dir } : { key, dir: 1 });

    const visibleRisks = risks.filter(r => showSuppressed || !r.suppressed);
    const suppressedCount = risks.filter(r => r.suppressed).length;
    const critCount = columns.filter(c => c.health === "CRIT").length;
    const warnCount = columns.filter(c => c.health === "WARN").length;
    const noRuleCount = columns.filter(c => c.ruleTotal === 0).length;

    // ── Risk actions — real persistence, not local-state theater ─────────────
    const doSuppress = async (r) => {
      if (!r.riskId) { toast("This risk predates risk-level tracking — re-profile to enable actions on it", { kind: "info" }); return; }
      setRiskBusy(b => ({ ...b, [r.id]: true }));
      try {
        await window.DTApi.suppressRisk(r.riskId, r.suppressionReason);
        setRisks(rs => rs.map(x => x.id === r.id ? { ...x, suppressed: true, suppressedBy: currentUser } : x));
        toast(`${r.id} suppressed — logged to audit trail`, { kind: "info" });
      } catch (e) { toast(e?.message || "Suppress failed", { kind: "error" }); }
      setRiskBusy(b => ({ ...b, [r.id]: false }));
    };
    const doUnsuppress = async (r) => {
      if (!r.riskId) return;
      setRiskBusy(b => ({ ...b, [r.id]: true }));
      try {
        await window.DTApi.unsuppressRisk(r.riskId);
        setRisks(rs => rs.map(x => x.id === r.id ? { ...x, suppressed: false, suppressedBy: null } : x));
        toast(`${r.id} restored to active risks`, { kind: "success" });
      } catch (e) { toast(e?.message || "Restore failed", { kind: "error" }); }
      setRiskBusy(b => ({ ...b, [r.id]: false }));
    };
    const saveRiskNote = async (r) => {
      const note = (riskNoteDraft[r.id] || "").trim();
      if (!note || !r.riskId) { setOpenRiskNote(null); return; }
      setRiskBusy(b => ({ ...b, [r.id]: true }));
      try {
        await window.DTApi.noteRisk(r.riskId, note);
        setRisks(rs => rs.map(x => x.id === r.id ? { ...x, note } : x));
        toast("Note saved to audit trail", { kind: "success" });
      } catch (e) { toast(e?.message || "Note failed", { kind: "error" }); }
      setOpenRiskNote(null);
      setRiskBusy(b => ({ ...b, [r.id]: false }));
    };
    const createTaskFromRisk = async (r) => {
      if (!window.DTApi?.createTask) return;
      setRiskBusy(b => ({ ...b, [r.id]: true }));
      try {
        await window.DTApi.createTask({
          title: `Investigate: ${r.title} (${table})`,
          description: r.body || null,
          priority: r.sev === "CRITICAL" ? "CRITICAL" : r.sev === "HIGH" ? "HIGH" : "MEDIUM",
          owner: currentUser,
          related_entity_type: "profiling_risk",
          related_entity_id: r.riskId || `${table}:${r.col}`,
          connection_id: activeConnectionId || null,
        });
        toast("Task created — find it on the Task Board", { kind: "success" });
      } catch (e) { toast(e?.message || "Task creation failed", { kind: "error" }); }
      setRiskBusy(b => ({ ...b, [r.id]: false }));
    };

    const goToRules = () => { setActiveTableFqn?.(table); setProfilingDone(true); go("rules"); };
    const goToAnomalies = () => { setActiveTableFqn?.(table); go("anomalies"); };
    const goToImpact = () => { setActiveTableFqn?.(table); go("impact"); };
    const goToDictionary = () => { setActiveTableFqn?.(table); setProfilingDone(true); go("metadata"); };

    const promoteToCde = async (colName) => {
      const colId = context?.dictionary_by_column?.[colName];
      if (!colId) {
        toast(`${colName} isn't in the data dictionary yet — enrich metadata first, then promote it to a CDE`, { kind: "info" });
        goToDictionary();
        return;
      }
      try {
        await window.DTApi.cdePromote(colId, "promote", { promoted_by: currentUser });
        toast(`${colName} promoted to Critical Data Element`, { kind: "success" });
      } catch (e) { toast(e?.message || "Promote failed", { kind: "error" }); }
    };

    // History chart data (score over time) — LineChart divides by (n-1), needs 2+ points
    const scoreSeries = (history?.runs || []).map(r => ({ value: Math.round(r.quality_score) }));
    const rowSeries = (history?.runs || []).map(r => r.row_count);

    return (
      <div className="dt-fade-up">
        {/* ── Header: identity, live trend, primary actions ─────────────────── */}
        <Card style={{ marginBottom: 16, background: "linear-gradient(180deg,#fff,var(--grey-50))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <ScoreRing score={score} size={100} stroke={9} sublabel="of 100" />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <Eyebrow>Data quality workspace{activeConnectionName ? ` · ${activeConnectionName}` : ""}</Eyebrow>
              <Mono style={{ fontSize: 16, fontWeight: 700, display: "block", margin: "4px 0 6px" }}>{table}</Mono>
              <div style={{ display: "flex", gap: 14, fontSize: 12.5, color: "var(--fg-2)", flexWrap: "wrap", alignItems: "center" }}>
                <span>Run <strong style={{ color: "var(--fg-1)" }}>{_fmtWhen(report?.run_at)}</strong></span>
                <span>·</span>
                <span><strong style={{ color: "var(--fg-1)" }}>{rowCount}</strong> rows
                  {dimDeltas.row_count_delta_pct != null && dimDeltas.row_count_delta_pct !== 0 && (
                    <span style={{ marginLeft: 5, fontWeight: 700, color: Math.abs(dimDeltas.row_count_delta_pct) >= 20 ? "var(--red-500)" : "var(--fg-3)" }}>
                      ({dimDeltas.row_count_delta_pct > 0 ? "+" : ""}{dimDeltas.row_count_delta_pct}%)
                    </span>
                  )}
                </span>
                <span>·</span>
                <LayerPill layer={layer} size="sm" />
                {columns.length > 0 && (<><span>·</span><span><strong style={{ color: "var(--fg-1)" }}>{columns.length}</strong> columns</span></>)}
                {report?.is_partial_scan && (
                  <>
                    <span>·</span>
                    <Chip size="sm" intent="warning" icon="scan-line"
                      title={`Windowed on ${report.partition_column}: ${report.window_from ? new Date(report.window_from).toLocaleString() : "—"} → ${report.window_to ? new Date(report.window_to).toLocaleString() : "now"}`}>
                      Partial scan
                    </Chip>
                  </>
                )}
                {dimDeltas.score_delta != null && (
                  <>
                    <span>·</span>
                    <span style={{ fontWeight: 700, color: dimDeltas.score_delta > 0 ? "var(--green-600)" : dimDeltas.score_delta < 0 ? "var(--red-500)" : "var(--fg-3)" }}>
                      {dimDeltas.score_delta > 0 ? "↑" : dimDeltas.score_delta < 0 ? "↓" : "→"} {Math.abs(dimDeltas.score_delta)} vs last run
                    </span>
                  </>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {onBack && <Button variant="ghost" icon="arrow-left" size="sm" onClick={onBack}>Back to list</Button>}
              <Button variant="outline" icon="refresh-cw" size="sm" onClick={onReprofile}>Re-profile</Button>
              <Button variant="primary" icon="sparkles" size="sm" onClick={goToRules}>Generate rules</Button>
            </div>
          </div>
        </Card>

        {/* ── Since-last-run drift banner ────────────────────────────────────── */}
        {history?.runs?.length === 1 && (
          <Card style={{ marginBottom: 16, padding: "10px 16px", background: "var(--blue-50)", border: "1px solid var(--blue-100)", display: "flex", gap: 10, alignItems: "center", fontSize: 12.5 }}>
            <i data-lucide="flag" style={{ width: 15, height: 15, color: "var(--brand)" }}></i>
            <span><strong>Baseline established.</strong> This is the first profiling run for this table — future runs will show trend and drift against this one.</span>
          </Card>
        )}
        {history?.delta && (Math.abs(history.delta.score_delta) >= 3 || (history.delta.row_count_delta_pct != null && Math.abs(history.delta.row_count_delta_pct) >= 15)) && (
          <Card style={{ marginBottom: 16, padding: "10px 16px", background: history.delta.score_delta < 0 || (history.delta.row_count_delta_pct||0) < -15 ? "var(--red-50)" : "var(--green-50, #f0fdf4)",
            border: `1px solid ${history.delta.score_delta < 0 ? "var(--red-200)" : "var(--green-200, #bbf7d0)"}`, display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, flexWrap: "wrap" }}>
            <i data-lucide={history.delta.score_delta < 0 ? "trending-down" : "trending-up"} style={{ width: 15, height: 15, color: history.delta.score_delta < 0 ? "var(--red-500)" : "var(--green-600)" }}></i>
            <span>
              <strong>Since the last run ({_fmtWhen(history.delta.prev_run_at)}):</strong>{" "}
              score {history.delta.score_delta > 0 ? "improved" : "declined"} by {Math.abs(history.delta.score_delta)} points
              {history.delta.row_count_delta_pct != null && Math.abs(history.delta.row_count_delta_pct) >= 15 && (
                <> · row count {history.delta.row_count_delta > 0 ? "grew" : "dropped"} {Math.abs(history.delta.row_count_delta_pct)}%
                {history.delta.row_count_delta_pct <= -15 ? " — check for a silent ingestion failure" : ""}</>
              )}
            </span>
          </Card>
        )}
        {report?.schema_drift?.has_drift && (
          <Card style={{ marginBottom: 16, padding: "10px 16px", background: "var(--amber-50, #fffbeb)",
            border: "1px solid var(--amber-200, #fde68a)", display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5, flexWrap: "wrap" }}>
            <i data-lucide="git-compare" style={{ width: 15, height: 15, color: "var(--amber-600, #d97706)", marginTop: 1, flexShrink: 0 }}></i>
            <span>
              <strong>Schema drift detected</strong> since the last run ({_fmtWhen(history?.delta?.prev_run_at)}).
              {report.schema_drift.added.length > 0 && (
                <> · <strong>{report.schema_drift.added.length}</strong> column{report.schema_drift.added.length !== 1 ? "s" : ""} added: <Mono style={{ fontSize: 11.5 }}>{report.schema_drift.added.join(", ")}</Mono></>
              )}
              {report.schema_drift.dropped.length > 0 && (
                <> · <strong>{report.schema_drift.dropped.length}</strong> column{report.schema_drift.dropped.length !== 1 ? "s" : ""} dropped: <Mono style={{ fontSize: 11.5 }}>{report.schema_drift.dropped.join(", ")}</Mono></>
              )}
              {report.schema_drift.type_changed.length > 0 && (
                <> · <strong>{report.schema_drift.type_changed.length}</strong> type change{report.schema_drift.type_changed.length !== 1 ? "s" : ""}: {report.schema_drift.type_changed.map(t => `${t.column} (${t.old_type}→${t.new_type})`).join(", ")}</>
              )}
              {" "}Downstream rules and pipelines referencing changed columns may break — review before promoting this table.
            </span>
          </Card>
        )}

        {/* ── AI narrative summary ───────────────────────────────────────────── */}
        {report?.summary_text && (
          <Card style={{ marginBottom: 16, background: "var(--blue-50)", border: "1px solid var(--blue-100)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--brand)", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--blue-700)", textTransform: "uppercase",
                  letterSpacing: 0.5, marginBottom: 4 }}>Steward briefing — AI-generated</div>
                <div style={{ fontSize: 13.5, color: "var(--fg-1)", lineHeight: 1.65 }}>{report.summary_text}</div>
              </div>
            </div>
          </Card>
        )}

        {/* ── Cross-module signal bar — the "workspace" part ─────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16 }}>
          <button onClick={goToRules} style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--grey-100)", borderRadius: 12, padding: 14, background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <i data-lucide="shield-check" style={{ width: 14, height: 14, color: "var(--brand)" }}></i>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase" }}>Rule coverage</span>
            </div>
            {context ? (
              <>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20 }}>{context.rules.active}<span style={{ fontSize: 13, color: "var(--fg-3)", fontWeight: 500 }}>/{context.rules.total} active</span></div>
                <div style={{ fontSize: 11.5, color: noRuleCount > 0 ? "var(--yellow-700)" : "var(--fg-3)", marginTop: 2 }}>{noRuleCount > 0 ? `${noRuleCount} column${noRuleCount === 1 ? "" : "s"} with no rules →` : "Every column covered →"}</div>
              </>
            ) : <MiniSpinner />}
          </button>
          <button onClick={goToAnomalies} style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--grey-100)", borderRadius: 12, padding: 14, background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <i data-lucide="radar" style={{ width: 14, height: 14, color: "var(--orange-500)" }}></i>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase" }}>Open anomalies</span>
            </div>
            {context ? (
              <>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, color: context.anomalies.open_total > 0 ? "var(--red-500)" : "var(--fg-1)" }}>{context.anomalies.open_total}</div>
                <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2 }}>{context.anomalies.top[0] ? `${context.anomalies.top[0].type} · ${context.anomalies.top[0].severity} →` : "None on this table →"}</div>
              </>
            ) : <MiniSpinner />}
          </button>
          <button onClick={goToDictionary} style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--grey-100)", borderRadius: 12, padding: 14, background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <i data-lucide="book-open" style={{ width: 14, height: 14, color: "var(--purple-600, #7c3aed)" }}></i>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase" }}>CDEs &amp; dictionary</span>
            </div>
            {context ? (
              <>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20 }}>{context.cdes.length}</div>
                <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2 }}>{Object.keys(context.dictionary_by_column).length}/{columns.length} columns catalogued →</div>
              </>
            ) : <MiniSpinner />}
          </button>
          <button onClick={goToImpact} style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--grey-100)", borderRadius: 12, padding: 14, background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <i data-lucide="network" style={{ width: 14, height: 14, color: "var(--navy-500)" }}></i>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase" }}>Downstream impact</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20 }}>—</div>
            <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2 }}>Open Impact Graph →</div>
          </button>
          {context && context.open_tasks > 0 && (
            <button onClick={() => go("tasks")} style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--grey-100)", borderRadius: 12, padding: 14, background: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                <i data-lucide="list-checks" style={{ width: 14, height: 14, color: "var(--yellow-600)" }}></i>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase" }}>Open tasks</span>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20 }}>{context.open_tasks}</div>
              <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2 }}>View task board →</div>
            </button>
          )}
        </div>

        {/* ── Dimension score tiles with trend sparklines ────────────────────── */}
        {summaryTiles.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
            {summaryTiles.map((m) => (
              <Card key={m.k} pad={14}>
                <div style={{ fontSize: 11.5, color: "var(--fg-2)", fontWeight: 600, marginBottom: 6, textTransform: "capitalize" }}>{m.k}</div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 19, color: "var(--fg-1)" }}>{m.v}</div>
              </Card>
            ))}
          </div>
        )}

        {/* ── Score trend chart ───────────────────────────────────────────────── */}
        {scoreSeries.length >= 2 && (
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle icon="trending-up" sub={`Quality score across the last ${scoreSeries.length} profiling runs`}>Trend</SectionTitle>
            <LineChart data={scoreSeries} height={110} color="var(--brand)" yMin={Math.max(0, Math.min(...scoreSeries.map(d => d.value)) - 10)} yMax={100} />
          </Card>
        )}

        {/* ── Column Intelligence Grid ────────────────────────────────────────── */}
        <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <SectionTitle icon="columns-3" sub={`${critCount} critical · ${warnCount} warning · ${noRuleCount} with no rules`}>
              Column intelligence
              <span style={{ fontSize: 12, color: "var(--fg-3)", fontWeight: 400, marginLeft: 8 }}>({columns.length} columns)</span>
            </SectionTitle>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--grey-50)", textAlign: "left" }}>
                  {[["Column", "name"], ["Type", null], ["Null %", "nullPct"], ["Distinct", null], ["Format", null], ["Tags", null], ["Rules", "rules"], ["Health", "health"], ["", null]].map(([h, sortKey]) => (
                    <th key={h || "actions"} onClick={sortKey ? () => toggleSort(sortKey) : undefined}
                      style={{ padding: "9px 16px", fontSize: 11, fontWeight: 700, color: "var(--fg-2)",
                        textTransform: "uppercase", letterSpacing: ".04em", whiteSpace: "nowrap",
                        cursor: sortKey ? "pointer" : "default", userSelect: "none" }}>
                      {h}{sortKey && colSort.key === sortKey ? (colSort.dir === 1 ? " ↑" : " ↓") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedColumns.map((c) => (
                  <React.Fragment key={c.name}>
                    <tr onClick={() => setExpandedCol(x => x === c.name ? null : c.name)}
                      style={{ borderTop: "1px solid var(--grey-100)", cursor: "pointer",
                        background: c.health === "CRIT" ? "var(--red-50)" : expandedCol === c.name ? "var(--grey-50)" : "transparent" }}>
                      <td style={{ padding: "9px 16px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--fg-3)" strokeWidth="3" style={{ transform: expandedCol === c.name ? "rotate(90deg)" : "none", transition: "transform 120ms", flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
                          <Mono style={{ fontWeight: (c.cde || c.pii) ? 700 : 500 }}>{c.name}</Mono>
                          {c.note && <i data-lucide="info" title={c.note} style={{ width: 12, height: 12, color: "var(--brand)" }}></i>}
                        </span>
                      </td>
                      <td style={{ padding: "9px 16px", color: "var(--fg-3)", fontSize: 11.5 }}>{c.dataType}</td>
                      <td style={{ padding: "9px 16px",
                        fontWeight: c.nullPct > 10 ? 700 : 500,
                        color: c.nullPct > 10 ? "var(--red-500)" : c.nullPct > 5 ? "var(--yellow-700)" : "var(--fg-1)" }}>
                        {c.nullPct}%
                      </td>
                      <td style={{ padding: "9px 16px", color: "var(--fg-2)" }}>{c.distinct}</td>
                      <td style={{ padding: "9px 16px", color: "var(--fg-2)", fontSize: 12 }}>{c.format}</td>
                      <td style={{ padding: "9px 16px" }}>
                        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "nowrap" }}>
                          {c.cde && <Chip intent="brand" size="sm" dot>CDE</Chip>}
                          {c.pii && <Chip intent="error" size="sm" dot title={c.piiType || "PII"}>PII</Chip>}
                          {!c.cde && !c.pii && <span style={{ color: "var(--fg-3)" }}>—</span>}
                        </div>
                      </td>
                      <td style={{ padding: "9px 16px" }}>
                        {c.ruleTotal === 0
                          ? <Chip intent="warning" size="sm">No rules</Chip>
                          : <span style={{ fontSize: 12, color: "var(--fg-2)" }}>{c.ruleActive}/{c.ruleTotal} active</span>}
                      </td>
                      <td style={{ padding: "9px 16px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Health status={c.health} /><span style={{ fontSize: 11.5, color: "var(--fg-2)" }}>{c.health}</span>
                        </span>
                      </td>
                      <td style={{ padding: "9px 16px" }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 4 }}>
                          {c.ruleTotal === 0 && (
                            <button onClick={goToRules} title="Generate a rule for this column"
                              style={{ background: "none", border: "1px solid var(--brand-ring)", borderRadius: 6, padding: "3px 7px", cursor: "pointer", color: "var(--brand)", fontSize: 11 }}>+ Rule</button>
                          )}
                          {!c.cde && (
                            <button onClick={() => promoteToCde(c.name)} title="Promote to Critical Data Element"
                              style={{ background: "none", border: "1px solid var(--grey-200)", borderRadius: 6, padding: "3px 7px", cursor: "pointer", color: "var(--fg-2)", fontSize: 11 }}>+ CDE</button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedCol === c.name && (
                      <tr>
                        <td colSpan={9} style={{ padding: "14px 20px 18px 42px", background: "var(--grey-25, #fafafa)", borderTop: "1px dashed var(--grey-200)" }}>
                          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
                            <div style={{ display: "flex", gap: 20 }}>
                              {[["Min", c.minVal], ["Max", c.maxVal], ["Mean", c.meanVal], ["Std dev", c.stdDev]].filter(([, v]) => v != null).map(([k, v]) => (
                                <div key={k}>
                                  <div style={{ fontSize: 10.5, color: "var(--fg-3)", textTransform: "uppercase" }}>{k}</div>
                                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--font-display)" }}>{v}</div>
                                </div>
                              ))}
                            </div>
                            {c.topValues.length > 0 && (
                              <div style={{ flex: 1, minWidth: 220 }}>
                                <div style={{ fontSize: 10.5, color: "var(--fg-3)", textTransform: "uppercase", marginBottom: 6 }}>Most frequent values</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  {c.topValues.map((v, i) => <Mono key={i} style={{ fontSize: 11, background: "#fff", border: "1px solid var(--grey-200)", borderRadius: 6, padding: "3px 8px" }}>{String(v)}</Mono>)}
                                </div>
                              </div>
                            )}
                            {c.why.length > 0 && (
                              <div style={{ flex: 1, minWidth: 260 }}>
                                <div style={{ fontSize: 10.5, color: "var(--fg-3)", textTransform: "uppercase", marginBottom: 6 }}>Why this matters</div>
                                {c.why.map((w, i) => <div key={i} style={{ fontSize: 12.5, color: "var(--fg-1)", marginBottom: 3 }}>• {w}</div>)}
                              </div>
                            )}
                          </div>
                          {!c.hasDictEntry && (
                            <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--fg-3)" }}>
                              Not yet in the data dictionary — <button onClick={goToDictionary} style={{ color: "var(--brand)", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 11.5, fontWeight: 600 }}>enrich metadata →</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {columns.length === 0 && (
            <div style={{ padding: "14px 20px", fontSize: 12, color: "var(--fg-3)", fontStyle: "italic" }}>No column data available.</div>
          )}
        </Card>

        {/* ── Prioritized Risk & Action Center ────────────────────────────────── */}
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="alert-triangle"
            right={suppressedCount > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setShowSuppressed(s => !s)}>
                {showSuppressed ? "Hide" : "Show"} {suppressedCount} suppressed
              </Button>
            )}
            sub={risks.length > 0
              ? `The profiling agent surfaced ${risks.length} risk${risks.length !== 1 ? "s" : ""}. Every flag, note, and suppression here is persisted and logged to the audit trail.`
              : "No risks identified by the profiling agent for this table."}>
            Risks flagged by agent
          </SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
            {visibleRisks.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${SEV[r.sev].c}30`, background: r.suppressed ? "var(--grey-50)" : SEV[r.sev].bg,
                borderRadius: 12, padding: 14, opacity: r.suppressed ? 0.7 : 1 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <Chip intent={sevIntent[r.sev]} variant="fill" size="sm">{r.id}</Chip>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3, flexWrap: "wrap" }}>
                      <Severity level={r.sev} size="sm" />
                      {RISK_TYPE_META[r.type] && (
                        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--fg-2)" }}>
                          <i data-lucide={RISK_TYPE_META[r.type].icon} style={{ width: 12, height: 12 }}></i>
                          {RISK_TYPE_META[r.type].label}
                        </span>
                      )}
                      {r.col !== "—" && <Mono style={{ fontSize: 11.5, color: "var(--fg-2)" }}>{r.col}</Mono>}
                      {r.type === "REFERENTIAL_ORPHAN" && r.body.includes("inferred from naming") && (
                        <Chip size="sm" intent="warning" title="No declared foreign key found — this relationship was inferred from column naming, not confirmed by a schema constraint.">
                          Unverified relationship
                        </Chip>
                      )}
                      {r.suppressed && <Chip size="sm" intent="neutral" title={r.suppressionReason || undefined}>Suppressed by {r.suppressedBy}</Chip>}
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)" }}>{r.title}</div>
                    <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 3 }}>{r.body}</div>
                    {r.col !== "—" && context?.rules?.by_column?.[r.col] && (
                      <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 4 }}>
                        {context.rules.by_column[r.col].active > 0
                          ? `${context.rules.by_column[r.col].active} rule(s) already cover this column`
                          : "No rules currently cover this column"}
                      </div>
                    )}
                    {r.samples.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <button
                          onClick={() => setOpenRiskSamples(s => ({ ...s, [r.id]: !s[r.id] }))}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                            fontSize: 11.5, fontWeight: 600, color: "var(--brand)", display: "flex", alignItems: "center", gap: 4 }}>
                          <i data-lucide={openRiskSamples[r.id] ? "chevron-down" : "chevron-right"} style={{ width: 12, height: 12 }}></i>
                          {openRiskSamples[r.id] ? "Hide" : "Show"} {r.samples.length} failing record{r.samples.length !== 1 ? "s" : ""}
                        </button>
                        {openRiskSamples[r.id] && <SampleRecordsTable samples={r.samples} />}
                      </div>
                    )}
                    {r.note && (
                      <div style={{ marginTop: 8, padding: "8px 10px", background: "#fff", borderRadius: 8,
                        fontSize: 12, color: "var(--fg-2)", borderLeft: "2px solid var(--brand)" }}>
                        <strong style={{ color: "var(--fg-1)" }}>Note:</strong> {r.note}
                      </div>
                    )}
                    {!r.suppressed && (
                      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                        <Button size="sm" variant="soft" icon="sparkles" disabled={riskBusy[r.id]} onClick={goToRules}>Generate rule</Button>
                        <Button size="sm" variant="soft" icon="clipboard-list" disabled={riskBusy[r.id]} onClick={() => createTaskFromRisk(r)}>Create task</Button>
                        <Button size="sm" variant="soft" icon="message-square-plus" disabled={riskBusy[r.id]}
                          onClick={() => setOpenRiskNote(openRiskNote === r.id ? null : r.id)}>Add note</Button>
                        <Button size="sm" variant="ghost" icon="eye-off" disabled={riskBusy[r.id]} onClick={() => doSuppress(r)}>Suppress</Button>
                      </div>
                    )}
                    {r.suppressed && (
                      <div style={{ marginTop: 10 }}>
                        <Button size="sm" variant="ghost" icon="rotate-ccw" disabled={riskBusy[r.id]} onClick={() => doUnsuppress(r)}>Restore</Button>
                      </div>
                    )}
                    {openRiskNote === r.id && (
                      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                        <Input placeholder="Add an observation…" value={riskNoteDraft[r.id] || ""}
                          onChange={(v) => setRiskNoteDraft(n => ({ ...n, [r.id]: v }))} style={{ flex: 1 }} />
                        <Button size="sm" variant="primary" disabled={riskBusy[r.id]} onClick={() => saveRiskNote(r)}>Save</Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {visibleRisks.length === 0 && risks.length > 0 && (
              <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "8px 0" }}>All risks are suppressed. Click "Show suppressed" above to review them.</div>
            )}
          </div>
        </Card>

        {/* Footer */}
        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>{onBack && <Button variant="ghost" icon="arrow-left" onClick={onBack}>Back to list</Button>}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="soft" icon="share-2">Share to Slack</Button>
            <Button variant="primary" iconRight="arrow-right" onClick={goToDictionary}>Proceed to metadata enrichment</Button>
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
