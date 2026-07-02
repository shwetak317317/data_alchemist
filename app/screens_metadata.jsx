// DataTrust — Screen: Metadata enrichment & CDE registry
(function () {

  // ── Layer badge colours ──────────────────────────────────────────────────────
  const LAYER_STYLE = {
    RAW:     { bg: 'var(--grey-100)',   fg: 'var(--grey-700)'  },
    BRONZE:  { bg: 'var(--yellow-50)',  fg: 'var(--yellow-800)' },
    SILVER:  { bg: 'var(--blue-50)',    fg: 'var(--blue-700)'  },
    GOLD:    { bg: '#fef9c3',           fg: '#713f12'           },
    UNKNOWN: { bg: 'var(--grey-100)',   fg: 'var(--grey-600)'  },
    OTHER:   { bg: 'var(--grey-100)',   fg: 'var(--grey-600)'  },
  };
  const SENS_INTENT = { PII: 'purple', FINANCIAL: 'brand', OPERATIONAL: 'warning', NONE: 'neutral' };

  // ── Inline SVGs ──────────────────────────────────────────────────────────────
  const IcoWarning = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="var(--yellow-600)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
  const IcoShield = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="var(--purple-500)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
  const IcoRefresh = ({ size = 14, cls = '' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={cls}
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
    </svg>
  );
  const IcoChevron = ({ open }) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={open ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/>
    </svg>
  );
  const IcoCheck = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
  const IcoPencil = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
  const IcoArrowUp = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
    </svg>
  );
  const IcoArrowDown = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
    </svg>
  );
  const IcoX = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
  const IcoSortUp = () => (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor"><polygon points="5,1 9,9 1,9"/></svg>
  );
  const IcoSortDown = () => (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor"><polygon points="5,9 9,1 1,1"/></svg>
  );

  // ── Shared styles ────────────────────────────────────────────────────────────
  const selStyle = {
    fontSize: 12, padding: '4px 8px', borderRadius: 6,
    border: '1px solid var(--grey-200)', background: 'var(--bg-2)',
    color: 'var(--fg-1)', cursor: 'pointer', height: 30,
  };
  const iconBtnBase = {
    background: 'transparent', border: '1px solid var(--grey-200)', cursor: 'pointer',
    width: 27, height: 27, borderRadius: 6, display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', color: 'var(--fg-2)',
    flexShrink: 0,
  };

  // ── Add Column Modal ─────────────────────────────────────────────────────────
  const AddColumnModal = ({ connId, defaultTableFqn, onClose, onSubmit }) => {
    const [form, setForm] = React.useState({
      table_fqn: defaultTableFqn || '',
      column_name: '', data_type: '', business_name: '',
      description: '', is_pii: false, sensitivity_tag: 'NONE',
    });
    const [busy, setBusy] = React.useState(false);
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const submit = async () => {
      if (!form.column_name.trim() || !form.table_fqn.trim()) {
        toast('Column name and table are required', { kind: 'error' });
        return;
      }
      setBusy(true);
      try {
        await window.DTApi.addColumnManually({ ...form, connection_id: connId });
        toast('Column added to dictionary', { kind: 'success' });
        onSubmit();
      } catch (e) {
        toast('Failed: ' + e.message, { kind: 'error' });
        setBusy(false);
      }
    };

    const inp = (k, placeholder) => (
      <input value={form[k]} onChange={e => set(k, e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', padding: '6px 10px', borderRadius: 7, border: '1px solid var(--grey-200)', fontSize: 13, boxSizing: 'border-box' }} />
    );

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div style={{ background: 'var(--bg-1)', borderRadius: 12, padding: 24, width: 500,
          maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Add column manually</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Table FQN *</label>
                {inp('table_fqn', 'schema.table_name')}
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Column name *</label>
                {inp('column_name', 'column_name')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Data type</label>
                {inp('data_type', 'VARCHAR, INT, DATE…')}
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Business name</label>
                {inp('business_name', 'Friendly display name')}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Description</label>
              <textarea value={form.description} onChange={e => set('description', e.target.value)}
                placeholder="What does this column represent?"
                style={{ width: '100%', minHeight: 60, padding: '6px 10px', borderRadius: 7,
                  border: '1px solid var(--grey-200)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_pii} onChange={e => set('is_pii', e.target.checked)} />
                Contains PII
              </label>
              <select value={form.sensitivity_tag} onChange={e => set('sensitivity_tag', e.target.value)}
                style={{ ...selStyle, flex: 1 }}>
                <option value="NONE">No sensitivity</option>
                <option value="PII">PII</option>
                <option value="FINANCIAL">Financial</option>
                <option value="OPERATIONAL">Operational</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={busy}>
              {busy ? 'Adding…' : 'Add column'}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // ── Main screen ──────────────────────────────────────────────────────────────
  const Metadata = () => {
    const { go, activeConnectionId, activeConnectionName, activeTableFqn, datasets } = useApp();

    // ── State ────────────────────────────────────────────────────────────────
    const [metaRows, setMetaRows] = React.useState([]);
    const [cdeRows, setCdeRows]   = React.useState([]);
    const [descs, setDescs]       = React.useState({});
    const [busNames, setBusNames] = React.useState({});
    const [owners, setOwners]     = React.useState({});
    const [editing, setEditing]         = React.useState(null);
    const [enriching, setEnriching]         = React.useState(false);
    const [enrichingLayer, setEnrichingLayer] = React.useState(null);
    const [enrichProgress, setEnrichProgress] = React.useState({ done: 0, total: 0 });
    const [enrichError, setEnrichError]     = React.useState('');
    // Sidebar
    const [selectedFqn, setSelectedFqn]   = React.useState(activeTableFqn || null);
    const [sideCollapsed, setSideCollapsed] = React.useState({});
    // Filters (search bar)
    const [searchText, setSearchText]   = React.useState('');
    const [filterLayer, setFilterLayer] = React.useState('ALL');
    const [filterStatus, setFilterStatus] = React.useState('ALL');
    const [filterIsCDE, setFilterIsCDE] = React.useState('ALL');
    const [filterIsPII, setFilterIsPII] = React.useState('ALL');
    const [sortBy, setSortBy]   = React.useState('name');
    const [sortDir, setSortDir] = React.useState('asc');
    const [selectedCols, setSelectedCols] = React.useState(new Set());
    const [showAddModal, setShowAddModal] = React.useState(false);
    const [expandedRows, setExpandedRows] = React.useState(new Set());
    // Tables that failed enrichment because no real profiling report backs them
    // (e.g. a stale/cached dataset entry pointing at a table that no longer
    // exists) — flagged so the sidebar stops offering a dead-end "Enrich".
    const [brokenTables, setBrokenTables] = React.useState({});
    useIcons();

    const rowKey = (m) => m.column_id || `${m.tableFqn}.${m.col}`;

    // ── Load ALL data for connection ────────────────────────────────────────
    const loadData = React.useCallback(() => {
      if (!window.DTApi || !activeConnectionId) return Promise.resolve();
      // Always load the full connection dictionary (sidebar filters client-side)
      const dictPromise = window.DTApi.listDictionary(activeConnectionId)
        .then(rows => {
          if (!rows) return;
          const mapped = rows.map(r => ({
            col:          r.column_name,
            column_id:    r.column_id || r.id,
            desc:         r.description || '',
            businessName: r.business_name || '',
            dataType:     r.data_type || '',
            formatStd:    r.format_standard || '',
            businessOwner: r.business_owner || '',
            layer:        (r.layer || 'UNKNOWN').toUpperCase(),
            aiSuggested:  r.ai_suggested,
            cde:          r.is_cde || false,
            cdeScore:     Math.round(r.cde_score || 0),
            status:       r.status || 'draft',
            pii:          r.is_pii || false,
            sensitivityTag: r.sensitivity_tag || 'NONE',
            tableFqn:     r.table_fqn || '',
            approvedBy:   r.approved_by || '',
            canPromote:   !r.is_cde && (r.cde_score || 0) > 40,
            internal:     (r.column_name || '').startsWith('_'),
          }));
          setMetaRows(mapped);
          setDescs(Object.fromEntries(mapped.map(m => [m.col, m.desc])));
          setBusNames(Object.fromEntries(mapped.map(m => [m.col, m.businessName])));
          setOwners(Object.fromEntries(mapped.map(m => [m.col, m.businessOwner])));
        }).catch(() => {});
      // Fire CDEs and datasets in background (don't block the caller)
      window.DTApi.listCDEs(activeConnectionId)
        .then(rows => {
          if (!rows) return;
          setCdeRows(rows.map(r => ({
            name:       r.column_name,
            table:      r.table_fqn,
            cdeScore:   Math.round(r.cde_score || 0),
            health:     r.health || 'PASS',
            promotedBy: r.promoted_by || '—',
            promotedAt: r.promoted_at
              ? new Date(r.promoted_at).toLocaleDateString() : '—',
            ruleCount:  r.rule_count || 0,
            column_id:  r.column_id,
          })));
        }).catch(() => {});
      return dictPromise;
    }, [activeConnectionId]);

    React.useEffect(() => { loadData(); }, [loadData]);

    // ── Sidebar groups ──────────────────────────────────────────────────────
    const sidebarGroups = React.useMemo(() => {
      const byLayer = {};
      const datasetFqns = new Set();

      (datasets || []).forEach(group => {
        const layer = ((group.layer || group.schema || 'UNKNOWN')).toUpperCase();
        if (!byLayer[layer]) byLayer[layer] = { layer, tables: [] };
        (group.tables || []).forEach(t => {
          // Live connector: group.schema is set, t.name is just the table name → build FQN.
          // Demo / DB-fallback: group.schema is absent, t.name IS already the full FQN.
          const fqn = group.schema ? `${group.schema}.${t.name}` : t.name;
          if (byLayer[layer].tables.some(x => x.fqn === fqn)) return;
          // Always display only the table-name portion (last dot-segment).
          const displayName = fqn.includes('.') ? fqn.split('.').pop() : fqn;
          datasetFqns.add(fqn);
          byLayer[layer].tables.push({ fqn, name: displayName, rows: t.rows, profiled: t.profiled && t.profiled !== '—' });
        });
      });

      // Tables with dictionary entries but not in listDatasets (manually added, etc.)
      const extraFqns = [...new Set(metaRows.map(m => m.tableFqn).filter(Boolean))]
        .filter(fqn => !datasetFqns.has(fqn));
      if (extraFqns.length > 0) {
        byLayer['OTHER'] = {
          layer: 'OTHER',
          tables: extraFqns.map(fqn => ({ fqn, name: fqn.split('.').slice(-1)[0], rows: null, profiled: false })),
        };
      }

      return Object.values(byLayer);
    }, [datasets, metaRows]);

    // ── Per-table enrichment coverage ───────────────────────────────────────
    const coverageByTable = React.useMemo(() =>
      metaRows.reduce((acc, m) => {
        if (!acc[m.tableFqn]) acc[m.tableFqn] = { total: 0, enriched: 0, approved: 0 };
        acc[m.tableFqn].total++;
        if (m.desc) acc[m.tableFqn].enriched++;
        if (m.status === 'approved') acc[m.tableFqn].approved++;
        return acc;
      }, {})
    , [metaRows]);

    // ── Enrichment ──────────────────────────────────────────────────────────
    const runEnrichmentFor = async (fqn) => {
      const targetFqn = fqn || selectedFqn;
      if (!targetFqn) {
        toast('Select a table in the sidebar to enrich.', { kind: 'info' });
        return;
      }
      setEnriching(true);
      setEnrichError('');
      try {
        const report = await window.DTApi.getReportByTable(targetFqn, activeConnectionId);
        if (!report || !report.report_id) throw new Error('No profiling report found — run Profiling first.');
        setBrokenTables(b => { if (!b[targetFqn]) return b; const next = { ...b }; delete next[targetFqn]; return next; });
        const result = await window.DTApi.enrichMetadata(report.report_id, activeConnectionId);
        const tName = targetFqn.split('.').slice(-1)[0];
        const missed = result.missing_columns?.length || 0;
        toast(
          missed > 0
            ? `AI enriched ${result.enriched - missed} of ${result.enriched} columns in ${tName} · ${missed} need manual review (AI skipped them)`
            : `AI enriched ${result.enriched} columns in ${tName} · review below`,
          { kind: missed > 0 ? 'info' : 'success' }
        );
        loadData();
      } catch (e) {
        const msg = (e.message || 'Enrichment failed').replace(/^API \d+: /, '');
        setEnrichError(msg);
        toast(msg, { kind: 'error' });
        // "No profiling report" means the sidebar's dataset cache is pointing at
        // a table with no real profiling behind it (stale cache, renamed/dropped
        // source table). Flag it so the sidebar stops offering a dead-end retry.
        if (/no profiling report/i.test(msg)) {
          setBrokenTables(b => ({ ...b, [targetFqn]: msg }));
        }
      } finally {
        setEnriching(false);
      }
    };

    const runEnrichAllLayer = async (group) => {
      const eligible = group.tables.filter(t => {
        const cov = coverageByTable[t.fqn] || { total: 0, enriched: 0 };
        return t.profiled && cov.enriched === 0 && !brokenTables[t.fqn];
      });
      if (!eligible.length) {
        toast(`No un-enriched profiled tables in ${group.layer}`, { kind: 'info' });
        return;
      }
      setEnrichingLayer(group.layer);
      setEnrichProgress({ done: 0, total: eligible.length });
      let doneCount = 0;
      const failedTables = [];

      for (let i = 0; i < eligible.length; i++) {
        const t = eligible[i];
        try {
          const report = await window.DTApi.getReportByTable(t.fqn, activeConnectionId);
          if (!report || !report.report_id) {
            failedTables.push(t.name);
            setBrokenTables(b => ({ ...b, [t.fqn]: 'No profiling report found' }));
          } else {
            await window.DTApi.enrichMetadata(report.report_id, activeConnectionId);
            doneCount++;
            // Fetch this table's enriched columns and merge into state immediately
            const tableDict = await window.DTApi.listDictionary(activeConnectionId, t.fqn)
              .catch(() => null);
            if (tableDict && tableDict.length > 0) {
              const newCols = tableDict.map(r => ({
                col: r.column_name, column_id: r.column_id || r.id,
                desc: r.description || '', businessName: r.business_name || '',
                dataType: r.data_type || '', formatStd: r.format_standard || '',
                businessOwner: r.business_owner || '',
                layer: (r.layer || 'UNKNOWN').toUpperCase(),
                aiSuggested: r.ai_suggested,
                cde: r.is_cde || false, cdeScore: Math.round(r.cde_score || 0),
                status: r.status || 'draft', pii: r.is_pii || false,
                sensitivityTag: r.sensitivity_tag || 'NONE',
                tableFqn: r.table_fqn || '', approvedBy: r.approved_by || '',
                canPromote: !r.is_cde && (r.cde_score || 0) > 40,
                internal: (r.column_name || '').startsWith('_'),
              }));
              setMetaRows(prev => [...prev.filter(m => m.tableFqn !== t.fqn), ...newCols]);
              setDescs(d => ({ ...d, ...Object.fromEntries(newCols.map(m => [m.col, m.desc])) }));
              setBusNames(b => ({ ...b, ...Object.fromEntries(newCols.map(m => [m.col, m.businessName])) }));
              setOwners(o => ({ ...o, ...Object.fromEntries(newCols.map(m => [m.col, m.businessOwner])) }));
            }
          }
        } catch (e) {
          failedTables.push(t.name);
        }
        setEnrichProgress({ done: i + 1, total: eligible.length });
        // Yield a macrotask so React flushes and paints before the next table starts
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      setEnrichingLayer(null);
      setEnrichProgress({ done: 0, total: 0 });
      if (doneCount === 0) {
        toast(`Could not enrich any tables in ${group.layer} — run Profiling first.`, { kind: 'error' });
      } else if (failedTables.length > 0) {
        toast(`Enriched ${doneCount} table(s) in ${group.layer} · ${failedTables.length} skipped (${failedTables.slice(0, 3).join(', ')}${failedTables.length > 3 ? '…' : ''})`,
          { kind: 'info' });
      }
      // Final full refresh to update CDEs, datasets, and sidebar coverage counts
      loadData();
    };

    // ── Decision helpers ────────────────────────────────────────────────────
    const decide = (col, decision) => {
      const row = metaRows.find(m => m.col === col);
      if (row && row.column_id && window.DTApi) {
        window.DTApi.decideColumn(row.column_id, decision, { description: descs[col] })
          .then(() => loadData()).catch(() => {});
      }
      toast(`${col} — ${decision}`, { kind: decision === 'rejected' ? 'info' : 'success' });
    };

    const saveEdit = (col) => {
      setEditing(null);
      const row = metaRows.find(m => m.col === col);
      if (!row || !row.column_id) return;
      window.DTApi.decideColumn(row.column_id, 'edit', {
        description:    descs[col],
        business_name:  busNames[col],
        business_owner: owners[col],
      }).then(() => { toast(`${col} — edits saved`, { kind: 'success' }); loadData(); })
        .catch(() => {});
    };

    // ── CDE promote / demote ────────────────────────────────────────────────
    const promoteColumn = (m) => {
      if (!m.column_id) return;
      window.DTApi.cdePromote(m.column_id, 'promote', {})
        .then(() => { toast(`${m.col} promoted to CDE`, { kind: 'success' }); loadData(); })
        .catch(e => toast('Promote failed: ' + e.message, { kind: 'error' }));
    };

    const demoteColumn = (c) => {
      if (!c.column_id) return;
      const label = c.name || c.col;
      window.DTApi.cdePromote(c.column_id, 'demote', {})
        .then(() => { toast(`${label} removed from CDE registry`, { kind: 'info' }); loadData(); })
        .catch(e => toast('Demote failed: ' + e.message, { kind: 'error' }));
    };

    // ── Bulk actions ────────────────────────────────────────────────────────
    const handleBulkDecide = (decision) => {
      const ids = filteredRows
        .filter(m => selectedCols.has(m.col))
        .map(m => m.column_id).filter(Boolean);
      if (!ids.length) return;
      window.DTApi.bulkDecide(ids, decision)
        .then(() => {
          toast(`${ids.length} columns ${decision}d`, { kind: decision === 'reject' ? 'info' : 'success' });
          setSelectedCols(new Set());
          loadData();
        })
        .catch(e => toast('Bulk action failed: ' + e.message, { kind: 'error' }));
    };

    const handleBulkPromote = () => {
      const selected = filteredRows.filter(m => selectedCols.has(m.col));
      const eligible = selected.filter(m => m.canPromote && !m.cde);
      eligible.forEach(m => promoteColumn(m));
      const skipped = selected.length - eligible.length;
      if (eligible.length === 0) {
        toast('None promoted — selected columns are already CDE or score ≤ 40', { kind: 'info' });
      } else if (skipped > 0) {
        toast(`${eligible.length} of ${selected.length} promoted — ${skipped} already CDE or score ≤ 40`, { kind: 'info' });
      }
      setSelectedCols(new Set());
    };

    // ── Export ──────────────────────────────────────────────────────────────
    const handleExport = () => {
      const q = `connection_id=${activeConnectionId}${selectedFqn ? '&table_fqn=' + encodeURIComponent(selectedFqn) : ''}`;
      const a = document.createElement('a');
      a.href = `/api/metadata/dictionary/export?${q}`;
      a.download = 'data_dictionary.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };

    // ── Sort ────────────────────────────────────────────────────────────────
    const toggleSort = (field) => {
      if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
      else { setSortBy(field); setSortDir('asc'); }
    };

    // ── Filtered + sorted rows ──────────────────────────────────────────────
    const filteredRows = React.useMemo(() => {
      let rows = [...metaRows];

      // Primary: sidebar table selection
      if (selectedFqn) rows = rows.filter(m => m.tableFqn === selectedFqn);

      // Search bar
      if (searchText) {
        const q = searchText.toLowerCase();
        rows = rows.filter(m =>
          m.col.toLowerCase().includes(q) ||
          (descs[m.col] || '').toLowerCase().includes(q) ||
          (busNames[m.col] || '').toLowerCase().includes(q)
        );
      }

      if (filterLayer  !== 'ALL') rows = rows.filter(m => m.layer === filterLayer);
      if (filterStatus !== 'ALL') rows = rows.filter(m => m.status === filterStatus);
      if (filterIsCDE === 'yes')  rows = rows.filter(m => m.cde);
      else if (filterIsCDE === 'no') rows = rows.filter(m => !m.cde);
      if (filterIsPII === 'yes')  rows = rows.filter(m => m.pii);
      else if (filterIsPII === 'no') rows = rows.filter(m => !m.pii);

      rows.sort((a, b) => {
        // In ALL mode, group by table first (secondary: user's sort)
        if (!selectedFqn && a.tableFqn !== b.tableFqn) {
          return a.tableFqn < b.tableFqn ? -1 : 1;
        }
        let av, bv;
        if (sortBy === 'cde_score') { av = a.cdeScore; bv = b.cdeScore; }
        else if (sortBy === 'status') { av = a.status; bv = b.status; }
        else { av = a.col.toLowerCase(); bv = b.col.toLowerCase(); }
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
      return rows;
    }, [metaRows, descs, busNames, searchText, filterLayer, filterStatus, filterIsCDE, filterIsPII, selectedFqn, sortBy, sortDir]);

    // Interleave table-divider rows when showing ALL tables
    const displayRows = React.useMemo(() => {
      if (selectedFqn) return filteredRows;
      const result = [];
      let lastTable = null;
      filteredRows.forEach(m => {
        if (m.tableFqn !== lastTable) {
          const cov = coverageByTable[m.tableFqn] || { total: 0, enriched: 0, approved: 0 };
          result.push({ _isDivider: true, tableFqn: m.tableFqn, layer: m.layer, ...cov });
          lastTable = m.tableFqn;
        }
        result.push(m);
      });
      return result;
    }, [filteredRows, selectedFqn, coverageByTable]);

    // ── Derived counts ──────────────────────────────────────────────────────
    const approvedCount = metaRows.filter(m => m.status === 'approved').length;
    const enrichedCount = metaRows.filter(m => m.desc).length;
    const piiCols       = (selectedFqn ? metaRows.filter(m => m.tableFqn === selectedFqn) : metaRows).filter(m => m.pii);
    const displayedCdeRows = selectedFqn ? cdeRows.filter(c => c.table === selectedFqn) : cdeRows;
    const allSelected   = filteredRows.length > 0 && filteredRows.every(m => selectedCols.has(m.col));
    const hasFilters    = searchText || filterLayer !== 'ALL' || filterStatus !== 'ALL' || filterIsCDE !== 'ALL' || filterIsPII !== 'ALL';

    // Per-selected-table stats (for table context header)
    const selCov = selectedFqn
      ? (coverageByTable[selectedFqn] || { total: 0, enriched: 0, approved: 0 })
      : { total: metaRows.length, enriched: enrichedCount, approved: approvedCount };

    const clearFilters = () => {
      setSearchText(''); setFilterLayer('ALL'); setFilterStatus('ALL');
      setFilterIsCDE('ALL'); setFilterIsPII('ALL');
    };

    const SortBtn = ({ field, label }) => (
      <button onClick={() => toggleSort(field)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
          display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700,
          letterSpacing: 0.5, color: sortBy === field ? 'var(--brand)' : 'var(--fg-3)',
          textTransform: 'uppercase' }}>
        {label}
        {sortBy === field && (sortDir === 'asc' ? <IcoSortUp /> : <IcoSortDown />)}
      </button>
    );

    // ── Sidebar toggle helpers ──────────────────────────────────────────────
    const isLayerOpen  = (l) => !sideCollapsed[l];
    const toggleLayer  = (l) => setSideCollapsed(c => ({ ...c, [l]: !c[l] }));

    // ─────────────────────────────────────────────────────────────────────────
    return (
      <div className="dt-fade-up">

        {/* ── Header card ─────────────────────────────────────────────────── */}
        <Card style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SectionTitle icon="book-marked"
                sub={metaRows.length > 0
                  ? `${selCov.enriched} of ${selCov.total} columns enriched · ${selCov.approved} approved${selectedFqn ? ` in ${selectedFqn.split('.').pop()}` : ''}`
                  : 'Select a table in the sidebar and click "Run AI Enrichment" to generate metadata from a profiling report.'}>
                Data dictionary — {activeConnectionName || '—'}
                {selectedFqn && <span style={{ color: 'var(--brand)', fontWeight: 600 }}> · {selectedFqn}</span>}
              </SectionTitle>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, paddingTop: 2 }}>
              {enrichError && (
                <span style={{ fontSize: 11, color: 'var(--red-600)', maxWidth: 220, lineHeight: 1.3 }}>{enrichError}</span>
              )}
              <Button variant="soft" disabled={enriching || !!enrichingLayer} onClick={() => runEnrichmentFor(selectedFqn)}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IcoRefresh size={13} cls={(enriching || enrichingLayer) ? 'dt-spin' : ''} />
                  {enriching ? 'Enriching…'
                    : enrichingLayer
                      ? `Enriching ${enrichingLayer}… ${enrichProgress.done}/${enrichProgress.total}`
                      : selectedFqn ? 'Enrich this table' : 'Run AI Enrichment'}
                </span>
              </Button>
              <Chip intent={approvedCount === 0 && enrichedCount > 0 ? 'warning' : 'brand'} dot>
                {approvedCount} approved{approvedCount === 0 && enrichedCount > 0 ? ' — review pending' : ''}
              </Chip>
            </div>
          </div>
        </Card>

        {/* ── Two-column layout: sidebar + main ───────────────────────────── */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>

          {/* ──────────────── SIDEBAR ──────────────────────────────────── */}
          <div style={{ width: 248, flexShrink: 0, alignSelf: 'flex-start', position: 'sticky', top: 24 }}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>

              {/* ALL TABLES row */}
              <button onClick={() => setSelectedFqn(null)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  background: !selectedFqn ? 'var(--brand-ring)' : 'transparent',
                  border: 'none', borderBottom: '1px solid var(--grey-100)',
                  borderLeft: !selectedFqn ? '3px solid var(--brand)' : '3px solid transparent',
                  cursor: 'pointer', padding: '10px 12px 10px 10px', textAlign: 'left' }}>
                <span style={{ fontSize: 12, fontWeight: !selectedFqn ? 700 : 500, flex: 1,
                  color: !selectedFqn ? 'var(--brand)' : 'var(--fg-1)' }}>All tables</span>
                <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{metaRows.length} cols</span>
              </button>

              {/* Layer groups */}
              <div style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
                {sidebarGroups.map(group => {
                  const ls = LAYER_STYLE[group.layer] || LAYER_STYLE.UNKNOWN;
                  const open = isLayerOpen(group.layer);
                  // Total enriched across this layer's tables
                  const layerTotals = group.tables.reduce((a, t) => {
                    const cov = coverageByTable[t.fqn] || { total: 0, enriched: 0 };
                    return { total: a.total + cov.total, enriched: a.enriched + cov.enriched };
                  }, { total: 0, enriched: 0 });

                  return (
                    <div key={group.layer} style={{ borderBottom: '1px solid var(--grey-100)' }}>
                      {/* Layer header */}
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <button onClick={() => toggleLayer(group.layer)}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1,
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            padding: '7px 10px', textAlign: 'left', minWidth: 0 }}>
                          <span style={{ color: 'var(--fg-3)', display: 'flex', flexShrink: 0 }}>
                            <IcoChevron open={open} />
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                            letterSpacing: 0.5, background: ls.bg, color: ls.fg }}>{group.layer}</span>
                          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{group.tables.length}</span>
                          {layerTotals.total > 0 && (
                            <span style={{ fontSize: 10, color: 'var(--fg-3)', marginLeft: 'auto', paddingRight: 4 }}>
                              {layerTotals.enriched}/{layerTotals.total}
                            </span>
                          )}
                        </button>
                        {(() => {
                          const eligible = group.tables.filter(t => {
                            const cov = coverageByTable[t.fqn] || { total: 0, enriched: 0 };
                            return t.profiled && cov.enriched === 0 && !brokenTables[t.fqn];
                          });
                          if (!eligible.length) return null;
                          const busy = enrichingLayer === group.layer;
                          return (
                            <button
                              disabled={busy || !!enrichingLayer}
                              onClick={e => { e.stopPropagation(); runEnrichAllLayer(group); }}
                              title={`Enrich all ${eligible.length} un-enriched table(s) in ${group.layer}`}
                              style={{ fontSize: 10, padding: '2px 7px', marginRight: 8, borderRadius: 4,
                                background: busy ? 'var(--brand-ring)' : 'transparent',
                                border: '1px solid var(--brand)', color: 'var(--brand)',
                                cursor: (busy || !!enrichingLayer) ? 'not-allowed' : 'pointer',
                                flexShrink: 0, opacity: (!!enrichingLayer && !busy) ? 0.4 : 1,
                                whiteSpace: 'nowrap' }}>
                              {busy
                                ? `Enriching… ${enrichProgress.done}/${enrichProgress.total}`
                                : 'Enrich all'}
                            </button>
                          );
                        })()}
                      </div>

                      {/* Table rows */}
                      {open && group.tables.map(t => {
                        const cov = coverageByTable[t.fqn] || { total: 0, enriched: 0, approved: 0 };
                        const isActive = selectedFqn === t.fqn;
                        const covColor = cov.total === 0
                          ? 'var(--fg-3)'
                          : cov.approved === cov.total
                            ? 'var(--green-600)'
                            : cov.enriched > 0
                              ? 'var(--yellow-600)'
                              : 'var(--fg-3)';

                        return (
                          <div key={t.fqn}
                            style={{ borderLeft: isActive ? '3px solid var(--brand)' : '3px solid transparent',
                              background: isActive ? 'var(--brand-ring)' : 'transparent' }}>
                            <button onClick={() => setSelectedFqn(isActive ? null : t.fqn)}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                                background: 'transparent', border: 'none', cursor: 'pointer',
                                padding: '6px 10px 6px 16px', textAlign: 'left' }}>
                              <Mono style={{ flex: 1, fontSize: 11.5, overflow: 'hidden',
                                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                color: isActive ? 'var(--brand)' : 'var(--fg-1)',
                                fontWeight: isActive ? 700 : 400 }}>
                                {t.name}
                              </Mono>
                              <span style={{ fontSize: 10.5, color: covColor, flexShrink: 0 }}>
                                {cov.total > 0 ? `${cov.enriched}/${cov.total}` : t.profiled ? '—' : ''}
                              </span>
                            </button>
                            {/* Quick Enrich button for profiled tables with no metadata */}
                            {t.profiled && cov.total === 0 && brokenTables[t.fqn] ? (
                              <span title={brokenTables[t.fqn]}
                                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10,
                                  margin: '0 10px 5px 16px', color: 'var(--yellow-700)' }}>
                                <IcoWarning /> No profiling report — stale entry
                              </span>
                            ) : t.profiled && cov.total === 0 && (
                              <button
                                disabled={enriching || !!enrichingLayer}
                                onClick={e => { e.stopPropagation(); setSelectedFqn(t.fqn); runEnrichmentFor(t.fqn); }}
                                style={{ fontSize: 10, padding: '2px 8px', margin: '0 10px 5px 16px',
                                  borderRadius: 4, background: 'var(--brand-ring)',
                                  border: '1px solid var(--brand)', color: 'var(--brand)',
                                  cursor: (enriching || !!enrichingLayer) ? 'not-allowed' : 'pointer',
                                  opacity: (enriching || !!enrichingLayer) ? 0.5 : 1 }}>
                                Enrich
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {sidebarGroups.length === 0 && (
                  <div style={{ padding: '12px 14px', fontSize: 11.5, color: 'var(--fg-3)', lineHeight: 1.5 }}>
                    No tables found. Run Profiling first to populate the table list.
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* ──────────────── MAIN CONTENT ─────────────────────────────── */}
          <div style={{ flex: 1, minWidth: 0 }}>

            {/* Filter / search bar */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={searchText} onChange={e => setSearchText(e.target.value)}
                placeholder="Search columns…"
                style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid var(--grey-200)',
                  fontSize: 13, width: 180, height: 30, boxSizing: 'border-box' }} />
              {!selectedFqn && (
                <select value={filterLayer} onChange={e => setFilterLayer(e.target.value)} style={selStyle}>
                  <option value="ALL">All layers</option>
                  {['RAW','BRONZE','SILVER','GOLD'].map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              )}
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selStyle}>
                <option value="ALL">All statuses</option>
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <select value={filterIsCDE} onChange={e => setFilterIsCDE(e.target.value)} style={selStyle}>
                <option value="ALL">CDE: all</option>
                <option value="yes">CDE only</option>
                <option value="no">Non-CDE</option>
              </select>
              <select value={filterIsPII} onChange={e => setFilterIsPII(e.target.value)} style={selStyle}>
                <option value="ALL">PII: all</option>
                <option value="yes">PII only</option>
                <option value="no">Non-PII</option>
              </select>
              {hasFilters && (
                <button onClick={clearFilters}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, color: 'var(--fg-3)', textDecoration: 'underline' }}>
                  Clear
                </button>
              )}
              {filteredRows.length > 0 && (
                <button onClick={() => {
                    const allOpen = filteredRows.every(m => expandedRows.has(rowKey(m)));
                    setExpandedRows(allOpen ? new Set() : new Set(filteredRows.map(rowKey)));
                  }}
                  style={{ background: 'none', border: '1px solid var(--grey-200)', cursor: 'pointer',
                    fontSize: 11, color: 'var(--fg-2)', borderRadius: 6, padding: '3px 9px' }}>
                  {filteredRows.every(m => expandedRows.has(rowKey(m))) ? 'Collapse all' : 'Expand all'}
                </button>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-3)' }}>
                {filteredRows.length}{metaRows.length !== filteredRows.length ? ` / ${metaRows.length}` : ''} columns
              </span>
            </div>

            {/* Bulk action bar */}
            {selectedCols.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
                borderRadius: 8, background: 'var(--brand-ring)', border: '1px solid var(--brand)',
                marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand)' }}>
                  {selectedCols.size} selected
                </span>
                <Button size="sm" variant="soft" onClick={() => handleBulkDecide('approve')}>Approve all</Button>
                <Button size="sm" variant="soft" onClick={() => handleBulkDecide('reject')}>Reject all</Button>
                <Button size="sm" variant="soft" onClick={handleBulkPromote}>Promote to CDE</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedCols(new Set())}>Clear</Button>
              </div>
            )}

            {/* Column list */}
            <Card style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>

              {/* Column list header */}
              {filteredRows.length > 0 && (
                <div style={{ display: 'flex', gap: 10, padding: '7px 20px',
                  background: 'var(--grey-50)', borderBottom: '1px solid var(--grey-100)',
                  alignItems: 'center' }}>
                  <input type="checkbox" checked={allSelected}
                    onChange={e => setSelectedCols(
                      e.target.checked ? new Set(filteredRows.map(m => m.col)) : new Set()
                    )} />
                  <div style={{ width: 18 }} />
                  <div style={{ flex: 1 }}><SortBtn field="name" label="Column" /></div>
                  <div style={{ width: 64, textAlign: 'right' }}><SortBtn field="cde_score" label="Score" /></div>
                  <div style={{ width: 90 }}><SortBtn field="status" label="Status" /></div>
                  <div style={{ width: 100 }} />
                </div>
              )}

              {/* Empty state */}
              {filteredRows.length === 0 && (
                <div style={{ padding: '36px 24px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
                  {metaRows.length === 0
                    ? selectedFqn
                      ? 'No metadata for this table yet. Click "Enrich this table" above to generate descriptions.'
                      : 'No column metadata yet. Select a table from the sidebar and click "Run AI Enrichment".'
                    : 'No columns match the current filters.'}
                </div>
              )}

              {/* Rows (with optional table-divider inserts in ALL mode) */}
              {displayRows.map((row, i) => {
                // ── Table divider (ALL mode) ─────────────────────────────
                if (row._isDivider) {
                  const ls = LAYER_STYLE[row.layer] || LAYER_STYLE.UNKNOWN;
                  const covPct = row.total > 0 ? Math.round(row.enriched / row.total * 100) : 0;
                  return (
                    <div key={`div-${row.tableFqn}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 20px', background: 'var(--grey-50)',
                        borderTop: i > 0 ? '2px solid var(--grey-200)' : 'none',
                        cursor: 'pointer' }}
                      onClick={() => setSelectedFqn(row.tableFqn)}>
                      <Mono style={{ fontSize: 12, fontWeight: 700, flex: 1, color: 'var(--fg-1)' }}>
                        {row.tableFqn}
                      </Mono>
                      {row.layer && row.layer !== 'UNKNOWN' && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                          letterSpacing: 0.4, background: ls.bg, color: ls.fg }}>{row.layer}</span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                        {row.enriched}/{row.total} enriched
                        {row.approved > 0 ? ` · ${row.approved} approved` : ''}
                      </span>
                      {row.total > 0 && (
                        <div style={{ width: 60, height: 4, borderRadius: 2, background: 'var(--grey-200)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${covPct}%`, background: covPct === 100 ? 'var(--green-500)' : 'var(--brand)', borderRadius: 2 }} />
                        </div>
                      )}
                    </div>
                  );
                }

                // ── Column row ───────────────────────────────────────────
                const m = row;
                const isOpen    = expandedRows.has(rowKey(m));
                const isEditing = editing === m.col;
                const ls        = LAYER_STYLE[m.layer] || LAYER_STYLE.UNKNOWN;

                return (
                  <div key={m.column_id || `${m.tableFqn}.${m.col}`}
                    style={{ borderTop: '1px solid var(--grey-100)',
                      background: m.internal ? 'var(--yellow-50)' : 'transparent' }}>

                    <div style={{ display: 'flex', gap: 10, padding: '11px 20px', alignItems: 'center' }}>
                      <input type="checkbox" checked={selectedCols.has(m.col)}
                        onChange={e => {
                          const next = new Set(selectedCols);
                          e.target.checked ? next.add(m.col) : next.delete(m.col);
                          setSelectedCols(next);
                        }}
                        onClick={e => e.stopPropagation()} />
                      <button onClick={() => setExpandedRows(prev => {
                          const next = new Set(prev);
                          isOpen ? next.delete(rowKey(m)) : next.add(rowKey(m));
                          return next;
                        })}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0, color: 'var(--fg-3)' }}>
                        <IcoChevron open={isOpen} />
                      </button>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                          <Mono style={{ fontWeight: 700, fontSize: 13 }}>{m.col}</Mono>
                          {!isOpen && busNames[m.col] && (
                            <span style={{ fontSize: 11.5, color: 'var(--fg-2)', fontStyle: 'italic' }}>
                              {busNames[m.col]}
                            </span>
                          )}
                          {m.dataType && (
                            <span style={{ fontSize: 11, color: 'var(--fg-3)', background: 'var(--grey-100)',
                              padding: '1px 6px', borderRadius: 4 }}>{m.dataType}</span>
                          )}
                          {/* Show layer badge only in ALL mode (sidebar already groups by layer) */}
                          {!selectedFqn && m.layer && m.layer !== 'UNKNOWN' && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                              letterSpacing: 0.4, background: ls.bg, color: ls.fg }}>{m.layer}</span>
                          )}
                          {m.cde && <Chip intent="brand" size="sm" dot>CDE · {m.cdeScore}</Chip>}
                          {m.internal && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <IcoWarning />
                              <span style={{ fontSize: 10, color: 'var(--yellow-700)' }}>internal</span>
                            </span>
                          )}
                          {m.aiSuggested !== undefined && (
                            <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4,
                              background: m.aiSuggested ? 'var(--blue-50)' : 'var(--grey-100)',
                              color: m.aiSuggested ? 'var(--blue-700)' : 'var(--fg-3)' }}>
                              {m.aiSuggested ? 'AI' : 'Manual'}
                            </span>
                          )}
                        </div>
                        {!isOpen && descs[m.col] && (
                          <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 2, lineHeight: 1.4,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 520 }}>
                            {busNames[m.col] && <span style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{busNames[m.col]}: </span>}
                            {descs[m.col]}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        {!m.cde && (
                          <span style={{ fontSize: 12, minWidth: 24, textAlign: 'right', fontWeight: 600,
                            color: m.cdeScore >= 70 ? 'var(--green-600)' : m.cdeScore >= 40 ? 'var(--yellow-600)' : 'var(--fg-4, var(--fg-3))' }}>
                            {m.cdeScore > 0 ? m.cdeScore : '—'}
                          </span>
                        )}
                        {m.status === 'approved'
                          ? <Chip intent="success" size="sm">Approved</Chip>
                          : m.status === 'rejected'
                          ? <Chip intent="neutral" size="sm">Rejected</Chip>
                          : <Chip intent="neutral" variant="outline" size="sm">Draft</Chip>}

                        <div style={{ display: 'flex', gap: 3 }}>
                          {m.status !== 'approved' && (
                            <button title="Approve" onClick={() => decide(m.col, 'approved')}
                              style={{ ...iconBtnBase, color: 'var(--green-600)' }}>
                              <IcoCheck />
                            </button>
                          )}
                          {m.status !== 'rejected' && !isEditing && (
                            <button title="Edit" onClick={() => { setEditing(m.col); setExpandedRows(prev => new Set(prev).add(rowKey(m))); }}
                              style={iconBtnBase}>
                              <IcoPencil />
                            </button>
                          )}
                          {m.cde ? (
                            <button title="Demote from CDE" onClick={() => demoteColumn(m)}
                              style={{ ...iconBtnBase, color: 'var(--red-500)' }}>
                              <IcoArrowDown />
                            </button>
                          ) : m.canPromote ? (
                            <button title="Promote to CDE" onClick={() => promoteColumn(m)}
                              style={{ ...iconBtnBase, color: 'var(--brand)' }}>
                              <IcoArrowUp />
                            </button>
                          ) : (m.status !== 'rejected' && (
                            <button title="Reject" onClick={() => decide(m.col, 'rejected')}
                              style={{ ...iconBtnBase, color: 'var(--red-500)' }}>
                              <IcoX />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Expanded detail panel */}
                    {isOpen && (
                      <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--grey-100)',
                        background: 'var(--grey-50)' }}>
                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                          <div style={{ flex: 2, minWidth: 240 }}>
                            <label style={{ fontSize: 10, color: 'var(--fg-3)', display: 'block',
                              marginBottom: 5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                              Description
                            </label>
                            {isEditing ? (
                              <textarea value={descs[m.col] || ''} rows={4}
                                onChange={e => setDescs(d => ({ ...d, [m.col]: e.target.value }))}
                                style={{ width: '100%', padding: 10, borderRadius: 8,
                                  border: '1px solid var(--brand)', fontSize: 13, resize: 'vertical',
                                  outline: 'none', boxShadow: '0 0 0 3px var(--brand-ring)',
                                  boxSizing: 'border-box', lineHeight: 1.5 }} />
                            ) : (
                              <div style={{ fontSize: 13, color: 'var(--fg-1)', lineHeight: 1.55 }}>
                                {descs[m.col] || <em style={{ color: 'var(--fg-3)' }}>No description yet</em>}
                              </div>
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 200, display: 'grid',
                            gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
                            {[
                              { label: 'Business name', value: busNames[m.col], setter: setBusNames },
                              { label: 'Business owner', value: owners[m.col], setter: setOwners },
                            ].map(({ label, value, setter }) => (
                              <div key={label}>
                                <label style={{ fontSize: 10, color: 'var(--fg-3)', display: 'block',
                                  marginBottom: 3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                                  {label}
                                </label>
                                {isEditing ? (
                                  <input value={value || ''}
                                    onChange={e => setter(s => ({ ...s, [m.col]: e.target.value }))}
                                    style={{ width: '100%', padding: '4px 8px', borderRadius: 6,
                                      border: '1px solid var(--grey-200)', fontSize: 12, boxSizing: 'border-box' }} />
                                ) : (
                                  <span style={{ fontSize: 12, color: 'var(--fg-1)' }}>{value || '—'}</span>
                                )}
                              </div>
                            ))}
                            <div>
                              <label style={{ fontSize: 10, color: 'var(--fg-3)', display: 'block',
                                marginBottom: 3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                                Format standard
                              </label>
                              <Mono style={{ fontSize: 11, color: 'var(--fg-2)' }}>{m.formatStd || '—'}</Mono>
                            </div>
                            <div>
                              <label style={{ fontSize: 10, color: 'var(--fg-3)', display: 'block',
                                marginBottom: 3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                                CDE score
                              </label>
                              <span style={{ fontSize: 12, fontWeight: 700,
                                color: m.cdeScore >= 70 ? 'var(--green-600)' : m.cdeScore >= 40 ? 'var(--yellow-600)' : 'var(--fg-3)' }}>
                                {m.cdeScore || '—'}
                              </span>
                            </div>
                            {m.sensitivityTag && m.sensitivityTag !== 'NONE' && (
                              <div>
                                <label style={{ fontSize: 10, color: 'var(--fg-3)', display: 'block',
                                  marginBottom: 3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                                  Sensitivity
                                </label>
                                <Chip intent={SENS_INTENT[m.sensitivityTag] || 'neutral'} size="sm">
                                  {m.sensitivityTag}
                                </Chip>
                              </div>
                            )}
                            {!selectedFqn && m.tableFqn && (
                              <div>
                                <label style={{ fontSize: 10, color: 'var(--fg-3)', display: 'block',
                                  marginBottom: 3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                                  Table
                                </label>
                                <Mono style={{ fontSize: 11, color: 'var(--fg-2)' }}>{m.tableFqn}</Mono>
                              </div>
                            )}
                          </div>
                        </div>
                        {isEditing && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                            <Button size="sm" variant="primary" onClick={() => saveEdit(m.col)}>Save edits</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>

            {/* CDE registry + PII */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
              <Card style={{ flex: 2, minWidth: 300 }}>
                <SectionTitle icon="shield-alert">
                  Critical Data Element registry
                  {selectedFqn && <span style={{ fontWeight: 400, color: 'var(--fg-3)', fontSize: 12, marginLeft: 6 }}>· {selectedFqn.split('.').pop()}</span>}
                </SectionTitle>
                {displayedCdeRows.length === 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                    {selectedFqn
                      ? 'No CDEs for this table. Promote columns with CDE score > 40 using the ↑ button.'
                      : 'No CDEs registered. Promote columns with CDE score > 40 using the ↑ button.'}
                  </span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {displayedCdeRows.map((c, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 6px',
                        borderBottom: i < displayedCdeRows.length - 1 ? '1px solid var(--grey-100)' : 'none' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Mono style={{ fontWeight: 600, fontSize: 13, display: 'block' }}>{c.name}</Mono>
                          <Mono style={{ fontSize: 11, color: 'var(--fg-3)' }}>{c.table}</Mono>
                        </div>
                        <Chip intent={c.health === 'PASS' ? 'success' : c.health === 'WARN' ? 'warning' : 'danger'}
                          size="sm" dot>{c.health}</Chip>
                        <div style={{ textAlign: 'right', minWidth: 90, flexShrink: 0 }}>
                          <div style={{ fontSize: 11, color: 'var(--fg-2)' }}>{c.promotedBy}</div>
                          <div style={{ fontSize: 10, color: 'var(--fg-3)' }}>{c.promotedAt}</div>
                        </div>
                        {c.ruleCount > 0 && <Chip intent="neutral" size="sm">{c.ruleCount} rules</Chip>}
                        <button title="Demote from CDE" onClick={() => demoteColumn(c)}
                          style={{ ...iconBtnBase, color: 'var(--red-500)' }}>
                          <IcoArrowDown />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              <Card style={{ flex: 1, minWidth: 200 }}>
                <SectionTitle icon="lock">PII & sensitivity</SectionTitle>
                {piiCols.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {piiCols.map(m => (
                      <div key={m.column_id || `${m.tableFqn}.${m.col}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <IcoShield />
                        <Mono style={{ flex: 1, fontSize: 12 }}>{m.col}</Mono>
                        <Chip intent={SENS_INTENT[m.sensitivityTag] || 'purple'} size="sm">
                          {m.sensitivityTag !== 'NONE' ? m.sensitivityTag : 'PII'}
                        </Chip>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>No PII columns detected.</span>
                )}
              </Card>
            </div>

            {/* Bottom actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <Button variant="soft" icon="plus" onClick={() => setShowAddModal(true)}>
                  Add column manually
                </Button>
                <Button variant="soft" icon="download" disabled={metaRows.length === 0}
                  onClick={handleExport}>
                  Export dictionary
                </Button>
              </div>
              <Button variant="primary" iconRight="arrow-right" onClick={() => go('rules')}>
                Proceed to Rule Studio
              </Button>
            </div>
          </div>{/* end main content */}
        </div>{/* end two-column layout */}

        {/* Add column modal */}
        {showAddModal && (
          <AddColumnModal
            connId={activeConnectionId}
            defaultTableFqn={selectedFqn || activeTableFqn}
            onClose={() => setShowAddModal(false)}
            onSubmit={() => { setShowAddModal(false); loadData(); }}
          />
        )}
      </div>
    );
  };

  window.DTScreens.metadata = Metadata;
})();
