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
  const NODE_W = 232, NODE_H = 32, COL_GAP = 110, ROW_GAP = 7, PAD_X = 12, PAD_Y = 34;
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
  const TIER_NODE_LIMIT = 40;

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
      tierLabels[colRank] = `${LAYER_LABEL[ci] || colNodes[0]?.tier_label || `Tier ${ci}`} (${colMap[ci].length})`;
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
    // How far back to mine query history. The old hardcoded 7 days silently
    // found NOTHING on a warehouse whose ETL last ran 18 days earlier (seen
    // live — "discovery not working") — batch pipelines routinely run weekly
    // or monthly, so default to 90 days and let the user widen to a year.
    const [logDays, setLogDays] = React.useState(90);
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
          query_log_hours: logDays * 24,
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
            Query history from the last
            <select value={logDays} onChange={e => setLogDays(Number(e.target.value))}
              disabled={!includeQueryLog}
              style={{ padding: "2px 6px", borderRadius: 6, border: "1px solid var(--grey-200)", fontSize: 12.5, background: "#fff" }}>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>12 months</option>
            </select>
            — suggestions only, needs review
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
                <div>
                  <strong>{result.edges_suggested}</strong> new edge(s) suggested from query history
                  ({result.query_log_statements_scanned} statement(s) scanned, {result.query_log_parse_failures} not usable)
                  {result.edges_suggested > 0 ? " — review below" : result.query_log_edges_found > 0 ? " — every relationship found is already in the graph or queue" : ""}
                </div>
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
            {result.column_mappings_found > 0 && (
              <div><strong>{result.column_mappings_found}</strong> column-level mapping(s) extracted (see a table's panel → Column-level lineage)</div>
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

    // Inline stat strip, not a card of its own: coverage is context, not a
    // destination — it belongs on the same line as blocked/degraded, leaving
    // the vertical space to the graph (the actual hero of this screen).
    const pctColor = health.completeness_pct >= 60 ? "var(--green-600)" : health.completeness_pct >= 20 ? "var(--yellow-700)" : "var(--red-600)";

    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg-2)" }}
        title={Object.entries(health.edges_by_discovered_via || {}).map(([v, c]) => `${DISCOVERED_VIA_LABEL[v] || v}: ${c}`).join(" · ") || "no traced edges yet"}>
        <span style={{ color: "var(--grey-300)" }}>|</span>
        <strong style={{ color: pctColor }}>{health.completeness_pct}%</strong>
        lineage traced ({health.tables_with_edges}/{health.total_known_tables} tables)
        {health.suggested_pending > 0 && (
          <span style={{ color: "var(--yellow-700)", fontWeight: 600 }}>· {health.suggested_pending} suggestion{health.suggested_pending !== 1 ? "s" : ""} awaiting review ↓</span>
        )}
      </span>
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
    // Column-level lineage — loaded lazily per node; cheap indexed lookup.
    const [colLineage, setColLineage] = React.useState(null);
    const [colOpen, setColOpen] = React.useState(false);
    React.useEffect(() => {
      setColLineage(null); setColOpen(false);
      if (!connectionId || !node?.external_id || !window.DTApi?.getColumnLineage) return;
      window.DTApi.getColumnLineage(connectionId, node.external_id)
        .then(setColLineage)
        .catch(() => setColLineage(null));
    }, [connectionId, node?.external_id]);
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
        {colLineage && (colLineage.fed_by.length > 0 || colLineage.feeds.length > 0) && (
          <div style={{ marginTop: 12 }}>
            <button onClick={() => setColOpen(v => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700,
                color: "var(--brand)", background: "none", border: "none", cursor: "pointer", padding: 0,
                letterSpacing: ".03em" }}>
              <i data-lucide={colOpen ? "chevron-down" : "chevron-right"} style={{ width: 12, height: 12 }}></i>
              COLUMN-LEVEL LINEAGE ({colLineage.fed_by.length} column{colLineage.fed_by.length !== 1 ? "s" : ""} traced in
              · {colLineage.feeds.length} traced out)
            </button>
            {colOpen && (
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  {colLineage.fed_by.length > 0 && (
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--fg-3)", marginBottom: 5 }}>
                      THIS TABLE'S COLUMNS ← SOURCE COLUMNS
                    </div>
                  )}
                  {colLineage.fed_by.map(entry => (
                    <div key={entry.column_name} style={{ fontSize: 11.5, marginBottom: 4, lineHeight: 1.5 }}>
                      <Mono style={{ fontWeight: 700 }}>{entry.column_name}</Mono>
                      <span style={{ color: "var(--fg-3)" }}> ← </span>
                      {entry.related.map((r, i) => (
                        <span key={i}>
                          {i > 0 && <span style={{ color: "var(--fg-3)" }}>, </span>}
                          <Mono style={{ color: "var(--fg-2)" }} title={r.table_fqn}>{r.table_fqn.split(".").pop()}.{r.column_name}</Mono>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
                <div>
                  {colLineage.feeds.length > 0 && (
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--fg-3)", marginBottom: 5 }}>
                      THIS TABLE'S COLUMNS → DOWNSTREAM COLUMNS
                    </div>
                  )}
                  {colLineage.feeds.map(entry => (
                    <div key={entry.column_name} style={{ fontSize: 11.5, marginBottom: 4, lineHeight: 1.5 }}>
                      <Mono style={{ fontWeight: 700 }}>{entry.column_name}</Mono>
                      <span style={{ color: "var(--fg-3)" }}> → </span>
                      {entry.related.map((r, i) => (
                        <span key={i}>
                          {i > 0 && <span style={{ color: "var(--fg-3)" }}>, </span>}
                          <Mono style={{ color: "var(--fg-2)" }} title={r.table_fqn}>{r.table_fqn.split(".").pop()}.{r.column_name}</Mono>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
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
    // Diagram/JSON dual view: the JSON editor IS the graph, round-trippable.
    const [viewMode, setViewMode] = React.useState("diagram");   // diagram | json
    const [exportMenuOpen, setExportMenuOpen] = React.useState(false);
    const [jsonDraft, setJsonDraft] = React.useState("");
    const [jsonApplying, setJsonApplying] = React.useState(false);
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

    const serializeGraph = React.useCallback(() => JSON.stringify({
      format: "data-alchemist-lineage",
      version: 1,
      nodes: (graphData?.nodes || []).map(n => ({
        external_id: n.external_id, label: n.label, layer: n.layer, node_type: n.node_type,
      })),
      edges: (graphData?.edges || []).map(e => ({
        source: e.source_ext_id, target: e.target_ext_id, edge_type: e.edge_type,
      })),
    }, null, 2), [graphData]);

    // Entering JSON view (or the graph changing underneath while in it and the
    // draft untouched) refreshes the editor from the live graph.
    const draftTouchedRef = React.useRef(false);
    React.useEffect(() => {
      if (viewMode === "json" && !draftTouchedRef.current) setJsonDraft(serializeGraph());
    }, [viewMode, serializeGraph]);

    const applyJsonDraft = async () => {
      let parsed;
      try { parsed = JSON.parse(jsonDraft); }
      catch (e) { toast("Not valid JSON: " + e.message, { kind: "error" }); return; }
      const desiredEdges = (parsed.edges || []).map(e => ({
        source: e.source || e.source_ext_id, target: e.target || e.target_ext_id,
        edge_type: e.edge_type || "FEEDS",
      }));
      const desiredNodes = parsed.nodes || null;   // null = user removed the array → don't manage nodes
      const key = (e) => `${e.source}\u0000${e.target}`;
      const currentEdges = (graphData?.edges || []).map(e => ({
        edge_id: e.edge_id, source: e.source_ext_id, target: e.target_ext_id, edge_type: e.edge_type,
      }));
      const desiredKeys = new Set(desiredEdges.map(key));
      const currentKeys = new Set(currentEdges.map(key));
      const edgesToAdd = desiredEdges.filter(e => !currentKeys.has(key(e)));
      const edgesToRemove = currentEdges.filter(e => e.edge_id && !desiredKeys.has(key(e)));

      let nodesToAdd = [], nodesToRemove = [];
      if (desiredNodes) {
        const desiredNodeIds = new Set(desiredNodes.map(n => n.external_id));
        // A node referenced by a desired edge is implicitly kept/created.
        desiredEdges.forEach(e => { desiredNodeIds.add(e.source); desiredNodeIds.add(e.target); });
        const currentNodeIds = new Set((graphData?.nodes || []).map(n => n.external_id));
        nodesToAdd = desiredNodes.filter(n => !currentNodeIds.has(n.external_id));
        nodesToRemove = (graphData?.nodes || []).filter(n => !desiredNodeIds.has(n.external_id));
      }

      if (!edgesToAdd.length && !edgesToRemove.length && !nodesToAdd.length && !nodesToRemove.length) {
        toast("No changes — the JSON matches the current graph.", { kind: "info" });
        return;
      }
      const summary = [
        edgesToAdd.length && `add ${edgesToAdd.length} edge(s)`,
        edgesToRemove.length && `remove ${edgesToRemove.length} edge(s)`,
        nodesToAdd.length && `add ${nodesToAdd.length} node(s)`,
        nodesToRemove.length && `DELETE ${nodesToRemove.length} node(s) (and their edges)`,
      ].filter(Boolean).join(", ");
      if (!confirm(`Apply these changes to the lineage graph?\n\n${summary}`)) return;

      setJsonApplying(true);
      let failures = [];
      try {
        if (nodesToAdd.length || edgesToAdd.length) {
          const res = await window.DTApi.importLineage(activeConnectionId, {
            nodes: nodesToAdd, edges: edgesToAdd,
          });
          (res.errors || []).forEach(e => failures.push(e));
        }
        for (const e of edgesToRemove) {
          try { await window.DTApi.deleteLineageEdge(e.edge_id); }
          catch (err) { failures.push(`remove edge ${e.source} -> ${e.target}: ${err.message}`); }
        }
        for (const n of nodesToRemove) {
          try { await window.DTApi.deleteLineageNode(n.node_id); }
          catch (err) { failures.push(`delete node ${n.external_id}: ${err.message}`); }
        }
      } finally {
        setJsonApplying(false);
      }
      await loadGraph(true);
      setSuggestedRefreshKey(k => k + 1);
      draftTouchedRef.current = false;   // re-sync editor from the applied graph
      toast(failures.length
        ? `Applied with ${failures.length} issue(s): ${failures[0]}`
        : `Lineage updated — ${summary}`, { kind: failures.length ? "warning" : "success" });
    };

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

    // ── Export suite ──────────────────────────────────────────────────────
    // The old SVG export cloned the edge <svg> only — node pills are HTML
    // overlays, so the downloaded file was arrows floating in空 space (user
    // report: "only arrows no table"). buildExportSVG() draws the COMPLETE
    // picture (tier headers, node pills, health dots, edges) as pure SVG.
    const HEALTH_HEX = { ok: "#16a34a", warn: "#d97706", fail: "#dc2626" };

    const buildExportSVG = () => {
      if (!layout || !graphData) return null;
      const W = layout.canvasW, H = layout.canvasH + 34;
      const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const parts = [];
      parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif">`);
      parts.push(`<rect width="100%" height="100%" fill="white"/>`);
      parts.push(`<defs><marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="#9ca3af"/></marker>`
        + Object.entries(HEALTH_HEX).map(([k, c]) => `<marker id="arw-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${c}"/></marker>`).join("")
        + `</defs>`);
      layout.tierLabels.forEach((label, i) => {
        parts.push(`<text x="${PAD_X + i * (NODE_W + COL_GAP)}" y="20" font-size="11" font-weight="700" fill="#6b7280" letter-spacing="1">${esc(label)}</text>`);
      });
      const OY = 34; // vertical offset for the header row
      graphData.edges.forEach(e => {
        const a = layout.layoutNodes[e.source_ext_id], b = layout.layoutNodes[e.target_ext_id];
        if (!a || !b) return;
        const tgtNode = graphData.nodes.find(n => n.external_id === e.target_ext_id);
        const h = tgtNode?.health_status || "ok";
        const bad = h === "fail" || h === "warn";
        const x1 = a.x + a.w, y1 = a.y + a.h / 2 + OY, x2 = b.x - 3, y2 = b.y + b.h / 2 + OY, mx = (x1 + x2) / 2;
        parts.push(`<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="${bad ? HEALTH_HEX[h] : "#d1d5db"}" stroke-width="${bad ? 1.75 : 1.1}" marker-end="url(#${bad ? "arw-" + h : "arw"})" opacity="${bad ? 0.95 : 0.6}"/>`);
      });
      Object.values(layout.layoutNodes).forEach(ln => {
        const h = ln.health_status || "ok";
        const bad = h === "fail" || h === "warn";
        const y = ln.y + OY;
        parts.push(`<rect x="${ln.x}" y="${y}" width="${ln.w}" height="${ln.h}" rx="7" fill="white" stroke="${bad ? HEALTH_HEX[h] : "#e5e7eb"}" stroke-width="1"/>`);
        parts.push(`<circle cx="${ln.x + 14}" cy="${y + ln.h / 2}" r="4" fill="${HEALTH_HEX[h]}"/>`);
        const label = ln.label.length > 30 ? ln.label.slice(0, 29) + "…" : ln.label;
        parts.push(`<text x="${ln.x + 24}" y="${y + ln.h / 2 + 4}" font-size="11" font-family="Consolas, monospace" fill="#111827"${bad ? ' font-weight="700"' : ""}>${esc(label)}</text>`);
      });
      parts.push("</svg>");
      return parts.join("\n");
    };

    const _download = (content, name, mime) => {
      const url = URL.createObjectURL(new Blob([content], { type: mime }));
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    };

    const handleExportSVG = () => {
      const svg = buildExportSVG();
      if (!svg) { toast("Nothing to export yet — the graph is empty.", { kind: "info" }); return; }
      _download(svg, "impact-graph.svg", "image/svg+xml");
      toast("impact-graph.svg downloaded — full picture: tables, health, edges (check Downloads)", { kind: "success" });
    };

    // Interactive artifact: PDFs cannot do hover/click-to-trace, so the
    // shareable interactive export is a self-contained HTML file (opens in any
    // browser, no server needed) — click any table to trace its dependencies,
    // exactly like the in-app canvas.
    const handleExportHTML = () => {
      if (!graphData?.nodes?.length) { toast("Nothing to export yet — the graph is empty.", { kind: "info" }); return; }
      const data = {
        exported_at: new Date().toISOString(),
        nodes: graphData.nodes.map(n => ({ id: n.external_id, label: n.label, layer: n.layer, type: n.node_type, health: n.health_status })),
        edges: graphData.edges.map(e => ({ s: e.source_ext_id, t: e.target_ext_id })),
      };
      const html = [
        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Impact Graph — lineage</title><style>",
        "body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#111827}",
        ".legend{display:flex;gap:16px;font-size:12px;color:#4b5563;margin-bottom:14px;align-items:center;flex-wrap:wrap}",
        ".sw{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}",
        ".cols{display:flex;gap:100px;align-items:flex-start;position:relative}",
        ".col h3{font-size:11px;letter-spacing:1px;color:#6b7280;margin:0 0 10px}",
        ".node{display:flex;align-items:center;gap:7px;padding:6px 10px;border:1px solid #e5e7eb;border-radius:7px;background:#fff;font:11.5px Consolas,monospace;margin-bottom:6px;cursor:pointer;position:relative;z-index:2;white-space:nowrap;width:210px;overflow:hidden;text-overflow:ellipsis}",
        ".node:hover{border-color:#9ca3af}",
        "svg.edges{position:absolute;top:0;left:0;pointer-events:none;overflow:visible}",
        "</style></head><body>",
        "<h2 style='margin:0 0 4px'>Impact Graph — data lineage</h2>",
        "<div style='font-size:12px;color:#6b7280;margin-bottom:14px'>Exported " + new Date().toLocaleString() + " · click any table to trace its direct dependencies · click again to clear</div>",
        "<div class='legend'><span><span class='sw' style='background:#16a34a'></span>healthy</span><span><span class='sw' style='background:#d97706'></span>warning</span><span><span class='sw' style='background:#dc2626'></span>failing</span><span>data flows left \u2192 right</span></div>",
        "<div id='wrap' style='position:relative'><svg class='edges' id='edges'></svg><div class='cols' id='cols'></div></div>",
        "<script>var DATA=", JSON.stringify(data), ";",
        "var HC={ok:'#16a34a',warn:'#d97706',fail:'#dc2626'};",
        "var ORDER={RAW:0,BRONZE:1,SILVER:2,GOLD:3,REPORT:4,MODEL:4};",
        "var cols={};DATA.nodes.forEach(function(n){var c=ORDER[n.layer]!==undefined?ORDER[n.layer]:(n.type==='report'||n.type==='model'?4:5);(cols[c]=cols[c]||[]).push(n);});",
        "var NAMES={0:'RAW',1:'BRONZE',2:'SILVER',3:'GOLD',4:'REPORTS / MODELS',5:'UNCLASSIFIED'};",
        "var colsEl=document.getElementById('cols');",
        "Object.keys(cols).sort().forEach(function(c){var d=document.createElement('div');d.className='col';d.innerHTML='<h3>'+NAMES[c]+' ('+cols[c].length+')</h3>';cols[c].forEach(function(n){var el=document.createElement('div');el.className='node';el.dataset.id=n.id;el.title=n.id;el.innerHTML='<span class=sw style=background:'+(HC[n.health]||'#9ca3af')+'></span>'+n.label;d.appendChild(el);});colsEl.appendChild(d);});",
        "var wrap=document.getElementById('wrap'),svg=document.getElementById('edges');",
        "function draw(){svg.setAttribute('width',wrap.scrollWidth);svg.setAttribute('height',wrap.scrollHeight);svg.innerHTML='<defs><marker id=m viewBox=\"0 0 10 10\" refX=9 refY=5 markerWidth=6 markerHeight=6 orient=auto-start-reverse><path d=\"M 0 1 L 9 5 L 0 9 z\" fill=#9ca3af></path></marker></defs>';",
        "DATA.edges.forEach(function(e){var a=wrap.querySelector('[data-id=\"'+e.s+'\"]'),b=wrap.querySelector('[data-id=\"'+e.t+'\"]');if(!a||!b)return;",
        "var w=wrap.getBoundingClientRect(),ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();",
        "var x1=ra.right-w.left,y1=ra.top-w.top+ra.height/2,x2=rb.left-w.left-3,y2=rb.top-w.top+rb.height/2,mx=(x1+x2)/2;",
        "var p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d','M'+x1+' '+y1+' C '+mx+' '+y1+', '+mx+' '+y2+', '+x2+' '+y2);p.setAttribute('fill','none');p.setAttribute('stroke','#d1d5db');p.setAttribute('stroke-width','1.1');p.setAttribute('marker-end','url(#m)');p.dataset.s=e.s;p.dataset.t=e.t;p.classList.add('e');svg.appendChild(p);});}",
        "setTimeout(draw,60);window.addEventListener('resize',draw);",
        "var sel=null;",
        "wrap.addEventListener('click',function(ev){var n=ev.target.closest('.node');if(!n)return;var id=n.dataset.id;",
        "if(sel===id){sel=null;}else{sel=id;}",
        "var conn=new Set([sel]);if(sel){DATA.edges.forEach(function(e){if(e.s===sel)conn.add(e.t);if(e.t===sel)conn.add(e.s);});}",
        "wrap.querySelectorAll('.node').forEach(function(x){x.style.opacity=(!sel||conn.has(x.dataset.id))?'1':'0.22';});",
        "svg.querySelectorAll('.e').forEach(function(e){var hit=sel&&(e.dataset.s===sel||e.dataset.t===sel);e.style.opacity=!sel?'1':(hit?'1':'0.08');e.setAttribute('stroke',hit?'#2563eb':'#d1d5db');e.setAttribute('stroke-width',hit?'2':'1.1');});});",
        "</" + "script></body></html>",
      ].join("");
      _download(html, "impact-graph-interactive.html", "text/html");
      toast("impact-graph-interactive.html downloaded — open it in any browser; click tables to trace (check Downloads)", { kind: "success" });
    };

    // PDF: print pipeline — a PDF is a paper format, so it gets the complete
    // STATIC picture; the browser's print dialog saves it as PDF.
    const handleExportPDF = () => {
      const svg = buildExportSVG();
      if (!svg) { toast("Nothing to export yet — the graph is empty.", { kind: "info" }); return; }
      const w = window.open("", "_blank");
      if (!w) { toast("Popup blocked — allow popups for this site to export PDF.", { kind: "warning" }); return; }
      w.document.write("<html><head><title>Impact Graph — lineage</title><style>@page{size:landscape;margin:10mm}body{margin:0}svg{max-width:100%;height:auto}</style></head><body>" + svg + "</body></html>");
      w.document.close();
      setTimeout(() => { w.focus(); w.print(); }, 400);
      toast("Print dialog opened — choose 'Save as PDF' as the destination.", { kind: "info" });
    };

    const [expandedTiers, setExpandedTiers] = React.useState(() => new Set());
    const [hoveredEdge, setHoveredEdge] = React.useState(null);   // edge index under the pointer
    const layout = React.useMemo(
      () => graphData?.nodes?.length ? computeLayout(graphData.nodes, expandedTiers) : null,
      [graphData, expandedTiers]
    );

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
                <div style={{ display: "inline-flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--grey-200)" }}>
                  {[["diagram", "Diagram"], ["json", "JSON"]].map(([m, label]) => (
                    <button key={m} onClick={() => { if (m === "json") draftTouchedRef.current = false; setViewMode(m); }}
                      style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
                        background: viewMode === m ? "var(--brand)" : "#fff",
                        color: viewMode === m ? "#fff" : "var(--fg-2)" }}>
                      {label}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="outline" icon="search" onClick={() => setShowDiscover(v => !v)}>Discover lineage</Button>
                <div style={{ position: "relative" }}>
                  <Button size="sm" variant="outline" icon="download" onClick={() => setExportMenuOpen(v => !v)}>Export ▾</Button>
                  {exportMenuOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 30,
                      background: "#fff", border: "1px solid var(--grey-200)", borderRadius: 10,
                      boxShadow: "var(--shadow-hover, 0 8px 24px rgba(0,0,0,.12))", padding: 6, minWidth: 230 }}>
                      {[
                        ["Interactive HTML", "click-to-trace, opens in any browser", handleExportHTML],
                        ["SVG image", "full static picture of the graph", handleExportSVG],
                        ["PDF (print)", "static, via your browser's Save as PDF", handleExportPDF],
                      ].map(([label, hint, fn]) => (
                        <button key={label} onClick={() => { setExportMenuOpen(false); fn(); }}
                          style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
                            background: "none", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12.5 }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--grey-50)"}
                          onMouseLeave={e => e.currentTarget.style.background = "none"}>
                          <div style={{ fontWeight: 600, color: "var(--fg-1)" }}>{label}</div>
                          <div style={{ fontSize: 11, color: "var(--fg-3)" }}>{hint}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button size="sm" variant="outline" icon="play" onClick={runAnimation}>Replay</Button>
              </div>
            ) : null}>
            Downstream Impact Graph
          </SectionTitle>

          {hasNodes && (
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              <Chip intent={counts.fail > 0 ? "danger" : "success"} dot>{counts.fail} blocked</Chip>
              <Chip intent={counts.warn > 0 ? "warning" : "success"} dot>{counts.warn} degraded</Chip>
              {activeConnectionId && <LineageHealthCard connectionId={activeConnectionId} refreshKey={suggestedRefreshKey} />}
              {impactNotes.map(n => <Chip key={n.node_id} intent="neutral" icon="dollar-sign">{n.note}</Chip>)}
            </div>
          )}

          {rootCauses.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {rootCauses.map(rc => (
                <button key={rc.node_id}
                  title="Click to spotlight this table and its blast radius in the graph"
                  onClick={() => {
                    const n = graphData?.nodes?.find(x => x.external_id === rc.external_id);
                    if (n) {
                      setSelectedNode(n);
                      setTimeout(() => document.getElementById("impact-node-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 350);
                    }
                  }}
                  style={{ padding: "8px 14px", background: "var(--red-50)", borderRadius: 8, border: "1px solid var(--red-200)",
                    fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left", width: "100%" }}>
                  <i data-lucide="alert-triangle" style={{ width: 14, height: 14, color: "var(--red-500)", flexShrink: 0 }} />
                  <span>
                    <strong>Root cause:</strong> {rc.label}
                    {rc.downstream_impact_count > 0
                      ? ` → ${rc.downstream_impact_count} downstream table${rc.downstream_impact_count !== 1 ? "s" : ""} affected`
                      : " → no downstream dependents recorded (isolated failure)"}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--red-500)", whiteSpace: "nowrap" }}>View blast radius →</span>
                </button>
              ))}
              {rootCauses.length > 1 && (
                <div style={{ fontSize: 11.5, color: "var(--fg-3)", paddingLeft: 4 }}>
                  {rootCauses.length} independent root causes detected — these are not related to each other via the current lineage graph.
                </div>
              )}
            </div>
          )}
        </Card>

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
            {/* ── JSON view — the same graph as editable text; Apply syncs
                 additions AND removals through the org-checked, cycle-checked
                 endpoints, then the diagram reflects it immediately. ── */}
            {viewMode === "json" && (
              <Card style={{ padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                  <Eyebrow>Lineage as JSON — edit and apply</Eyebrow>
                  <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>
                    {(graphData?.nodes || []).length} nodes · {(graphData?.edges || []).length} edges ·
                    edges are identified by source+target; removing one here removes it from the graph
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {/* File round-trip lives right where the editing happens:
                        load a lineage.json into the editor to review before
                        applying; download saves the DRAFT (including
                        unapplied edits), not just the live graph. */}
                    <Button size="sm" variant="outline" icon="file-up" onClick={() => document.getElementById("dt-lineage-file")?.click()}>
                      Load file
                    </Button>
                    <input id="dt-lineage-file" type="file" accept=".json,application/json" style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          draftTouchedRef.current = true;
                          setJsonDraft(String(reader.result));
                          toast(`${f.name} loaded into the editor — review, then Apply changes`, { kind: "info" });
                        };
                        reader.readAsText(f);
                        e.target.value = "";
                      }} />
                    <Button size="sm" variant="outline" icon="download" onClick={() => {
                      const url = URL.createObjectURL(new Blob([jsonDraft], { type: "application/json" }));
                      const a = document.createElement("a");
                      a.href = url; a.download = "lineage.json"; a.click();
                      URL.revokeObjectURL(url);
                      toast("lineage.json downloaded (current editor contents, including unapplied edits)", { kind: "success" });
                    }}>
                      Download draft
                    </Button>
                    <Button size="sm" variant="outline" icon="rotate-ccw"
                      onClick={() => { draftTouchedRef.current = false; setJsonDraft(serializeGraph()); }}>
                      Reset to current
                    </Button>
                    <Button size="sm" variant="primary" icon="check" disabled={jsonApplying} onClick={applyJsonDraft}>
                      {jsonApplying ? "Applying..." : "Apply changes"}
                    </Button>
                  </div>
                </div>
                <textarea value={jsonDraft}
                  onChange={e => { draftTouchedRef.current = true; setJsonDraft(e.target.value); }}
                  spellCheck={false}
                  style={{ width: "100%", minHeight: 480, fontFamily: '"JetBrains Mono", monospace', fontSize: 12,
                    padding: 12, borderRadius: 8, border: "1px solid var(--grey-200)", resize: "vertical",
                    lineHeight: 1.55, color: "var(--fg-1)", background: "var(--grey-50)" }} />
              </Card>
            )}

            {/* ── Graph canvas ── */}
            {viewMode === "diagram" && layout && (
              <Card style={{ overflowX: "auto", padding: "16px 24px 24px" }}>
                {/* Canvas toolbar — filters and node/edge tools act on this
                    canvas, so they live on it, not floating between cards. */}
                <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
                  {[["all", "All"], ["fail", "FAIL"], ["warn", "WARN"], ["ok", "OK"]].map(([f, label]) => (
                    <Button key={f} size="sm" variant={filter === f ? "primary" : "ghost"} onClick={() => setFilter(f)}>{label}</Button>
                  ))}
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tables..."
                    style={{ marginLeft: 6, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--grey-200)", fontSize: 12.5, outline: "none", minWidth: 170, color: "var(--fg-1)" }} />
                  <Button size="sm" icon="git-commit" variant="outline" onClick={() => setShowAddEdge(v => !v)} style={{ marginLeft: "auto" }}>
                    Add Edge
                  </Button>
                  <Button size="sm" icon="plus" variant="outline" onClick={() => setShowAddNode(v => !v)}>
                    Add Node
                  </Button>
                </div>
                {/* How-to-read legend — a first-time viewer must be able to decode
                    the diagram in seconds without asking anyone: arrows are data
                    flow, colors are health, clock means the health may be stale. */}
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap",
                  marginBottom: 12, fontSize: 11, color: "var(--fg-2)" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: STC.ok }}></span>healthy
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: STC.warn }}></span>warning
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: STC.fail }}></span>failing
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <i data-lucide="clock" style={{ width: 10, height: 10, color: "var(--yellow-600)" }}></i>stale health
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <svg width="26" height="8" viewBox="0 0 26 8"><line x1="0" y1="4" x2="19" y2="4" stroke="var(--grey-400)" strokeWidth="1.5"/><path d="M18 1 L25 4 L18 7 z" fill="var(--grey-400)"/></svg>
                    data flows left → right
                  </span>
                  <span style={{ marginLeft: "auto", color: "var(--fg-3)" }}>click a table to trace it · hover an arrow to read it</span>
                </div>
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
                    {/* Arrowheads — without a direction marker an edge is just a
                        decorative curve; the arrow is what lets a first-time viewer
                        read "data flows from THIS table into THAT one" unaided. */}
                    <defs>
                      {Object.entries({ ok: STC.ok, warn: STC.warn, fail: STC.fail, quiet: "var(--grey-400)", brand: "var(--blue-500)" }).map(([k, color]) => (
                        <marker key={k} id={`dt-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5"
                          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                          <path d="M 0 1 L 9 5 L 0 9 z" fill={color} />
                        </marker>
                      ))}
                    </defs>
                    {graphData.edges.map((e, i) => {
                      const src = layout.layoutNodes[e.source_ext_id];
                      const tgt = layout.layoutNodes[e.target_ext_id];
                      if (!src || !tgt) return null;
                      const isActive = step > src.colRank;
                      const tgtNode = graphData.nodes.find(n => n.external_id === e.target_ext_id);
                      const health = tgtNode?.health_status || "ok";
                      const dimmed = ((search || filter !== "all") && !filteredIds.has(e.source_ext_id) && !filteredIds.has(e.target_ext_id))
                        || (reach && !(inSpotlight(e.source_ext_id) && inSpotlight(e.target_ext_id)));
                      const touchesSelected = selectedNode &&
                        (e.source_ext_id === selectedNode.external_id || e.target_ext_id === selectedNode.external_id);
                      const hovered = hoveredEdge === i;
                      // dbt-docs discipline: a healthy pipeline reads as a quiet
                      // neutral mesh; color appears only where it carries signal —
                      // an unhealthy target, the hovered edge, or the selection.
                      const unhealthyEdge = health === "fail" || health === "warn";
                      const strokeColor = hovered || touchesSelected ? "var(--blue-500)"
                        : unhealthyEdge ? STC[health] : "var(--grey-300)";
                      const markerKey = hovered || touchesSelected ? "brand" : unhealthyEdge ? health : "quiet";
                      // End the curve just before the node border so the arrowhead is visible.
                      const x1 = src.x + src.w, y1 = src.y + src.h / 2;
                      const x2 = tgt.x - 3,      y2 = tgt.y + tgt.h / 2;
                      const mx = (x1 + x2) / 2;
                      return (
                        <path key={i}
                          d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth={hovered ? 2.5 : touchesSelected ? 2 : unhealthyEdge ? 1.75 : 1.1}
                          strokeDasharray={isActive && unhealthyEdge ? "6 4" : "0"}
                          markerEnd={`url(#dt-arrow-${markerKey})`}
                          opacity={dimmed ? 0.05 : hovered || touchesSelected ? 1 : unhealthyEdge ? 0.95 : 0.55}
                          onMouseEnter={() => setHoveredEdge(i)}
                          onMouseLeave={() => setHoveredEdge(prev => prev === i ? null : prev)}
                          style={{ transition: "stroke 350ms, opacity 350ms, stroke-width 120ms",
                            pointerEvents: "stroke", cursor: "pointer",
                            animation: isActive && unhealthyEdge ? "dtFlow 700ms linear infinite" : "none" }}>
                          {/* Native tooltip: hover any edge to read the relationship in words. */}
                          <title>{`${src.label}  →  ${tgt.label}   (${e.edge_type || "FEEDS"}: ${src.label} loads data into ${tgt.label})`}</title>
                        </path>
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
                    const unhealthy = n.health_status === "fail" || n.health_status === "warn";
                    return (
                      <div key={n.node_id}
                        onClick={() => setSelectedNode(isSelected ? null : n)}
                        title={[n.label, n.sub_label, n.note, stalenessInfo(n).stale ? stalenessInfo(n).label : null].filter(Boolean).join(" · ")}
                        style={{
                          position: "absolute", left: ln.x, top: ln.y, width: ln.w, height: ln.h,
                          background: isSelected ? "var(--blue-50)" : unhealthy && active ? STBG[n.health_status] : "#fff",
                          borderRadius: 7,
                          border: isSelected ? "1.5px solid var(--blue-500)" : `1px solid ${unhealthy && active ? STC[n.health_status] : "var(--grey-200)"}`,
                          boxShadow: isSelected ? "0 0 0 3px var(--blue-100)" : "none",
                          padding: "0 10px", transition: "opacity 300ms, border-color 300ms, background 300ms",
                          opacity: dimmed ? 0.18 : 1,
                          cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
                          animation: active && n.health_status === "fail" ? "dtFlash 600ms ease" : "none",
                          overflow: "hidden",
                        }}>
                        <span style={{ width: 8, height: 8, borderRadius: n.node_type === "table" ? "50%" : 2, flexShrink: 0,
                          background: active ? STC[n.health_status] : "var(--grey-300)",
                          transition: "background 300ms" }}></span>
                        <Mono style={{ fontSize: 11.5, fontWeight: unhealthy ? 700 : 500, color: "var(--fg-1)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{n.label}</Mono>
                        {n.node_type === "table" && stalenessInfo(n).stale && (
                          <i data-lucide="clock" style={{ width: 11, height: 11, color: "var(--yellow-600)", flexShrink: 0 }}></i>
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
                  // State the blast radius of the DELETE itself: this destroys the
                  // node's edges too (seen live: a real table deleted mid-testing
                  // took 6 pipeline edges with it and had to be re-discovered).
                  const edgeCount = graphData.edges.filter(e =>
                    e.source_ext_id === selectedNode.external_id || e.target_ext_id === selectedNode.external_id).length;
                  if (!confirm(`Delete "${selectedNode.label}" from the lineage graph?

This also removes its ${edgeCount} edge(s). If it's a real table, re-running Discover lineage can restore them as suggestions.`)) return;
                  await window.DTApi.deleteLineageNode(nodeId);
                  setSelectedNode(null);
                  setSuggestedRefreshKey(k => k + 1);
                  await loadGraph();
                }}
              />
              </div>
            )}

          </>
        )}
      </div>
    );
  };

  window.DTScreens.impact = Impact;
})();
