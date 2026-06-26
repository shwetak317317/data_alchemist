// DataTrust — Screen: Downstream Impact Graph (live connection data only)
(function () {
  // ── Constants ──────────────────────────────────────────────────────────────
  const STC  = { fail: "var(--red-500)",    warn: "var(--yellow-500)", ok: "var(--green-500)"  };
  const STBG = { fail: "var(--red-50)",     warn: "var(--yellow-50)",  ok: "var(--green-50)"   };
  const LAYER_COL = { RAW: 0, BRONZE: 1, SILVER: 2, GOLD: 3, REPORT: 4, MODEL: 4 };
  const LAYER_LABEL = { 0: "RAW", 1: "BRONZE", 2: "SILVER", 3: "GOLD", 4: "REPORTS / MODELS" };
  const NODE_W = 240, NODE_H = 84, COL_GAP = 180, ROW_GAP = 20, PAD_X = 20, PAD_Y = 48;

  // ── Layout engine ─────────────────────────────────────────────────────────
  function computeLayout(nodes) {
    const colMap = {};
    nodes.forEach(n => {
      const ci = LAYER_COL[n.layer] ?? 4;
      if (!colMap[ci]) colMap[ci] = [];
      colMap[ci].push(n);
    });
    Object.values(colMap).forEach(arr => arr.sort((a, b) => (a.position_order || 0) - (b.position_order || 0)));
    const colIndices = Object.keys(colMap).map(Number).sort((a, b) => a - b);
    if (!colIndices.length) return null;
    const maxRows = Math.max(...Object.values(colMap).map(a => a.length));
    const canvasH = Math.max(420, PAD_Y * 2 + maxRows * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP);
    const canvasW = PAD_X * 2 + colIndices.length * (NODE_W + COL_GAP) - COL_GAP;
    const layoutNodes = {}, tierLabels = [];
    colIndices.forEach((ci, colRank) => {
      const colNodes = colMap[ci];
      const totalH = colNodes.length * NODE_H + Math.max(0, colNodes.length - 1) * ROW_GAP;
      const startY = Math.max(PAD_Y, (canvasH - totalH) / 2);
      colNodes.forEach((n, rowRank) => {
        layoutNodes[n.external_id] = { ...n, x: PAD_X + colRank * (NODE_W + COL_GAP), y: startY + rowRank * (NODE_H + ROW_GAP), w: NODE_W, h: NODE_H, colRank };
      });
      tierLabels[colRank] = LAYER_LABEL[ci] || colNodes[0]?.tier_label || `Tier ${ci}`;
    });
    return { layoutNodes, canvasW, canvasH, tierLabels };
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
      const newPath = [...path, node];
      const children = outEdges[node.external_id] || [];
      if (!children.length) { paths.push(newPath); return; }
      children.forEach(extId => { if (byExtId[extId]) dfs(byExtId[extId], newPath); });
    }
    roots.forEach(r => dfs(r, []));
    return paths;
  }

  // ── Empty state component ─────────────────────────────────────────────────
  const EmptyGraph = ({ hasConnection, seeding, onSeed, onAdd }) => (
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
              Lineage nodes are created automatically when you profile a table. You can also seed them from existing profiling reports, or add nodes manually.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <Button icon="database" onClick={onSeed} disabled={seeding}>
                {seeding ? "Seeding..." : "Seed from profiling reports"}
              </Button>
              <Button variant="outline" icon="plus" onClick={onAdd}>Add node manually</Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );

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

  // ── Node Detail Panel ─────────────────────────────────────────────────────
  const NodePanel = ({ node, connectionId, go, onClose, onUpdate, onDelete }) => {
    const [editing, setEditing] = React.useState(false);
    const [note, setNote] = React.useState(node.note || "");
    const [health, setHealth] = React.useState(node.health_status);
    const [saving, setSaving] = React.useState(false);

    const handleSave = async () => {
      setSaving(true);
      try { await onUpdate(node.node_id, { note, health_status: health }); setEditing(false); }
      finally { setSaving(false); }
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 14, fontSize: 12.5 }}>
          <div><div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 3 }}>LAYER</div><div style={{ fontWeight: 600 }}>{node.layer || "—"}</div></div>
          <div><div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 3 }}>TYPE</div><div style={{ fontWeight: 600 }}>{node.node_type}</div></div>
          <div><div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 3 }}>HEALTH</div><Health status={node.health_status === "fail" ? "FAIL" : node.health_status === "warn" ? "WARN" : "PASS"} /></div>
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
            <Button size="sm" variant="outline" icon="edit-2" onClick={() => setEditing(true)}>Edit</Button>
            {canDrillDown && (
              <Button size="sm" variant="outline" icon="bar-chart-2" onClick={() => go("profiling")}>View Report</Button>
            )}
            <Button size="sm" variant="outline" icon="trash-2" onClick={() => onDelete(node.node_id)}
              style={{ color: "var(--red-500)", borderColor: "var(--red-200)" }}>Delete</Button>
          </div>
        )}
      </Card>
    );
  };

  // ── Main Screen ───────────────────────────────────────────────────────────
  const Impact = () => {
    const { activeConnectionId, go } = useApp();
    const [step, setStep] = React.useState(0);
    const [graphData, setGraphData] = React.useState(null);   // null = not yet loaded
    const [loading, setLoading] = React.useState(true);
    const [seeding, setSeeding] = React.useState(false);
    const [filter, setFilter] = React.useState("all");
    const [search, setSearch] = React.useState("");
    const [selectedNode, setSelectedNode] = React.useState(null);
    const [showAddNode, setShowAddNode] = React.useState(false);
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

    const loadGraph = React.useCallback(async () => {
      setLoading(true);
      setStep(0);
      setSelectedNode(null);
      if (!activeConnectionId) {
        setGraphData(null);
        setLoading(false);
        return;
      }
      try {
        const data = await window.DTApi.getConnectionLineage(activeConnectionId);
        setGraphData(data && data.nodes && data.nodes.length > 0 ? data : { source_table: "", nodes: [], edges: [] });
      } catch (_) {
        setGraphData({ source_table: "", nodes: [], edges: [] });
      }
      setLoading(false);
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
        alert("Seed failed: " + e.message);
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

    const layout = React.useMemo(() => graphData?.nodes?.length ? computeLayout(graphData.nodes) : null, [graphData]);
    const paths  = React.useMemo(() => graphData?.nodes?.length ? computePaths(graphData.nodes, graphData.edges) : [], [graphData]);

    const filteredIds = React.useMemo(() => {
      if (!graphData?.nodes) return new Set();
      return new Set(graphData.nodes.filter(n => {
        if (filter !== "all" && n.health_status !== filter) return false;
        if (search && !n.label.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }).map(n => n.external_id));
    }, [graphData, filter, search]);

    const counts = React.useMemo(() => {
      const nonRoot = graphData?.nodes?.filter(n => !n.is_source) || [];
      return { fail: nonRoot.filter(n => n.health_status === "fail").length, warn: nonRoot.filter(n => n.health_status === "warn").length };
    }, [graphData]);

    const impactNotes = React.useMemo(() =>
      graphData?.nodes?.filter(n => !n.is_source && n.note && n.note.includes("$")) || [], [graphData]);

    const rootCause = React.useMemo(() => {
      if (!graphData?.nodes?.length) return null;
      return graphData.nodes.find(n => n.is_source && n.health_status === "fail") || graphData.nodes.find(n => n.health_status === "fail");
    }, [graphData]);

    const nodeActive = extId => {
      const ln = layout?.layoutNodes[extId];
      if (!ln) return false;
      return ln.colRank === 0 ? step >= 1 : ln.colRank === 1 ? step >= 2 : step >= 3;
    };

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

          {rootCause && (
            <div style={{ marginTop: 12, padding: "8px 14px", background: "var(--red-50)", borderRadius: 8, border: "1px solid var(--red-200)", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
              <i data-lucide="alert-triangle" style={{ width: 14, height: 14, color: "var(--red-500)", flexShrink: 0 }} />
              <span><strong>Root cause:</strong> {rootCause.label} → {counts.fail} downstream failure{counts.fail !== 1 ? "s" : ""}</span>
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

        {/* ── Filter bar + graph (shown only when there are nodes) ── */}
        {hasNodes && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
              {[["all", "All"], ["fail", "FAIL"], ["warn", "WARN"], ["ok", "OK"]].map(([f, label]) => (
                <Button key={f} size="sm" variant={filter === f ? "primary" : "outline"} onClick={() => setFilter(f)}>{label}</Button>
              ))}
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search nodes..."
                style={{ marginLeft: 4, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--grey-200)", fontSize: 12.5, outline: "none", minWidth: 160, color: "var(--fg-1)" }} />
              <Button size="sm" icon="plus" variant="outline" onClick={() => setShowAddNode(v => !v)} style={{ marginLeft: "auto" }}>
                Add Node
              </Button>
            </div>

            {/* ── Graph canvas ── */}
            {layout && (
              <Card style={{ overflowX: "auto", padding: "20px 24px 28px" }}>
                <div style={{ display: "flex", marginBottom: 12 }}>
                  {layout.tierLabels.map((label, i) => (
                    <div key={i} style={{ width: NODE_W + COL_GAP, flexShrink: 0 }}><Eyebrow>{label}</Eyebrow></div>
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
                      const dimmed = (search || filter !== "all") && !filteredIds.has(e.source_ext_id) && !filteredIds.has(e.target_ext_id);
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
                    const dimmed = (filter !== "all" || search) && !filteredIds.has(n.external_id);
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
                          <Mono style={{ fontSize: 11.5, fontWeight: 700, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</Mono>
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
              <NodePanel
                node={selectedNode}
                connectionId={activeConnectionId}
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
                  await loadGraph();
                }}
              />
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
