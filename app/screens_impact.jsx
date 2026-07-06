// DataTrust — Screen: Downstream Impact Graph (live connection data only)
(function () {
  // ── Constants ──────────────────────────────────────────────────────────────
  const STC  = { fail: "var(--red-500)",    warn: "var(--yellow-500)", ok: "var(--green-500)"  };
  const STBG = { fail: "var(--red-50)",     warn: "var(--yellow-50)",  ok: "var(--green-50)"   };
  const LAYER_COL = { RAW: 0, BRONZE: 1, SILVER: 2, GOLD: 3, REPORT: 4, MODEL: 4 };
  const LAYER_LABEL = { 0: "RAW", 1: "BRONZE", 2: "SILVER", 3: "GOLD", 4: "REPORTS / MODELS", 5: "UNCLASSIFIED" };
  // A table with an UNKNOWN layer must not silently wear the REPORTS / MODELS
  // banner (seen live: DuckDB main.* tables under "REPORTS / MODELS") — give it
  // an honest UNCLASSIFIED column instead. Actual report/model NODE TYPES still
  // belong in column 4 even without a layer value.
  const colForNode = (n) => LAYER_COL[n.layer] ?? ((n.node_type === "report" || n.node_type === "model") ? 4 : 5);
  const NODE_W = 240, NODE_H = 84, COL_GAP = 180, ROW_GAP = 20, PAD_X = 20, PAD_Y = 48;
  const STALE_DAYS = 30;

  // last_profiled_at is None for report/model nodes (never profileable) as well
  // as genuinely-never-profiled tables — callers that care about the
  // distinction should also check node.layer/node_type; this just answers
  // "is the health_status shown here potentially out of date".
  function stalenessInfo(node) {
    if (!node.last_profiled_at) return { label: "Never profiled", stale: true, days: null };
    const days = Math.floor((Date.now() - new Date(node.last_profiled_at).getTime()) / 86400000);
    if (days <= 0) return { label: "Profiled today", stale: false, days };
    if (days === 1) return { label: "Profiled 1 day ago", stale: false, days };
    return { label: `Profiled ${days} days ago`, stale: days > STALE_DAYS, days };
  }

  // ── Layout engine ─────────────────────────────────────────────────────────
  const TIER_NODE_LIMIT = 8;

  // expandedTiers: Set of column indices (ci) the user has chosen to fully
  // expand. Without a cap, a single tier with hundreds of tables (a real
  // possibility as connections scale — this demo connection already has 15+
  // in one Bronze column) renders as an unusably tall canvas. Capping still
  // draws every EDGE correctly once a node is expanded back into view; edges
  // to a currently-hidden node are simply not drawn (see the `if (!src ||
  // !tgt) return null` guard below) rather than erroring.
  function computeLayout(nodes, expandedTiers) {
    expandedTiers = expandedTiers || new Set();
    const colMap = {};
    nodes.forEach(n => {
      const ci = colForNode(n);
      if (!colMap[ci]) colMap[ci] = [];
      colMap[ci].push(n);
    });
    Object.values(colMap).forEach(arr => arr.sort((a, b) => (a.position_order || 0) - (b.position_order || 0)));
    const colIndices = Object.keys(colMap).map(Number).sort((a, b) => a - b);
    if (!colIndices.length) return null;

    const visibleColMap = {};
    const hiddenCounts = {};
    colIndices.forEach(ci => {
      const full = colMap[ci];
      if (full.length > TIER_NODE_LIMIT && !expandedTiers.has(ci)) {
        visibleColMap[ci] = full.slice(0, TIER_NODE_LIMIT);
        hiddenCounts[ci] = full.length - TIER_NODE_LIMIT;
      } else {
        visibleColMap[ci] = full;
      }
    });

    const maxRows = Math.max(...Object.values(visibleColMap).map(a => a.length));
    const canvasH = Math.max(420, PAD_Y * 2 + maxRows * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP);
    const canvasW = PAD_X * 2 + colIndices.length * (NODE_W + COL_GAP) - COL_GAP;
    const layoutNodes = {}, tierLabels = [], tierHidden = [], tierCi = [];
    colIndices.forEach((ci, colRank) => {
      const colNodes = visibleColMap[ci];
      const totalH = colNodes.length * NODE_H + Math.max(0, colNodes.length - 1) * ROW_GAP;
      const startY = Math.max(PAD_Y, (canvasH - totalH) / 2);
      colNodes.forEach((n, rowRank) => {
        layoutNodes[n.external_id] = { ...n, x: PAD_X + colRank * (NODE_W + COL_GAP), y: startY + rowRank * (NODE_H + ROW_GAP), w: NODE_W, h: NODE_H, colRank };
      });
      tierLabels[colRank] = LAYER_LABEL[ci] || colNodes[0]?.tier_label || `Tier ${ci}`;
      tierHidden[colRank] = hiddenCounts[ci] || 0;
      tierCi[colRank] = ci;
    });
    return { layoutNodes, canvasW, canvasH, tierLabels, tierHidden, tierCi };
  }

  // ── Transitive reach — the blast radius (downstream) and root-cause trail
  //    (upstream) of one node, computed over confirmed edges. This is what a
  //    data engineer actually needs from the graph during an incident: not the
  //    direct neighbors, the FULL set of tables that can be affected/at fault.
  function computeReach(extId, edges) {
    const fwd = {}, back = {};
    edges.forEach(e => {
      (fwd[e.source_ext_id] = fwd[e.source_ext_id] || []).push(e.target_ext_id);
      (back[e.target_ext_id] = back[e.target_ext_id] || []).push(e.source_ext_id);
    });
    const bfs = (start, adj) => {
      const seen = new Set(); const q = [...(adj[start] || [])];
      while (q.length) { const cur = q.shift(); if (seen.has(cur)) continue; seen.add(cur); q.push(...(adj[cur] || [])); }
      return seen;
    };
    return { down: bfs(extId, fwd), up: bfs(extId, back) };
  }

  // ── DFS — compute root-to-leaf paths ─────────────────────────────────────
  function computePaths(nodes, edges) {
    const byExtId = {};
    nodes.forEach(n => { byExtId[n.external_id] = n; });
    const outEdges = {};
    edges.forEach(e => {
      if (!outEdges[e.source_ext_id]) outEdges[e.source_ext_id] = [];
      outEdges[e.source_ext_id].push(e.target_ext_id);
    });
    const inNodes = new Set(edges.map(e => e.target_ext_id));
    const roots = nodes.filter(n => !inNodes.has(n.external_id));
    const paths = [];
    function dfs(node, path) {
      // Cycle guard: if this node is already an ancestor on the CURRENT path,
      // stop here instead of recursing forever. Backend write-time checks
      // (would_create_cycle) should prevent a cycle from ever being confirmed,
      // but this is the last line of defense against hanging the browser tab
      // if one gets through some other way (e.g. legacy data from before that
      // check existed). Checking against `path` (not a global visited set) is
      // deliberate — the same node legitimately appears in multiple branches
      // from different roots; only a repeat within one chain is a real cycle.
      if (path.some(p => p.external_id === node.external_id)) {
        paths.push(path);
        return;
      }
      const newPath = [...path, node];
      const children = outEdges[node.external_id] || [];
      if (!children.length) { paths.push(newPath); return; }
      children.forEach(extId => { if (byExtId[extId]) dfs(byExtId[extId], newPath); });
    }
    roots.forEach(r => dfs(r, []));
    return paths;
  }

  // ── Empty state component ─────────────────────────────────────────────────
  const EmptyGraph = ({ hasConnection, seeding, onSeed, onAdd, onDiscover }) => (
    <Card style={{ marginTop: 16 }}>
      <div style={{ padding: "48px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <i data-lucide="network" style={{ width: 40, height: 40, color: "var(--grey-300)" }} />
        {!hasConnection ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-2)" }}>No connection selected</div>
            <div style={{ fontSize: 13, color: "var(--fg-3)", maxWidth: 400 }}>Select a data connection from the sidebar to view its downstream impact graph.</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-2)" }}>No lineage data for this connection</div>
            <div style={{ fontSize: 13, color: "var(--fg-3)", maxWidth: 480, lineHeight: 1.6 }}>
              Lineage nodes are created automatically when you profile a table. Discover real edges from
              foreign keys / query history / dbt, seed from existing profiling reports, or add nodes manually.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <Button icon="search" onClick={onDiscover}>Discover lineage</Button>
              <Button variant="outline" icon="database" onClick={onSeed} disabled={seeding}>
                {seeding ? "Seeding..." : "Seed from profiling reports"}
              </Button>
              <Button variant="outline" icon="plus" onClick={onAdd}>Add node manually</Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );

  // ── Discover lineage drawer ────────────────────────────────────────────────
  const DiscoverDrawer = ({ connectionId, onDone, onClose }) => {
    const [includeFk, setIncludeFk] = React.useState(true);
    const [includeQueryLog, setIncludeQueryLog] = React.useState(true);
    const [includeLlmFallback, setIncludeLlmFallback] = React.useState(false);
    const [manifestText, setManifestText] = React.useState("");
    const [running, setRunning] = React.useState(false);
    const [result, setResult] = React.useState(null);
    const [err, setErr] = React.useState("");
    useIcons();

    const handleRun = async () => {
      setErr(""); setResult(null);
      let dbtManifest = null;
      if (manifestText.trim()) {
        try { dbtManifest = JSON.parse(manifestText); }
        catch (e) { setErr("dbt manifest is not valid JSON: " + e.message); return; }
      }
      setRunning(true);
      try {
        const res = await window.DTApi.discoverLineage(connectionId, {
          include_fk: includeFk,
          include_query_log: includeQueryLog,
          include_llm_fallback: includeQueryLog && includeLlmFallback,
          dbt_manifest: dbtManifest,
        });
        setResult(res);
        onDone();
      } catch (e) {
        setErr(e.message);
      } finally {
        setRunning(false);
      }
    };

    return (
      <Card style={{ marginTop: 16, border: "2px solid var(--blue-200)" }}>
        <SectionTitle icon="search"
          sub="Finds real edges from FK constraints, SQL query-log parsing, and an optional dbt manifest — never guessed by an LLM. FK and dbt edges are ground truth and added immediately; query-log edges are heuristic and land in a review queue below the graph.">
          Discover lineage
        </SectionTitle>
        <div style={{ display: "flex", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={includeFk} onChange={e => setIncludeFk(e.target.checked)} />
            Foreign key constraints
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={includeQueryLog} onChange={e => setIncludeQueryLog(e.target.checked)} />
            Recent query history (7 days) — suggestions only, needs review
          </label>
        </div>
        {includeQueryLog && (
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, cursor: "pointer", marginTop: 10, color: "var(--fg-2)" }}>
            <input type="checkbox" checked={includeLlmFallback} onChange={e => setIncludeLlmFallback(e.target.checked)} />
            Also try an LLM on statements SQL parsing couldn't handle (dynamic SQL, stored procs) — uses an LLM call per statement, capped at 20 per run, still requires review
          </label>
        )}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>dbt manifest.json (optional — paste contents)</div>
          <textarea value={manifestText} onChange={e => setManifestText(e.target.value)}
            placeholder='{"nodes": {...}, "sources": {...}}'
            style={{ width: "100%", minHeight: 80, fontFamily: "monospace", fontSize: 11.5, padding: 8, borderRadius: 6, border: "1px solid var(--grey-200)", resize: "vertical" }} />
        </div>
        {err && <div style={{ marginTop: 8, color: "var(--red-500)", fontSize: 12.5 }}>{err}</div>}
        {result && (
          <div style={{ marginTop: 12, padding: 12, background: "var(--grey-50)", borderRadius: 8, fontSize: 12.5, lineHeight: 1.8 }}>
            {result.fk_error && (
              <div style={{ color: "var(--red-600)" }}>{result.fk_error}</div>
            )}
            <div>
              <strong>{result.fk_edges_found}</strong> edge(s) confirmed from foreign keys ({result.fk_schemas_scanned.length} schema(s) scanned)
              {result.fk_edges_found === 0 && result.fk_schemas_scanned.length > 0 && (
                <span style={{ color: "var(--fg-3)" }}>
                  {" "}— the scanned database(s) declare no FK constraints (common in warehouse/medallion schemas, where
                  cross-database pipelines can't use FKs). Query history and a dbt manifest are the discovery paths here.
                </span>
              )}
            </div>
            {result.dbt_provided && (
              <div><strong>{result.dbt_edges_found}</strong> edge(s) confirmed from dbt manifest ({result.dbt_models_scanned} model(s) scanned)</div>
            )}
            {result.query_log_enabled && (
              // Check the reason FIRST, not just query_log_supported: a platform can
              // genuinely support query-log discovery yet still fail this specific run
              // (e.g. a missing grant) — query_log_supported alone would hide that.
              result.query_log_unsupported_reason ? (
                <div style={{ color: "var(--yellow-700)" }}>Query-log discovery unavailable: {result.query_log_unsupported_reason}</div>
              ) : (
                <div><strong>{result.query_log_edges_found}</strong> edge(s) suggested from query history ({result.query_log_statements_scanned} statement(s) scanned, {result.query_log_parse_failures} not usable) — review below</div>
              )
            )}
            {result.llm_fallback_enabled && (
              result.llm_fallback_error ? (
                <div style={{ color: "var(--yellow-700)" }}>LLM fallback failed: {result.llm_fallback_error}</div>
              ) : result.llm_fallback_attempted > 0 ? (
                <div><strong>{result.llm_fallback_edges_found}</strong> edge(s) suggested by the LLM from {result.llm_fallback_attempted} unparseable statement(s){result.llm_fallback_skipped > 0 ? ` (${result.llm_fallback_skipped} more skipped past the per-run cap)` : ""} — review below</div>
              ) : (
                <div style={{ color: "var(--fg-3)" }}>No unparseable statements needed the LLM fallback this run.</div>
              )
            )}
            {result.edges_already_existed > 0 && <div style={{ color: "var(--fg-3)" }}>{result.edges_already_existed} already existed, skipped</div>}
            {result.nodes_created > 0 && <div>{result.nodes_created} new table(s) added to the graph</div>}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <Button size="sm" icon="search" onClick={handleRun} disabled={running}>{running ? "Discovering..." : "Run discovery"}</Button>
          <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
        </div>
      </Card>
    );
  };

  // ── Lineage health / completeness card ────────────────────────────────────
  // The leading indicator of whether discovery is actually providing value —
  // a module that finds zero edges everywhere is a much bigger problem than
  // any single discovery run's counts reveal on their own (see the earlier
  // finding: this connection sat at 0% for its entire history before FK/dbt/
  // query-log discovery existed, invisible without a metric like this).
  const DISCOVERED_VIA_LABEL = { manual: "Manual", fk: "Foreign keys", dbt: "dbt manifest", query_log: "Query log", query_log_llm: "Query log (LLM)" };

  const LineageHealthCard = ({ connectionId, refreshKey }) => {
    const [health, setHealth] = React.useState(null);
    useIcons();

    React.useEffect(() => {
      if (!connectionId) return;
      window.DTApi.getLineageHealth(connectionId)
        .then(setHealth)
        .catch(() => setHealth(null));
    }, [connectionId, refreshKey]);

    if (!health || health.total_known_tables === 0) return null;

    const pctColor = health.completeness_pct >= 60 ? "var(--green-500)" : health.completeness_pct >= 20 ? "var(--yellow-600)" : "var(--red-500)";
    const viaEntries = Object.entries(health.edges_by_discovered_via || {});

    return (
      <Card style={{ marginTop: 16 }}>
        <SectionTitle icon="activity" sub="How much of this connection's schema actually has traced lineage — the clearest signal of whether discovery is working, not just what the last run found.">
          Lineage coverage
        </SectionTitle>
        <div style={{ display: "flex", gap: 24, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, color: pctColor }}>{health.completeness_pct}%</div>
            <div style={{ fontSize: 10.5, color: "var(--fg-3)" }}>complete</div>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}>
            <strong>{health.tables_with_edges}</strong> of <strong>{health.total_known_tables}</strong> known tables have at least one traced edge
          </div>
          {viaEntries.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {viaEntries.map(([via, count]) => (
                <Chip key={via} size="sm" intent="neutral">{DISCOVERED_VIA_LABEL[via] || via}: {count}</Chip>
              ))}
            </div>
          )}
          {(health.suggested_pending > 0 || health.suggested_approved > 0 || health.suggested_rejected > 0) && (
            <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginLeft: "auto" }}>
              Query-log suggestions: <strong style={{ color: "var(--fg-1)" }}>{health.suggested_pending}</strong> pending,{" "}
              {health.suggested_approved} approved, {health.suggested_rejected} rejected
            </div>
          )}
        </div>
      </Card>
    );
  };

  // ── Suggested edges review panel ──────────────────────────────────────────
  const SuggestedEdgesPanel = ({ connectionId, refreshKey, onReviewed }) => {
    const [edges, setEdges] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [busyId, setBusyId] = React.useState(null);
    const [bulkBusy, setBulkBusy] = React.useState(false);
    useIcons();

    const load = React.useCallback(() => {
      if (!connectionId) { setLoading(false); return; }
      setLoading(true);
      window.DTApi.listSuggestedEdges(connectionId)
        .then(rows => setEdges(rows || []))
        .catch(() => setEdges([]))
        .finally(() => setLoading(false));
    }, [connectionId]);

    React.useEffect(() => { load(); }, [load, refreshKey]);

    const act = async (edgeId, action) => {
      setBusyId(edgeId);
      try {
        if (action === "approve") await window.DTApi.approveLineageEdge(edgeId);
        else await window.DTApi.rejectLineageEdge(edgeId);
        setEdges(es => es.filter(e => e.edge_id !== edgeId));
        toast(action === "approve" ? "Edge confirmed" : "Edge rejected", { kind: action === "approve" ? "success" : "neutral" });
        onReviewed?.();
      } catch (e) {
        toast("Failed: " + e.message, { kind: "error" });
      } finally {
        setBusyId(null);
      }
    };

    if (loading || edges.length === 0) return null;

    // Reviewing a discovery batch one row at a time is a real time sink (13
    // suggestions from a single run, seen live). Approve-all still respects the
    // backend's per-edge cycle re-check — an edge that would now close a cycle
    // fails individually and stays in the queue with an error toast.
    const approveAll = async () => {
      setBulkBusy(true);
      let ok = 0, failed = 0;
      for (const e of [...edges]) {
        try {
          await window.DTApi.approveLineageEdge(e.edge_id);
          ok++;
          setEdges(es => es.filter(x => x.edge_id !== e.edge_id));
        } catch (err) { failed++; }
      }
      setBulkBusy(false);
      toast(failed
        ? `${ok} edge(s) confirmed · ${failed} failed (likely cycle conflicts) — review the remaining rows`
        : `All ${ok} suggested edge(s) confirmed`, { kind: failed ? "warning" : "success" });
      onReviewed?.();
    };

    return (
      <Card style={{ marginTop: 16, border: "1.5px solid var(--yellow-200)" }}>
        <SectionTitle icon="search-check"
          sub="Discovered by parsing recent query history — a wrong edge is worse than a missing one, so these require your confirmation before appearing in the graph."
          right={edges.length > 1 && (
            <Button size="sm" variant="primary" icon="check-check" disabled={bulkBusy || busyId} onClick={approveAll}>
              {bulkBusy ? "Approving…" : `Approve all (${edges.length})`}
            </Button>
          )}>
          Suggested edges ({edges.length})
        </SectionTitle>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {edges.map(e => (
            <div key={e.edge_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", background: "var(--yellow-50)", borderRadius: 8, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Mono>{e.source_label}</Mono>
                  <i data-lucide="arrow-right" style={{ width: 13, height: 13, color: "var(--fg-3)" }} />
                  <Mono>{e.target_label}</Mono>
                  {e.confidence != null && (
                    <Chip size="sm" intent={e.confidence >= 0.8 ? "success" : e.confidence >= 0.6 ? "warning" : "danger"}>
                      {Math.round(e.confidence * 100)}%
                    </Chip>
                  )}
                  {e.discovered_via === "query_log_llm" && (
                    <Chip size="sm" intent="neutral" icon="sparkles" title="Extracted by an LLM from SQL the deterministic parser couldn't handle">LLM-assisted</Chip>
                  )}
                </div>
                {e.evidence && (
                  <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 500 }}>
                    {e.evidence}
                  </div>
                )}
              </div>
              <Button size="sm" variant="primary" icon="check" disabled={busyId === e.edge_id} onClick={() => act(e.edge_id, "approve")}>Approve</Button>
              <Button size="sm" variant="outline" icon="x" disabled={busyId === e.edge_id} onClick={() => act(e.edge_id, "reject")}>Reject</Button>
            </div>
          ))}
        </div>
      </Card>
    );
  };

  // ── Add Node Drawer ───────────────────────────────────────────────────────
  const AddNodeDrawer = ({ connectionId, onSave, onClose }) => {
    const [form, setForm] = React.useState({ external_id: "", label: "", layer: "GOLD", node_type: "table", health_status: "ok", note: "", sub_label: "" });
    const [saving, setSaving] = React.useState(false);
    const [err, setErr] = React.useState("");

    const handleSave = async () => {
      if (!form.external_id || !form.label) { setErr("External ID and Label are required."); return; }
      setSaving(true);
      try { await window.DTApi.createLineageNode({ ...form, connection_id: connectionId }); onSave(); }
      catch (e) { setErr(e.message); }
      finally { setSaving(false); }
    };

    const sel = (field, options) => (
      <select value={form[field]} onChange={e => setForm({ ...form, [field]: e.target.value })}
        style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--grey-200)", fontSize: 13, width: "100%", background: "#fff" }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );

    return (
      <Card style={{ marginTop: 16, border: "2px solid var(--blue-200)" }}>
        <SectionTitle icon="plus-circle">Add Lineage Node</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>External ID *</div>
            <Input value={form.external_id} onChange={value => setForm({ ...form, external_id: value })} placeholder="silver.orders_enriched" />
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>Display Label *</div>
            <Input value={form.label} onChange={value => setForm({ ...form, label: value })} placeholder="silver.orders_enriched" />
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>Layer</div>
            {sel("layer", ["RAW", "BRONZE", "SILVER", "GOLD", "REPORT", "MODEL"])}
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>Node Type</div>
            {sel("node_type", ["table", "report", "model", "source"])}
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>Initial Health</div>
            {sel("health_status", ["ok", "warn", "fail"])}
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>Note</div>
            <Input value={form.note} onChange={value => setForm({ ...form, note: value })} placeholder="Optional note" />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>Sub-label</div>
            <Input value={form.sub_label} onChange={value => setForm({ ...form, sub_label: value })} placeholder="e.g. net_revenue · 11.2% NULL" />
          </div>
        </div>
        {err && <div style={{ marginTop: 8, color: "var(--red-500)", fontSize: 12.5 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <Button size="sm" icon="plus" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Node"}</Button>
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    );
  };

  // ── Add Edge Drawer ────────────────────────────────────────────────────────
  const AddEdgeDrawer = ({ connectionId, nodes, onSave, onClose }) => {
    const sortedNodes = React.useMemo(() => [...nodes].sort((a, b) => a.label.localeCompare(b.label)), [nodes]);
    const [sourceExtId, setSourceExtId] = React.useState(sortedNodes[0]?.external_id || "");
    const [targetExtId, setTargetExtId] = React.useState(sortedNodes[1]?.external_id || sortedNodes[0]?.external_id || "");
    const [edgeType, setEdgeType] = React.useState("FEEDS");
    const [saving, setSaving] = React.useState(false);
    const [err, setErr] = React.useState("");

    const handleSave = async () => {
      setErr("");
      if (!sourceExtId || !targetExtId) { setErr("Choose both a source and a target table."); return; }
      if (sourceExtId === targetExtId) { setErr("Source and target must be different tables."); return; }
      setSaving(true);
      try {
        await window.DTApi.createLineageEdge({
          connection_id: connectionId, source_ext_id: sourceExtId,
          target_ext_id: targetExtId, edge_type: edgeType,
        });
        onSave();
      } catch (e) {
        // Backend rejects edges that would create a cycle with a clear 400 message —
        // surface it directly rather than a generic "failed to save" error.
        setErr(e.message);
      } finally {
        setSaving(false);
      }
    };

    const nodeSelect = (value, onChange) => (
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--grey-200)", fontSize: 13, width: "100%", background: "#fff" }}>
        {sortedNodes.map(n => <option key={n.node_id} value={n.external_id}>{n.label}</option>)}
      </select>
    );

    return (
      <Card style={{ marginTop: 16, border: "2px solid var(--blue-200)" }}>
        <SectionTitle icon="git-commit" sub="Feeds/transforms/aggregates relationships between two existing nodes. Rejected if it would create a cycle.">
          Add Lineage Edge
        </SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, marginTop: 12, alignItems: "end" }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>Source (feeds from)</div>
            {nodeSelect(sourceExtId, setSourceExtId)}
          </div>
          <i data-lucide="arrow-right" style={{ width: 16, height: 16, color: "var(--fg-3)", marginBottom: 8 }}></i>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>Target (feeds into)</div>
            {nodeSelect(targetExtId, setTargetExtId)}
          </div>
        </div>
        <div style={{ marginTop: 12, maxWidth: 200 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>Edge type</div>
          <select value={edgeType} onChange={e => setEdgeType(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--grey-200)", fontSize: 13, width: "100%", background: "#fff" }}>
            <option value="FEEDS">FEEDS</option>
            <option value="TRANSFORMS">TRANSFORMS</option>
            <option value="AGGREGATES">AGGREGATES</option>
          </select>
        </div>
        {err && <div style={{ marginTop: 8, color: "var(--red-500)", fontSize: 12.5 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <Button size="sm" icon="plus" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Edge"}</Button>
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    );
  };

  // ── Node Detail Panel ─────────────────────────────────────────────────────
  const SEVERITY_INTENT = { low: "success", medium: "warning", high: "warning", critical: "danger" };

  const NodePanel = ({ node, connectionId, go, onClose, onUpdate, onDelete, edges = [], nodes = [], onJump, onViewReport, reach = null }) => {
    // Direct neighbors from the confirmed graph — the first thing a data engineer
    // needs when a table goes red: what feeds it (root-cause direction) and what
    // it feeds (blast-radius direction). Clicking a neighbor jumps the panel there.
    const byExt = React.useMemo(() => Object.fromEntries(nodes.map(x => [x.external_id, x])), [nodes]);
    const upstream   = edges.filter(e => e.target_ext_id === node.external_id).map(e => byExt[e.source_ext_id]).filter(Boolean);
    const downstream = edges.filter(e => e.source_ext_id === node.external_id).map(e => byExt[e.target_ext_id]).filter(Boolean);
    const neighborChip = (n) => (
      <button key={n.node_id} onClick={() => onJump?.(n)}
        title={`Jump to ${n.label}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontFamily: "var(--font-mono, monospace)",
          color: "var(--fg-1)", background: STBG[n.health_status] || "var(--grey-50)",
          border: `1px solid ${STC[n.health_status] || "var(--grey-200)"}`, borderRadius: 999,
          padding: "3px 10px", cursor: "pointer" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: STC[n.health_status] || "var(--grey-300)", flexShrink: 0 }}></span>
        {n.label}
      </button>
    );
    const [editing, setEditing] = React.useState(false);
    const [note, setNote] = React.useState(node.note || "");
    const [health, setHealth] = React.useState(node.health_status);
    const [saving, setSaving] = React.useState(false);
    const [narrative, setNarrative] = React.useState(null);
    const [narrativeLoading, setNarrativeLoading] = React.useState(false);
    const [narrativeErr, setNarrativeErr] = React.useState("");
    useIcons();

    const handleSave = async () => {
      setSaving(true);
      try { await onUpdate(node.node_id, { note, health_status: health }); setEditing(false); }
      finally { setSaving(false); }
    };

    const handleExplain = async () => {
      setNarrativeLoading(true); setNarrativeErr(""); setNarrative(null);
      try {
        const res = await window.DTApi.getImpactNarrative(connectionId, node.external_id);
        setNarrative(res);
      } catch (e) {
        setNarrativeErr(e.message);
      } finally {
        setNarrativeLoading(false);
      }
    };

    const canDrillDown = connectionId && node.layer && ["RAW", "BRONZE", "SILVER", "GOLD"].includes(node.layer);

    return (
      <Card style={{ marginTop: 16, border: "2px solid var(--blue-200)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--fg-1)", marginBottom: 4 }}>{node.label}</div>
            <Mono style={{ fontSize: 11, color: "var(--fg-3)" }}>{node.external_id}</Mono>
          </div>
          <Button size="sm" variant="ghost" icon="x" onClick={onClose} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginTop: 14, fontSize: 12.5 }}>
          <div><div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 3 }}>LAYER</div><div style={{ fontWeight: 600 }}>{node.layer || "—"}</div></div>
          <div><div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 3 }}>TYPE</div><div style={{ fontWeight: 600 }}>{node.node_type}</div></div>
          <div><div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 3 }}>HEALTH</div><Health status={node.health_status === "fail" ? "FAIL" : node.health_status === "warn" ? "WARN" : "PASS"} /></div>
          <div>
            <div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 3 }}>PROFILED</div>
            <div style={{ fontWeight: 600, color: stalenessInfo(node).stale ? "var(--yellow-700)" : "var(--fg-1)" }} title={stalenessInfo(node).stale ? "Health status shown here may be out of date" : ""}>
              {stalenessInfo(node).label}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-3)", letterSpacing: ".04em", marginBottom: 6 }}>
              FED BY ({upstream.length} direct{reach && reach.up.size > upstream.length ? ` · ${reach.up.size} total upstream` : ""}) — root-cause direction
            </div>
            {upstream.length
              ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{upstream.map(neighborChip)}</div>
              : <div style={{ fontSize: 12, color: "var(--fg-3)" }}>No known upstream feeds — this is a source (or lineage is incomplete).</div>}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-3)", letterSpacing: ".04em", marginBottom: 6 }}>
              FEEDS INTO ({downstream.length} direct{reach && reach.down.size > downstream.length ? ` · ${reach.down.size} total downstream` : ""}) — blast radius
            </div>
            {downstream.length
              ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{downstream.map(neighborChip)}</div>
              : <div style={{ fontSize: 12, color: "var(--fg-3)" }}>No known downstream dependents recorded yet.</div>}
          </div>
        </div>
        {node.sub_label && <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--fg-2)" }}>{node.sub_label}</div>}
        {node.note && !editing && <div style={{ marginTop: 6, fontSize: 12, color: STC[node.health_status] || "var(--fg-3)", fontWeight: 500 }}>{node.note}</div>}
        {editing ? (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>Note</div>
              <Input value={note} onChange={value => setNote(value)} placeholder="Add a note..." />
            </div>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>Health Status</div>
              <select value={health} onChange={e => setHealth(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--grey-200)", fontSize: 13, background: "#fff" }}>
                <option value="ok">OK</option><option value="warn">WARN</option><option value="fail">FAIL</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button size="sm" icon="check" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" variant="primary" icon="sparkles" onClick={handleExplain} disabled={narrativeLoading}>
              {narrativeLoading ? "Explaining..." : "Explain impact"}
            </Button>
            <Button size="sm" variant="outline" icon="edit-2" onClick={() => setEditing(true)}>Edit</Button>
            {canDrillDown && (
              <Button size="sm" variant="outline" icon="bar-chart-2" onClick={() => { onViewReport?.(node.external_id); go("profiling"); }}>View Report</Button>
            )}
            <Button size="sm" variant="outline" icon="trash-2" onClick={() => onDelete(node.node_id)}
              style={{ color: "var(--red-500)", borderColor: "var(--red-200)" }}>Delete</Button>
          </div>
        )}

        {narrativeErr && <div style={{ marginTop: 10, color: "var(--red-500)", fontSize: 12.5 }}>{narrativeErr}</div>}

        {narrative && (
          <div className="dt-fade-up" style={{ marginTop: 14, padding: 14, background: "var(--grey-50)", borderRadius: 10, border: "1px solid var(--grey-100)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <i data-lucide="sparkles" style={{ width: 14, height: 14, color: "var(--purple-500, #a855f7)" }}></i>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-1)" }}>Impact summary</span>
              <Chip size="sm" intent={SEVERITY_INTENT[narrative.severity] || "neutral"}>{narrative.severity}</Chip>
              {narrative.generated_via === "template" && (
                <Chip size="sm" intent="neutral" title="LLM was unavailable — showing a deterministic summary instead">fallback</Chip>
              )}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--fg-1)", lineHeight: 1.7 }}>
              {narrative.bullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        )}
      </Card>
    );
  };

  // ── Main Screen ───────────────────────────────────────────────────────────
  const Impact = () => {
    const { activeConnectionId, go, activeTableFqn, setActiveTableFqn } = useApp();
    const [step, setStep] = React.useState(0);
    const [graphData, setGraphData] = React.useState(null);   // null = not yet loaded
    const [loading, setLoading] = React.useState(true);
    const [seeding, setSeeding] = React.useState(false);
    const [filter, setFilter] = React.useState("all");
    const [search, setSearch] = React.useState("");
    const [selectedNode, setSelectedNode] = React.useState(null);
    const [showAddNode, setShowAddNode] = React.useState(false);
    const [showAddEdge, setShowAddEdge] = React.useState(false);
    const [showDiscover, setShowDiscover] = React.useState(false);
    const [suggestedRefreshKey, setSuggestedRefreshKey] = React.useState(0);
    const timersRef = React.useRef([]);
    const svgContainerRef = React.useRef(null);
    useIcons();

    const runAnimation = React.useCallback(() => {
      timersRef.current.forEach(clearTimeout);
      setStep(1);
      timersRef.current = [
        setTimeout(() => setStep(2), 700),
        setTimeout(() => setStep(3), 1500),
      ];
    }, []);

    React.useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

    const loadGraph = React.useCallback(async (silent = false) => {
      // silent=true skips the full-page spinner: Impact's `if (loading) return (...)`
      // unmounts the ENTIRE tree, including any open drawer (e.g. DiscoverDrawer),
      // wiping its local state (like a just-received discovery result) before the
      // user ever sees it. Callers refreshing the graph after a background action
      // (discovery, edge approval) must pass silent=true.
      if (!silent) setLoading(true);
      setStep(0);
      setSelectedNode(null);
      if (!activeConnectionId) {
        setGraphData(null);
        if (!silent) setLoading(false);
        return;
      }
      try {
        const data = await window.DTApi.getConnectionLineage(activeConnectionId);
        setGraphData(data && data.nodes && data.nodes.length > 0 ? data : { source_table: "", nodes: [], edges: [] });
      } catch (e) {
        setGraphData({ source_table: "", nodes: [], edges: [] });
        toast("Could not load the lineage graph — " + (e?.message || "check backend"), { kind: "error" });
      }
      if (!silent) setLoading(false);
    }, [activeConnectionId]);

    React.useEffect(() => { loadGraph(); }, [loadGraph]);

    React.useEffect(() => {
      if (graphData && graphData.nodes && graphData.nodes.length > 0) runAnimation();
    }, [graphData]);

    const handleSeed = async () => {
      if (!activeConnectionId) return;
      setSeeding(true);
      try {
        await window.DTApi.seedLineage(activeConnectionId);
        await loadGraph();
      } catch (e) {
        toast("Seed failed: " + e.message, { kind: "error" });
      } finally {
        setSeeding(false);
      }
    };

    const handleExportSVG = () => {
      const svg = svgContainerRef.current?.querySelector("svg");
      if (!svg) return;
      const clone = svg.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("width", "100%"); bg.setAttribute("height", "100%"); bg.setAttribute("fill", "white");
      clone.insertBefore(bg, clone.firstChild);
      const url = URL.createObjectURL(new Blob([clone.outerHTML], { type: "image/svg+xml" }));
      const a = document.createElement("a");
      a.href = url; a.download = "impact-graph.svg"; a.click();
      URL.revokeObjectURL(url);
    };

    const [expandedTiers, setExpandedTiers] = React.useState(() => new Set());
    const layout = React.useMemo(
      () => graphData?.nodes?.length ? computeLayout(graphData.nodes, expandedTiers) : null,
      [graphData, expandedTiers]
    );
    const paths  = React.useMemo(() => graphData?.nodes?.length ? computePaths(graphData.nodes, graphData.edges) : [], [graphData]);

    const filteredIds = React.useMemo(() => {
      if (!graphData?.nodes) return new Set();
      return new Set(graphData.nodes.filter(n => {
        if (filter !== "all" && n.health_status !== filter) return false;
        if (search && !n.label.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }).map(n => n.external_id));
    }, [graphData, filter, search]);

    // Selecting a node spotlights its full transitive reach: everything it can
    // break (downstream) and everything that can have broken it (upstream).
    const reach = React.useMemo(() => {
      if (!selectedNode || !graphData?.edges) return null;
      return computeReach(selectedNode.external_id, graphData.edges);
    }, [selectedNode, graphData]);
    const inSpotlight = React.useCallback((extId) => {
      if (!reach) return true;
      return extId === selectedNode.external_id || reach.down.has(extId) || reach.up.has(extId);
    }, [reach, selectedNode]);

    const counts = React.useMemo(() => {
      const nonRoot = graphData?.nodes?.filter(n => !n.is_source) || [];
      return { fail: nonRoot.filter(n => n.health_status === "fail").length, warn: nonRoot.filter(n => n.health_status === "warn").length };
    }, [graphData]);

    const impactNotes = React.useMemo(() =>
      graphData?.nodes?.filter(n => !n.is_source && n.note && n.note.includes("$")) || [], [graphData]);

    // Ranked, multi-root-aware — computed server-side from real edge topology
    // (a failing node with no failing ancestor, ranked by downstream blast
    // radius). Replaces the old single-guess heuristic (first is_source node
    // that's failing), which could only ever report one cause and would miss
    // a second, independent failure entirely.
    const [rootCauses, setRootCauses] = React.useState([]);
    React.useEffect(() => {
      if (!activeConnectionId || !graphData?.nodes?.length) { setRootCauses([]); return; }
      window.DTApi.getLineageRootCauses(activeConnectionId)
        .then(rows => setRootCauses(rows || []))
        .catch(() => setRootCauses([]));
    }, [activeConnectionId, graphData]);

    const nodeActive = extId => {
      const ln = layout?.layoutNodes[extId];
      if (!ln) return false;
      return ln.colRank === 0 ? step >= 1 : ln.colRank === 1 ? step >= 2 : step >= 3;
    };

    // Cross-module handoff: "View impact" on an anomaly (or any screen that sets
    // activeTableFqn before navigating here) lands with that table's node already
    // selected, so FED BY / FEEDS INTO answer the incident question immediately.
    // Once per mount (ref guard) — background graph reloads must not re-select a
    // node the user has since deselected.
    const autoSelectedRef = React.useRef(false);
    React.useEffect(() => {
      if (autoSelectedRef.current || !activeTableFqn || !graphData?.nodes?.length) return;
      autoSelectedRef.current = true;
      const match = graphData.nodes.find(n => n.external_id === activeTableFqn);
      if (match) {
        setSelectedNode(match);
        // The panel renders below the graph canvas — bring it into view so the
        // FED BY / FEEDS INTO answer is the first thing the arriving user sees.
        setTimeout(() => document.getElementById("impact-node-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 450);
      } else {
        toast(`${activeTableFqn} isn't in the lineage graph yet — run Discover lineage or seed from profiling reports.`, { kind: "info" });
      }
    }, [graphData, activeTableFqn]);

    React.useEffect(() => {
      const onKey = (e) => { if (e.key === "Escape") setSelectedNode(null); };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, []);

    const hasNodes = graphData?.nodes?.length > 0;

    if (loading) {
      return (
        <div className="dt-fade-up">
          <Card><div style={{ padding: 48, textAlign: "center", color: "var(--fg-3)", fontSize: 14 }}>Loading impact graph...</div></Card>
        </div>
      );
    }

    return (
      <div className="dt-fade-up">
        {/* ── Header ── */}
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="network"
            sub="Trace a data quality failure from its source through every dependent table, dashboard, report, and ML model — downstream impact in real time."
            right={hasNodes ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button size="sm" variant="outline" icon="search" onClick={() => setShowDiscover(v => !v)}>Discover lineage</Button>
                <Button size="sm" variant="outline" icon="download" onClick={handleExportSVG}>Export SVG</Button>
                <Button size="sm" variant="outline" icon="play" onClick={runAnimation}>Replay</Button>
              </div>
            ) : null}>
            Downstream Impact Graph
          </SectionTitle>

          {hasNodes && (
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              <Chip intent={counts.fail > 0 ? "danger" : "success"} dot>{counts.fail} blocked</Chip>
              <Chip intent={counts.warn > 0 ? "warning" : "success"} dot>{counts.warn} degraded</Chip>
              {impactNotes.map(n => <Chip key={n.node_id} intent="neutral" icon="dollar-sign">{n.note}</Chip>)}
            </div>
          )}

          {rootCauses.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {rootCauses.map(rc => (
                <div key={rc.node_id} style={{ padding: "8px 14px", background: "var(--red-50)", borderRadius: 8, border: "1px solid var(--red-200)", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
                  <i data-lucide="alert-triangle" style={{ width: 14, height: 14, color: "var(--red-500)", flexShrink: 0 }} />
                  <span>
                    <strong>Root cause:</strong> {rc.label}
                    {rc.downstream_impact_count > 0
                      ? ` → ${rc.downstream_impact_count} downstream table${rc.downstream_impact_count !== 1 ? "s" : ""} affected`
                      : " → no downstream dependents recorded (isolated failure)"}
                  </span>
                </div>
              ))}
              {rootCauses.length > 1 && (
                <div style={{ fontSize: 11.5, color: "var(--fg-3)", paddingLeft: 4 }}>
                  {rootCauses.length} independent root causes detected — these are not related to each other via the current lineage graph.
                </div>
              )}
            </div>
          )}
        </Card>

        {activeConnectionId && (
          <LineageHealthCard connectionId={activeConnectionId} refreshKey={suggestedRefreshKey} />
        )}

        {/* ── No data → empty state ── */}
        {!hasNodes && (
          <EmptyGraph
            hasConnection={!!activeConnectionId}
            seeding={seeding}
            onSeed={handleSeed}
            onAdd={() => setShowAddNode(true)}
            onDiscover={() => setShowDiscover(true)}
          />
        )}

        {/* ── Discover lineage drawer ── */}
        {showDiscover && activeConnectionId && (
          <DiscoverDrawer
            connectionId={activeConnectionId}
            onDone={async () => { await loadGraph(true); setSuggestedRefreshKey(k => k + 1); }}
            onClose={() => setShowDiscover(false)}
          />
        )}

        {/* ── Add node drawer (shown even when graph is empty) ── */}
        {showAddNode && activeConnectionId && (
          <AddNodeDrawer
            connectionId={activeConnectionId}
            onSave={async () => { setShowAddNode(false); await loadGraph(); }}
            onClose={() => setShowAddNode(false)}
          />
        )}

        {/* ── Add edge drawer (needs at least 2 existing nodes to connect) ── */}
        {showAddEdge && activeConnectionId && hasNodes && (
          <AddEdgeDrawer
            connectionId={activeConnectionId}
            nodes={graphData.nodes}
            onSave={async () => { setShowAddEdge(false); await loadGraph(); setSuggestedRefreshKey(k => k + 1); }}
            onClose={() => setShowAddEdge(false)}
          />
        )}

        {/* ── Suggested edges awaiting review (shown regardless of hasNodes — a
             fresh connection can have suggestions from discovery before any
             node was manually seeded) ── */}
        {activeConnectionId && (
          <SuggestedEdgesPanel
            connectionId={activeConnectionId}
            refreshKey={suggestedRefreshKey}
            onReviewed={() => {
              loadGraph(true);
              // The coverage card keys off this too — without the bump its
              // pending/approved/rejected counts and completeness % sit stale
              // after every review action (seen live: "16 pending" after 2 reviews).
              setSuggestedRefreshKey(k => k + 1);
            }}
          />
        )}

        {/* ── Filter bar + graph (shown only when there are nodes) ── */}
        {hasNodes && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
              {[["all", "All"], ["fail", "FAIL"], ["warn", "WARN"], ["ok", "OK"]].map(([f, label]) => (
                <Button key={f} size="sm" variant={filter === f ? "primary" : "outline"} onClick={() => setFilter(f)}>{label}</Button>
              ))}
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search nodes..."
                style={{ marginLeft: 4, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--grey-200)", fontSize: 12.5, outline: "none", minWidth: 160, color: "var(--fg-1)" }} />
              <Button size="sm" icon="git-commit" variant="outline" onClick={() => setShowAddEdge(v => !v)} style={{ marginLeft: "auto" }}>
                Add Edge
              </Button>
              <Button size="sm" icon="plus" variant="outline" onClick={() => setShowAddNode(v => !v)}>
                Add Node
              </Button>
            </div>

            {/* ── Graph canvas ── */}
            {layout && (
              <Card style={{ overflowX: "auto", padding: "20px 24px 28px" }}>
                <div style={{ display: "flex", marginBottom: 12 }}>
                  {layout.tierLabels.map((label, i) => (
                    <div key={i} style={{ width: NODE_W + COL_GAP, flexShrink: 0 }}>
                      <Eyebrow>{label}</Eyebrow>
                      {layout.tierHidden[i] > 0 && (
                        <button
                          onClick={() => setExpandedTiers(prev => new Set(prev).add(layout.tierCi[i]))}
                          style={{ display: "block", marginTop: 4, fontSize: 11, color: "var(--brand)", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                          + {layout.tierHidden[i]} more (showing {TIER_NODE_LIMIT} of {TIER_NODE_LIMIT + layout.tierHidden[i]})
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div ref={svgContainerRef} style={{ position: "relative", width: layout.canvasW, height: layout.canvasH, margin: "0 auto" }}>
                  <svg width={layout.canvasW} height={layout.canvasH}
                    style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
                    {graphData.edges.map((e, i) => {
                      const src = layout.layoutNodes[e.source_ext_id];
                      const tgt = layout.layoutNodes[e.target_ext_id];
                      if (!src || !tgt) return null;
                      const isActive = step > src.colRank;
                      const tgtNode = graphData.nodes.find(n => n.external_id === e.target_ext_id);
                      const dimmed = ((search || filter !== "all") && !filteredIds.has(e.source_ext_id) && !filteredIds.has(e.target_ext_id))
                        || (reach && !(inSpotlight(e.source_ext_id) && inSpotlight(e.target_ext_id)));
                      const x1 = src.x + src.w, y1 = src.y + src.h / 2;
                      const x2 = tgt.x,          y2 = tgt.y + tgt.h / 2;
                      const mx = (x1 + x2) / 2;
                      return (
                        <path key={i}
                          d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                          fill="none"
                          stroke={isActive ? STC[tgtNode?.health_status || "ok"] : "var(--grey-200)"}
                          strokeWidth={isActive ? 2.5 : 1.5}
                          strokeDasharray={isActive ? "6 4" : "0"}
                          opacity={dimmed ? 0.08 : isActive ? 1 : 0.4}
                          style={{ transition: "stroke 350ms, opacity 350ms", animation: isActive ? "dtFlow 700ms linear infinite" : "none" }}
                        />
                      );
                    })}
                  </svg>

                  {graphData.nodes.map(n => {
                    const ln = layout.layoutNodes[n.external_id];
                    if (!ln) return null;
                    const active = nodeActive(n.external_id);
                    const dimmed = ((filter !== "all" || search) && !filteredIds.has(n.external_id))
                      || (reach && !inSpotlight(n.external_id));
                    const isSelected = selectedNode?.external_id === n.external_id;
                    return (
                      <div key={n.node_id}
                        onClick={() => setSelectedNode(isSelected ? null : n)}
                        style={{
                          position: "absolute", left: ln.x, top: ln.y, width: ln.w, height: ln.h,
                          background: active ? STBG[n.health_status] : "#fff", borderRadius: 12,
                          border: isSelected ? "2px solid var(--blue-500)" : `1.5px solid ${active ? STC[n.health_status] : "var(--grey-200)"}`,
                          boxShadow: active && n.health_status === "fail" ? `0 0 0 4px ${STC.fail}22, var(--shadow-card)` : isSelected ? "0 0 0 3px var(--blue-100), var(--shadow-card)" : "var(--shadow-card)",
                          padding: "10px 14px", transition: "all 350ms cubic-bezier(0.2,0,0,1)",
                          opacity: dimmed ? 0.15 : active ? 1 : 0.5,
                          cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "center",
                          animation: active && n.health_status === "fail" ? "dtFlash 600ms ease" : "none",
                          overflow: "hidden",
                        }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                          <Health status={active ? (n.health_status === "fail" ? "FAIL" : n.health_status === "warn" ? "WARN" : "PASS") : "OK"} />
                          <Mono style={{ fontSize: 11.5, fontWeight: 700, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{n.label}</Mono>
                          {n.node_type === "table" && stalenessInfo(n).stale && (
                            <i data-lucide="clock" title={`${stalenessInfo(n).label} — health status shown may be out of date`}
                              style={{ width: 12, height: 12, color: "var(--yellow-600)", flexShrink: 0 }}></i>
                          )}
                        </div>
                        {(n.sub_label || n.note) && (
                          <div style={{ fontSize: 11, color: active ? STC[n.health_status] : "var(--fg-3)", fontWeight: active && n.health_status !== "ok" ? 600 : 500, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {n.sub_label || n.note}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* ── Node detail panel ── */}
            {selectedNode && (
              <div id="impact-node-panel">
              <NodePanel
                node={selectedNode}
                connectionId={activeConnectionId}
                edges={graphData.edges}
                nodes={graphData.nodes}
                reach={reach}
                onJump={(n) => setSelectedNode(n)}
                onViewReport={(fqn) => setActiveTableFqn?.(fqn)}
                go={go}
                onClose={() => setSelectedNode(null)}
                onUpdate={async (nodeId, data) => {
                  await window.DTApi.updateLineageNode(nodeId, data);
                  setSelectedNode(null);
                  await loadGraph();
                }}
                onDelete={async (nodeId) => {
                  if (!confirm(`Delete node "${selectedNode.label}"?`)) return;
                  await window.DTApi.deleteLineageNode(nodeId);
                  setSelectedNode(null);
                  setSuggestedRefreshKey(k => k + 1);
                  await loadGraph();
                }}
              />
              </div>
            )}

            {/* ── Lineage paths ── */}
            <Card style={{ marginTop: 16 }}>
              <SectionTitle icon="git-fork">Lineage paths</SectionTitle>
              {!paths.length ? (
                <div style={{ color: "var(--fg-3)", fontSize: 13 }}>Add edges between nodes to see lineage paths.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 }}>
                  {[...paths].sort((a, b) => {
                    const s = { fail: 0, warn: 1, ok: 2 };
                    return (s[a[a.length - 1]?.health_status] ?? 3) - (s[b[b.length - 1]?.health_status] ?? 3);
                  }).map((path, pi) => {
                    const leaf = path[path.length - 1];
                    return (
                      <div key={pi} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg-2)", flexWrap: "wrap" }}>
                        {path.map((node, ni) => (
                          <React.Fragment key={node.node_id}>
                            <Mono style={{ fontSize: 12, color: ni === path.length - 1 ? STC[node.health_status] : "var(--fg-2)", fontWeight: ni === path.length - 1 ? 700 : 500 }}>
                              {node.label}
                            </Mono>
                            {ni < path.length - 1 && <i data-lucide="chevron-right" style={{ width: 13, height: 13, color: "var(--fg-3)", flexShrink: 0 }} />}
                          </React.Fragment>
                        ))}
                        {leaf.note && <Chip intent={leaf.health_status === "fail" ? "danger" : "warning"} size="sm">{leaf.note}</Chip>}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    );
  };

  window.DTScreens.impact = Impact;
})();
