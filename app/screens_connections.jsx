// DataTrust — Screen: Connections manager (in-app data source management)
(function () {
  const PLATFORM_META = {
    sqlserver:  { glyph: "⬡", color: "#cc2020" },
    snowflake:  { glyph: "❄", color: "var(--navy-500)" },
    databricks: { glyph: "▲", color: "var(--orange-500)" },
    postgres:   { glyph: "🐘", color: "#336791" },
    fabric:     { glyph: "◰", color: "var(--green-600)" },
    bigquery:   { glyph: "◈", color: "var(--blue-600)" },
    duckdb:     { glyph: "🦆", color: "var(--yellow-600)" },
  };

  function mapConn(c) {
    const meta = PLATFORM_META[c.platform] || { glyph: "◉", color: "var(--brand)" };
    const syncTime = c.last_tested_at
      ? new Date(c.last_tested_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "Never";
    return {
      id: c.id,
      name: c.name,
      platform: c.platform,
      env: c.environment || "Production",
      glyph: meta.glyph,
      color: meta.color,
      host: c.host || c.platform,
      status: c.status === "active" ? "connected" : "error",
      schemas: (c.schemas_scope || []).length,
      scopeList: c.schemas_scope || [],
      tables: c.table_count || 0,
      lastSync: syncTime,
      auth: c.auth_type ? `${c.auth_type} auth` : c.platform,
      err: c.error_message,
    };
  }

  const MOCK_CONNS = [
    { id: "sf",  name: "RetailCo · Snowflake", env: "Production", glyph: "❄", color: "var(--navy-500)", host: "retailco-prod.us-east-1", status: "connected", schemas: 4, scopeList: ["raw","bronze","silver","gold"], tables: 29, lastSync: "2 min ago", auth: "Key pair · DQ_SERVICE_ROLE" },
    { id: "dbx", name: "RetailCo · Databricks", env: "Staging", glyph: "▲", color: "var(--orange-500)", host: "dbc-a1b2-retailco.cloud.databricks.com", status: "connected", schemas: 2, scopeList: ["bronze","gold"], tables: 11, lastSync: "1 hr ago", auth: "OAuth 2.0 · M2M" },
    { id: "bq",  name: "Marketing · BigQuery", env: "Production", glyph: "◈", color: "var(--blue-600)", host: "retailco-mktg.analytics", status: "error", schemas: 0, scopeList: [], tables: 0, lastSync: "Failed 3 hrs ago", auth: "Service account", err: "Key expired — re-authentication required" },
  ];

  const Connections = () => {
    const { setStage, setActiveConn, activeConnectionId } = useApp();
    const [showWizard, setShowWizard] = React.useState(false);
    const [syncing, setSyncing] = React.useState(null);
    const [conns, setConns] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [editingSchemas, setEditingSchemas] = React.useState(null);
    // editingSchemas: null | { connId, loading, available: str[], selected: str[] }
    useIcons();

    const loadConns = (autoSelectIfNone) => {
      if (!window.DTApi) { setLoading(false); return; }
      window.DTApi.listConnections()
        .then(list => {
          if (list && list.length) {
            setConns(list.map(mapConn));
            if (autoSelectIfNone && !activeConnectionId && setActiveConn) {
              const first = list.find(c => c.status === "active") || list[0];
              if (first) setActiveConn(first.id, first.name, first.platform);
            }
          }
          setLoading(false);
        })
        .catch(() => setLoading(false));
    };

    React.useEffect(() => { loadConns(true); }, []);

    const handleSync = (c) => {
      setSyncing(c.id);
      toast(`Re-testing ${c.name}…`, { kind: "info" });
      loadConns(false);
      setTimeout(() => {
        setSyncing(null);
        toast(`${c.name} synced`, { kind: "success" });
      }, 1400);
    };

    const handleDelete = (c) => {
      if (!window.confirm(`Delete connection "${c.name}"?`)) return;
      const p = window.DTApi?.deleteConnection?.(c.id);
      if (p && typeof p.then === "function") {
        p.then(() => { setConns(prev => prev.filter(x => x.id !== c.id)); toast("Connection deleted", { kind: "info" }); })
          .catch(() => toast("Delete failed", { kind: "error" }));
      } else {
        setConns(prev => prev.filter(x => x.id !== c.id));
        toast("Connection deleted", { kind: "info" });
      }
    };

    const handleSetActive = (c) => {
      if (setActiveConn) setActiveConn(c.id, c.name, c.platform);
      toast(`Switched to ${c.name}`, { kind: "success" });
    };

    const openSchemaEdit = (c) => {
      if (editingSchemas?.connId === c.id) { setEditingSchemas(null); return; }
      setEditingSchemas({ connId: c.id, loading: true, available: [], selected: [...c.scopeList] });
      if (!window.DTApi?.getConnectionSchemas) {
        setEditingSchemas({ connId: c.id, loading: false, available: ["raw", "bronze", "silver", "gold"], selected: [...c.scopeList] });
        return;
      }
      window.DTApi.getConnectionSchemas(c.id)
        .then(data => setEditingSchemas({ connId: c.id, loading: false, available: data.available || [], selected: data.selected || [] }))
        .catch(() => setEditingSchemas({ connId: c.id, loading: false, available: [...c.scopeList], selected: [...c.scopeList] }));
    };

    const toggleSchema = (name) => {
      setEditingSchemas(prev => {
        if (!prev) return prev;
        const sel = prev.selected.includes(name)
          ? prev.selected.filter(s => s !== name)
          : [...prev.selected, name];
        return { ...prev, selected: sel };
      });
    };

    const saveSchemas = () => {
      if (!editingSchemas) return;
      const { connId, selected } = editingSchemas;
      if (!window.DTApi?.updateConnection) {
        setConns(prev => prev.map(c => c.id === connId ? { ...c, schemas: selected.length, scopeList: [...selected] } : c));
        toast("Schemas updated", { kind: "success" });
        setEditingSchemas(null);
        return;
      }
      window.DTApi.updateConnection(connId, { schemas_scope: selected })
        .then(() => { toast("Schemas updated", { kind: "success" }); loadConns(false); setEditingSchemas(null); })
        .catch(() => toast("Failed to save schemas", { kind: "error" }));
    };

    const StatusTag = ({ c }) => c.status === "connected"
      ? <Chip intent="success" size="sm" dot>Connected</Chip>
      : <Chip intent="danger" size="sm" icon="alert-triangle">Error</Chip>;

    if (showWizard) {
      return (
        <div>
          <button onClick={() => setShowWizard(false)} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--fg-2)", background: "none", border: "none", cursor: "pointer", marginBottom: 14, padding: 0 }}>
            <i data-lucide="arrow-left" style={{ width: 15, height: 15 }}></i>Back to connections</button>
          <window.DTAuth.ConnectWizard inApp onDone={(connId, connName, platform) => {
            setShowWizard(false);
            if (connId && setActiveConn) setActiveConn(connId, connName, platform);
            loadConns(false);
            toast("New connection added & monitoring", { kind: "success" });
          }} />
        </div>
      );
    }

    return (
      <div className="dt-fade-up">
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="plug" sub="Data platforms DataTrust monitors. Checks run in-warehouse — your data is never copied out."
            right={<Button size="sm" variant="primary" icon="plus" onClick={() => setShowWizard(true)}>Add connection</Button>}>Connections</SectionTitle>
        </Card>

        {loading && (
          <div style={{ textAlign: "center", padding: 40, color: "var(--fg-3)" }}>
            <span className="dt-spin" style={{ width: 24, height: 24, border: "2.5px solid var(--grey-200)", borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block" }}></span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {conns.map(c => {
            const isActive = activeConnectionId === c.id;
            const editOpen = editingSchemas?.connId === c.id;
            return (
              <Card key={c.id} pad={0} style={{ overflow: "hidden", borderLeft: `3px solid ${isActive ? "var(--brand)" : c.status === "error" ? "var(--red-500)" : "var(--green-500)"}` }}>
                <div style={{ padding: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span style={{ width: 44, height: 44, borderRadius: 11, background: c.color, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 21, flexShrink: 0 }}>{c.glyph}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</span>
                        <Chip intent={c.env === "Production" ? "brand" : "neutral"} size="sm">{c.env}</Chip>
                        <StatusTag c={c} />
                        {isActive && <Chip intent="success" size="sm" dot>Active</Chip>}
                      </div>
                      <Mono style={{ fontSize: 11.5, color: "var(--fg-3)", display: "block", marginTop: 4 }}>{c.host}</Mono>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {!isActive && c.status !== "error" && (
                        <Button size="sm" variant="primary" icon="check-circle" onClick={() => handleSetActive(c)}>Use this</Button>
                      )}
                      <Button size="sm" variant={editOpen ? "soft" : "ghost"} icon="layers" onClick={() => openSchemaEdit(c)}>
                        {editOpen ? "Close" : "Edit schemas"}
                      </Button>
                      <Button size="sm" variant="soft" icon={syncing === c.id ? "loader" : "refresh-cw"} disabled={syncing === c.id || c.status === "error"}
                        onClick={() => handleSync(c)}>
                        {syncing === c.id ? "Syncing…" : "Sync"}</Button>
                      <IconBtn icon="trash-2" size={32} title="Delete connection" danger onClick={() => handleDelete(c)} />
                    </div>
                  </div>

                  {c.status === "error" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, padding: "10px 14px", background: "var(--red-50)", borderRadius: 10 }}>
                      <i data-lucide="alert-triangle" style={{ width: 16, height: 16, color: "var(--red-500)", flexShrink: 0 }}></i>
                      <span style={{ flex: 1, fontSize: 12.5, color: "var(--red-600)" }}>{c.err}</span>
                      <Button size="sm" variant="danger" icon="key-round" onClick={() => toast("Re-authentication flow opened", { kind: "info" })}>Re-authenticate</Button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 28, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--grey-100)", flexWrap: "wrap" }}>
                      {[["Schemas", c.schemas], ["Tables", c.tables || "—"], ["Auth", c.auth], ["Last sync", c.lastSync]].map(([k, v]) => (
                        <div key={k}>
                          <div style={{ fontSize: 10.5, color: "var(--fg-3)", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase" }}>{k}</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)", marginTop: 3 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Schema editor */}
                  {editOpen && (
                    <div style={{ marginTop: 14, padding: "14px 16px", background: "var(--blue-50)", borderRadius: 10, border: "1px solid var(--blue-100)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <i data-lucide="layers" style={{ width: 15, height: 15, color: "var(--brand)" }}></i>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--brand)" }}>Schema scope</span>
                        <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>Select which schemas DataTrust monitors</span>
                      </div>
                      {editingSchemas.loading ? (
                        <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "6px 0" }}>Loading schemas from connection…</div>
                      ) : editingSchemas.available.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "6px 0" }}>No schemas found. Type schema names manually or check your connection credentials.</div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                          {editingSchemas.available.map(s => {
                            const checked = editingSchemas.selected.includes(s);
                            return (
                              <button key={s} onClick={() => toggleSchema(s)} style={{
                                display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px",
                                borderRadius: 8, border: `1.5px solid ${checked ? "var(--brand)" : "var(--grey-200)"}`,
                                background: checked ? "var(--brand-soft)" : "#fff", cursor: "pointer",
                                fontSize: 12.5, fontWeight: checked ? 600 : 400,
                                color: checked ? "var(--brand)" : "var(--fg-2)", transition: "all 120ms",
                              }}>
                                <i data-lucide={checked ? "check-square" : "square"} style={{ width: 13, height: 13 }}></i>
                                {s}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                        <Button size="sm" variant="primary" icon="save" onClick={saveSchemas} disabled={editingSchemas.loading}>
                          Save ({editingSchemas.selected.length} selected)
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingSchemas(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        <Card style={{ marginTop: 16, background: "var(--grey-50)", border: "1px dashed var(--grey-300)", boxShadow: "none", display: "flex", alignItems: "center", gap: 14 }}>
          <i data-lucide="shield-check" style={{ width: 20, height: 20, color: "var(--green-600)" }}></i>
          <div style={{ flex: 1, fontSize: 12.5, color: "var(--fg-2)" }}>All connections use least-privilege read roles. Credentials are encrypted (AES-256) in your tenant secret manager and rotated every 90 days.</div>
          <Button size="sm" variant="soft" icon="scroll-text">View access log</Button>
        </Card>
      </div>
    );
  };

  window.DTScreens.connections = Connections;
})();
