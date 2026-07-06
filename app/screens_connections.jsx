// DataTrust — Screen: Connections manager (in-app data source management)
(function () {
  const CRED_FIELDS = {
    sqlserver: {
      authTypes: [
        { id: "sql",      label: "SQL Server Auth" },
        { id: "windows",  label: "Windows Auth" },
        { id: "azure_ad", label: "Azure AD" },
      ],
      fields: (authType) => [
        { key: "host",     label: "Server / IP",  placeholder: "MYSERVER or 192.168.1.10" },
        { key: "port",     label: "Port",          placeholder: "1433" },
        { key: "database", label: "Database",      placeholder: "(default)", optional: true },
        { key: "instance", label: "Instance",      placeholder: "SQLEXPRESS", optional: true },
        ...(authType !== "windows" ? [
          { key: "username", label: "Username",    placeholder: "sa" },
          { key: "password", label: "Password",    placeholder: "leave blank to keep current", type: "password" },
        ] : []),
      ],
    },
    snowflake: {
      authTypes: [
        { id: "keypair",  label: "Key pair" },
        { id: "oauth",    label: "OAuth 2.0" },
        { id: "password", label: "Password" },
      ],
      fields: (authType) => [
        { key: "account",   label: "Account",    placeholder: "org-account.us-east-1" },
        { key: "warehouse", label: "Warehouse",   placeholder: "COMPUTE_WH" },
        { key: "database",  label: "Database",    placeholder: "MY_DB" },
        { key: "role",      label: "Role",        placeholder: "DQ_SERVICE_ROLE", optional: true },
        ...(authType === "password" ? [
          { key: "username", label: "Username",   placeholder: "my_user" },
          { key: "password", label: "Password",   placeholder: "leave blank to keep current", type: "password" },
        ] : []),
      ],
    },
    postgres: {
      authTypes: [{ id: "password", label: "Password" }],
      fields: () => [
        { key: "host",     label: "Host",     placeholder: "localhost" },
        { key: "port",     label: "Port",     placeholder: "5432" },
        { key: "database", label: "Database", placeholder: "my_db" },
        { key: "username", label: "Username", placeholder: "postgres" },
        { key: "password", label: "Password", placeholder: "leave blank to keep current", type: "password" },
      ],
    },
    databricks: {
      authTypes: [
        { id: "pat",   label: "Access Token" },
        { id: "oauth", label: "OAuth M2M" },
      ],
      fields: () => [
        { key: "host",      label: "Workspace host",     placeholder: "adb-12345.azuredatabricks.net", full: true },
        { key: "http_path", label: "HTTP path",          placeholder: "/sql/1.0/warehouses/abc123",    full: true },
        { key: "database",  label: "Schema / database",  placeholder: "default" },
        { key: "token",     label: "Access token",       placeholder: "leave blank to keep current", type: "password", full: true },
      ],
    },
    duckdb: {
      authTypes: [],
      fields: () => [
        { key: "file_path", label: "File path", placeholder: "/data/mydb.duckdb or :memory:", full: true },
      ],
    },
  };

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
      // Raw credential preview for pre-populating the edit form (no secrets)
      credPreview: {
        host: c.host || null,
        port: c.port || null,
        database: c.database_name || null,
        auth_type: c.auth_type || null,
      },
    };
  }

  const Connections = () => {
    const { setStage, setActiveConn, activeConnectionId, refreshDatasets } = useApp();
    const [showWizard, setShowWizard] = React.useState(false);
    const [syncing, setSyncing] = React.useState(null);
    const [conns, setConns] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [editingSchemas, setEditingSchemas] = React.useState(null);
    const [editingName, setEditingName] = React.useState(null);
    const [editingCreds, setEditingCreds] = React.useState(null);
    // editingCreds: null | { connId, platform, authType, form, testResult, testing, saving }
    const nameInputRef = React.useRef(null);
    useIcons();

    React.useEffect(() => {
      if (editingName && nameInputRef.current) nameInputRef.current.focus();
    }, [editingName?.connId]);

    const loadConns = (autoSelectIfNone) => {
      if (!window.DTApi) { setLoading(false); return; }
      window.DTApi.listConnections()
        .then(list => {
          const rows = list || [];
          setConns(rows.map(mapConn));
          if (autoSelectIfNone && rows.length && !activeConnectionId && setActiveConn) {
            const first = rows.find(c => c.status === "active") || rows[0];
            if (first) setActiveConn(first.id, first.name, first.platform);
          }
          setLoading(false);
        })
        .catch(err => {
          console.error("[connections] listConnections failed:", err);
          setLoading(false);
        });
    };

    React.useEffect(() => { loadConns(true); }, []);

    const handleSync = (c) => {
      if (!window.DTApi?.testSavedConnection) return;
      setSyncing(c.id);
      toast(`Re-testing ${c.name}…`, { kind: "info" });
      window.DTApi.testSavedConnection(c.id)
        .then(result => {
          toast(result.success ? `${c.name} is reachable` : `${c.name} failed: ${result.message}`,
            { kind: result.success ? "success" : "error" });
        })
        .catch(err => toast(`${c.name} sync failed: ${err.message}`, { kind: "error" }))
        .finally(() => { setSyncing(null); loadConns(false); });
    };

    const handleDelete = (c) => {
      if (!window.confirm(`Delete connection "${c.name}"?`)) return;
      const p = window.DTApi?.deleteConnection?.(c.id);
      if (p && typeof p.then === "function") {
        p.then(() => { setConns(prev => prev.filter(x => x.id !== c.id)); toast("Connection deleted", { kind: "info" }); })
          .catch(err => {
            const msg = String(err);
            if (msg.includes("403")) toast("Permission denied — please log out and log back in to refresh your session", { kind: "error" });
            else toast("Delete failed", { kind: "error" });
          });
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
      setEditingCreds(null);
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

    const saveName = () => {
      if (!editingName) return;
      const { connId, value } = editingName;
      const trimmed = value.trim();
      if (!trimmed) { setEditingName(null); return; }
      const conn = conns.find(c => c.id === connId);
      if (trimmed === conn?.name) { setEditingName(null); return; }
      if (!window.DTApi?.updateConnection) {
        setConns(prev => prev.map(c => c.id === connId ? { ...c, name: trimmed } : c));
        if (connId === activeConnectionId) setActiveConn(connId, trimmed, conn?.platform);
        toast("Connection renamed", { kind: "success" });
        setEditingName(null);
        return;
      }
      window.DTApi.updateConnection(connId, { name: trimmed })
        .then(updated => {
          const newName = updated?.name || trimmed;
          setConns(prev => prev.map(c => c.id === connId ? { ...c, name: newName } : c));
          // Propagate to global context so sidebar/header update immediately
          if (connId === activeConnectionId) setActiveConn(connId, newName, conn?.platform);
          toast("Connection renamed", { kind: "success" });
          setEditingName(null);
        })
        .catch(err => {
          const msg = String(err);
          if (msg.includes("403")) toast("Permission denied — please log out and log back in to refresh your session", { kind: "error" });
          else toast("Rename failed", { kind: "error" });
        });
    };

    const saveSchemas = () => {
      if (!editingSchemas) return;
      const { connId, selected } = editingSchemas;
      const conn = conns.find(c => c.id === connId);
      if (!window.DTApi?.updateConnection) {
        setConns(prev => prev.map(c => c.id === connId ? { ...c, schemas: selected.length, scopeList: [...selected] } : c));
        if (connId === activeConnectionId) refreshDatasets?.();
        toast("Schemas updated", { kind: "success" });
        setEditingSchemas(null);
        return;
      }
      window.DTApi.updateConnection(connId, { schemas_scope: selected })
        .then(() => {
          setConns(prev => prev.map(c => c.id === connId ? { ...c, schemas: selected.length, scopeList: [...selected] } : c));
          // Schema scope changed — refresh shared dataset list so all sidebars update
          if (connId === activeConnectionId) refreshDatasets?.();
          toast("Schemas updated", { kind: "success" });
          setEditingSchemas(null);
        })
        .catch(err => {
          const msg = String(err);
          if (msg.includes("403")) toast("Permission denied — please log out and log back in to refresh your session", { kind: "error" });
          else toast("Failed to save schemas", { kind: "error" });
        });
    };

    const openCredEdit = (c) => {
      if (editingCreds?.connId === c.id) { setEditingCreds(null); return; }
      setEditingSchemas(null);
      setEditingName(null);
      const platCfg = CRED_FIELDS[c.platform];
      // Detect auth type: prefer stored value, fall back to platform default
      const storedAuth = c.credPreview?.auth_type;
      const defaultAuth = storedAuth || platCfg?.authTypes?.[0]?.id || "sql";
      // Pre-populate from list data immediately (host, port, database, auth_type are already fetched)
      const initialForm = {};
      if (c.credPreview) {
        if (c.credPreview.host)     initialForm.host    = c.credPreview.host;
        if (c.credPreview.port)     initialForm.port    = c.credPreview.port;
        if (c.credPreview.database) initialForm.database = c.credPreview.database;
        // Snowflake uses 'account' key, not 'host'
        if (c.platform === "snowflake" && c.credPreview.host) initialForm.account = c.credPreview.host;
      }
      setEditingCreds({ connId: c.id, platform: c.platform, authType: defaultAuth, form: initialForm, testResult: null, testing: false, saving: false });
      // Enrich with remaining fields (username, instance, warehouse, etc.) from decrypted config
      if (window.DTApi?.getConnectionCredentials) {
        window.DTApi.getConnectionCredentials(c.id)
          .then(data => {
            setEditingCreds(prev => {
              if (!prev || prev.connId !== c.id) return prev;
              // Merge: API data wins over our initial guess, but keep password placeholder empty
              return { ...prev, authType: data.auth_type || defaultAuth, form: { ...initialForm, ...data } };
            });
          })
          .catch(() => {}); // Initial form still shows from credPreview
      }
    };

    const testCreds = () => {
      if (!editingCreds) return;
      const { connId, authType, form } = editingCreds;
      setEditingCreds(prev => ({ ...prev, testing: true, testResult: null }));
      const creds = { ...form, auth_type: authType };
      ["password", "token"].forEach(k => { if (!creds[k]) delete creds[k]; });
      (window.DTApi?.testSavedConnection
        ? window.DTApi.testSavedConnection(connId, { credentials: creds })
        : Promise.reject(new Error("API unavailable"))
      )
        .then(result => setEditingCreds(prev => prev?.connId === connId ? { ...prev, testing: false, testResult: result } : prev))
        .catch(() => setEditingCreds(prev => prev?.connId === connId ? { ...prev, testing: false, testResult: { success: false, message: "Test request failed" } } : prev));
    };

    const saveCreds = () => {
      if (!editingCreds) return;
      const { connId, authType, form } = editingCreds;
      setEditingCreds(prev => ({ ...prev, saving: true }));
      const creds = { ...form, auth_type: authType };
      ["password", "token"].forEach(k => { if (!creds[k]) delete creds[k]; });
      window.DTApi.updateConnection(connId, { credentials: creds })
        .then(() => {
          toast("Credentials updated", { kind: "success" });
          setEditingCreds(null);
          loadConns(false);
        })
        .catch(err => {
          const msg = String(err);
          setEditingCreds(prev => ({ ...prev, saving: false }));
          if (msg.includes("403")) toast("Permission denied", { kind: "error" });
          else toast("Failed to save credentials", { kind: "error" });
        });
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
            const credOpen = editingCreds?.connId === c.id;
            return (
              <Card key={c.id} pad={0} style={{ overflow: "hidden", borderLeft: `3px solid ${isActive ? "var(--brand)" : c.status === "error" ? "var(--red-500)" : "var(--green-500)"}` }}>
                <div style={{ padding: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span style={{ width: 44, height: 44, borderRadius: 11, background: c.color, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 21, flexShrink: 0 }}>{c.glyph}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                        {editingName?.connId === c.id ? (
                          <input
                            ref={nameInputRef}
                            value={editingName.value}
                            onChange={e => setEditingName(n => ({ ...n, value: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(null); }}
                            onBlur={saveName}
                            style={{ fontSize: 15, fontWeight: 700, border: "1.5px solid var(--brand)", borderRadius: 6,
                              padding: "3px 8px", outline: "none", minWidth: 180, maxWidth: 320,
                              boxShadow: "0 0 0 3px var(--brand-ring)", background: "#fff" }}
                          />
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <span style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</span>
                            <button
                              title="Rename connection"
                              onClick={() => { setEditingSchemas(null); setEditingName({ connId: c.id, value: c.name }); }}
                              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
                                width: 22, height: 22, border: "none", background: "transparent",
                                cursor: "pointer", color: "var(--fg-3)", borderRadius: 4,
                                transition: "color 120ms" }}
                              onMouseEnter={e => e.currentTarget.style.color = "var(--brand)"}
                              onMouseLeave={e => e.currentTarget.style.color = "var(--fg-3)"}>
                              <i data-lucide="pencil" style={{ width: 12, height: 12 }}></i>
                            </button>
                          </span>
                        )}
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
                      <Button size="sm" variant={credOpen ? "soft" : "ghost"} icon="key-round" onClick={() => openCredEdit(c)}>
                        {credOpen ? "Close" : "Edit credentials"}
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
                      <Button size="sm" variant="danger" icon="key-round" onClick={() => openCredEdit(c)}>Re-authenticate</Button>
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

                  {/* Credential editor */}
                  {credOpen && (() => {
                    const platCfg = CRED_FIELDS[c.platform] || { authTypes: [], fields: () => [] };
                    const authType = editingCreds.authType || platCfg.authTypes?.[0]?.id || "sql";
                    const fields = platCfg.fields(authType);
                    return (
                      <div style={{ marginTop: 14, padding: "14px 16px", background: "var(--grey-50)", borderRadius: 10, border: "1px solid var(--grey-200)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                          <i data-lucide="key-round" style={{ width: 15, height: 15, color: "var(--brand)" }}></i>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--brand)" }}>Edit credentials</span>
                          <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>Passwords are not shown — leave blank to keep current</span>
                        </div>
                        {platCfg.authTypes.length > 1 && (
                          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                            {platCfg.authTypes.map(at => (
                              <button key={at.id} onClick={() => setEditingCreds(prev => ({ ...prev, authType: at.id, testResult: null }))}
                                style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12.5, cursor: "pointer",
                                  fontWeight: authType === at.id ? 600 : 400,
                                  border: `1.5px solid ${authType === at.id ? "var(--brand)" : "var(--grey-200)"}`,
                                  background: authType === at.id ? "var(--brand-soft)" : "#fff",
                                  color: authType === at.id ? "var(--brand)" : "var(--fg-2)", transition: "all 100ms" }}>
                                {at.label}
                              </button>
                            ))}
                          </div>
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px", marginBottom: 12 }}>
                          {fields.map(f => (
                            <div key={f.key} style={{ gridColumn: f.full ? "1 / -1" : "auto" }}>
                              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-2)", letterSpacing: ".04em",
                                textTransform: "uppercase", display: "block", marginBottom: 3 }}>
                                {f.label}
                                {f.optional && <span style={{ color: "var(--fg-3)", fontWeight: 400, textTransform: "none", marginLeft: 4 }}>(optional)</span>}
                              </label>
                              <input
                                type={f.type || "text"}
                                value={editingCreds.form[f.key] || ""}
                                onChange={e => setEditingCreds(prev => ({ ...prev, form: { ...prev.form, [f.key]: e.target.value }, testResult: null }))}
                                placeholder={f.placeholder}
                                style={{ width: "100%", padding: "6px 10px", borderRadius: 7,
                                  border: "1.5px solid var(--grey-200)", fontSize: 12.5, outline: "none",
                                  boxSizing: "border-box", background: "#fff",
                                  fontFamily: f.type === "password" ? "monospace" : "inherit" }}
                              />
                            </div>
                          ))}
                        </div>
                        {editingCreds.testResult && (
                          <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 8,
                            background: editingCreds.testResult.success ? "var(--green-50)" : "var(--red-50)",
                            border: `1px solid ${editingCreds.testResult.success ? "var(--green-200)" : "var(--red-200)"}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600,
                              color: editingCreds.testResult.success ? "var(--green-700)" : "var(--red-600)" }}>
                              <i data-lucide={editingCreds.testResult.success ? "check-circle" : "alert-circle"} style={{ width: 14, height: 14 }}></i>
                              {editingCreds.testResult.message}
                              {editingCreds.testResult.latency_ms && (
                                <span style={{ fontWeight: 400, color: "var(--fg-3)", marginLeft: 4 }}>({editingCreds.testResult.latency_ms} ms)</span>
                              )}
                            </div>
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                          <Button size="sm" variant="soft" icon={editingCreds.testing ? "loader" : "zap"}
                            disabled={editingCreds.testing || editingCreds.saving} onClick={testCreds}>
                            {editingCreds.testing ? "Testing…" : "Test connection"}
                          </Button>
                          <Button size="sm" variant="primary" icon="save"
                            disabled={editingCreds.testing || editingCreds.saving} onClick={saveCreds}>
                            {editingCreds.saving ? "Saving…" : "Save credentials"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingCreds(null)}>Cancel</Button>
                        </div>
                      </div>
                    );
                  })()}

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
