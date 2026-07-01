/**
 * DataTrust API client — thin fetch wrapper for all backend calls.
 * All functions return parsed JSON (or throw on non-2xx).
 * SSE streams are handled separately (see streamProfiling).
 */

const BASE = '/api';

function _authHeaders() {
  const token = sessionStorage.getItem('dt_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function _fetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ..._authHeaders(), ...opts.headers },
    ...opts,
  });
  if (res.status === 401) {
    // Token expired — clear session and reload to login screen
    sessionStorage.removeItem('dt_token');
    sessionStorage.removeItem('dt_user');
    window.location.reload();
    return;
  }
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${err}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Config ───────────────────────────────────────────────────────────────────
export const getConfig = () => _fetch('/config');

// ── Connections ───────────────────────────────────────────────────────────────
export const listConnections   = ()           => _fetch('/connections');
export const listPlatforms     = ()           => _fetch('/connections/platforms');
export const testConnection    = (body)       => _fetch('/connections/test', { method: 'POST', body: JSON.stringify(body) });
export const createConnection  = (body)       => _fetch('/connections', { method: 'POST', body: JSON.stringify(body) });
export const deleteConnection      = (id)       => _fetch(`/connections/${id}`, { method: 'DELETE' });
export const updateConnection      = (id, body) => _fetch(`/connections/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const getConnectionSchemas      = (id)       => _fetch(`/connections/${id}/schemas`);
export const getConnectionCredentials  = (id)       => _fetch(`/connections/${id}/credentials`);
export const testSavedConnection       = (id, body) => _fetch(`/connections/${id}/test`, { method: 'POST', body: JSON.stringify(body || {}) });

// ── Profiling ─────────────────────────────────────────────────────────────────
export const listDatasets      = (connId, useCache = false) => _fetch(`/profiling/datasets?connection_id=${connId}${useCache ? '&use_cache=true' : ''}`);
export const getReport         = (reportId)   => _fetch(`/profiling/report/${reportId}`);
export const getReportByTable  = (tableFqn, connId) => _fetch(`/profiling/report/by-table/${encodeURIComponent(tableFqn)}${connId ? `?connection_id=${connId}` : ''}`);

/**
 * Stream profiling progress events via SSE.
 * onProgress(event)  → called for each {type:'progress'} event
 * onReport(report)   → called once with the final {type:'report'} payload
 * onError(msg)       → called on error
 */
export function streamProfiling({ connectionId, schemaName, tableName, onProgress, onReport, onError }) {
  const body = JSON.stringify({ connection_id: connectionId, schema_name: schemaName, table_name: tableName });
  fetch(`${BASE}/profiling/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ..._authHeaders() }, body })
    .then(async res => {
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const body = await res.json(); if (body?.detail) msg = body.detail; } catch (_) {}
        onError?.(msg);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let gotReport = false;
      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) {
            // Stream closed: if no report was received, signal an error so
            // callers (e.g. batch mode) are not left hanging indefinitely.
            if (!gotReport) onError?.('Stream closed without a report');
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            try {
              const evt = JSON.parse(line.slice(5).trim());
              if (evt.type === 'progress') onProgress?.(evt.data);
              else if (evt.type === 'report') { gotReport = true; onReport?.(evt.data); }
              else if (evt.type === 'error')  onError?.(evt.message);
            } catch (_) {}
          }
          pump();
        }).catch(err => onError?.(err.message));
      }
      pump();
    })
    .catch(err => onError?.(err.message));
}

// ── Metadata ──────────────────────────────────────────────────────────────────
export const listDictionary    = (connId, table) => _fetch(`/metadata/dictionary?connection_id=${connId}${table ? `&table_fqn=${encodeURIComponent(table)}` : ''}`);
export const enrichMetadata    = (reportId, connId) => _fetch(`/metadata/enrich?report_id=${reportId}&connection_id=${connId}`, { method: 'POST' });
// Map past-tense UI values ("approved","rejected") to backend verb form ("approve","reject")
const _decisionVerb = (d) => ({ approved: 'approve', rejected: 'reject', edited: 'edit' }[d] || d);
export const decideColumn      = (colId, decision, body) => _fetch(`/metadata/dictionary/${encodeURIComponent(colId)}/${_decisionVerb(decision)}`, { method: 'POST', body: JSON.stringify(body) });
export const listCDEs          = (connId)         => _fetch(`/metadata/cdes?connection_id=${connId}`);
export const cdePromote        = (colId, action, body) => _fetch(`/metadata/cdes/${encodeURIComponent(colId)}/${action}`, { method: 'POST', body: JSON.stringify(body) });
export const bulkDecide        = (columnIds, decision) => _fetch('/metadata/dictionary/bulk-decide', { method: 'POST', body: JSON.stringify({ column_ids: columnIds, decision }) });
export const addColumnManually = (body)           => _fetch('/metadata/dictionary', { method: 'POST', body: JSON.stringify(body) });

// ── Rules ─────────────────────────────────────────────────────────────────────
export const listRules         = (connId, status) => _fetch(`/rules?connection_id=${connId}${status ? `&status=${status}` : ''}`);
export const recommendRules    = (body)           => _fetch('/rules/recommend', { method: 'POST', body: JSON.stringify(body) });
export const nlToRule          = (body)           => _fetch('/rules/nl', { method: 'POST', body: JSON.stringify(body) });
export const decideRule        = (ruleId, body)   => _fetch(`/rules/${ruleId}`, { method: 'PATCH', body: JSON.stringify(body) });
export const createRule        = (body)           => _fetch('/rules', { method: 'POST', body: JSON.stringify(body) });

// ── Execution ─────────────────────────────────────────────────────────────────
export const runExecution      = (connId)         => _fetch(`/execution/run?connection_id=${connId}`, { method: 'POST' });
export const getLatestRun      = (connId)         => _fetch(`/execution/latest?connection_id=${connId}`);
export const getRunResults     = (runId)           => _fetch(`/execution/results/${runId}`);
export const acknowledgeFailure = (body)           => _fetch('/execution/acknowledge', { method: 'POST', body: JSON.stringify(body) });

// ── Anomalies ─────────────────────────────────────────────────────────────────
export const getAnomalyInbox   = (connId)         => _fetch(`/anomalies/inbox${connId ? `?connection_id=${connId}` : ''}`);
export const getFingerprints   = (connId)         => _fetch(`/anomalies/fingerprints${connId ? `?connection_id=${connId}` : ''}`);
export const scanAnomalies     = (body)           => _fetch('/anomalies/scan', { method: 'POST', body: JSON.stringify(body) });
export const acknowledgeAnomaly = (id, body)      => _fetch(`/anomalies/${id}/acknowledge`, { method: 'POST', body: JSON.stringify(body) });
export const explainAnomaly    = (id)             => _fetch(`/anomalies/${id}/explain`, { method: 'POST' });

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const getDashboardSummary = (connId)       => _fetch(`/dashboard/summary${connId ? `?connection_id=${connId}` : ''}`);
export const getDashboardTrends  = (connId, days) => _fetch(`/dashboard/trends?days=${days || 14}${connId ? `&connection_id=${connId}` : ''}`);
export const getRuleFailTrend    = (connId, days) => _fetch(`/dashboard/rule-fail-trend?days=${days || 7}${connId ? `&connection_id=${connId}` : ''}`);
export const getCDEStatus        = (connId)       => _fetch(`/dashboard/cdes${connId ? `?connection_id=${connId}` : ''}`);
export const getAuditTrail       = (connId, limit) => _fetch(`/dashboard/audit?limit=${limit || 20}${connId ? `&connection_id=${connId}` : ''}`);

// ── Tasks ─────────────────────────────────────────────────────────────────────
export const listTasks         = (connId, status) => _fetch(`/tasks${connId || status ? '?' : ''}${connId ? `connection_id=${connId}` : ''}${connId && status ? '&' : ''}${status ? `status=${status}` : ''}`);
export const createTask        = (body)           => _fetch('/tasks', { method: 'POST', body: JSON.stringify(body) });
export const updateTask        = (id, body)       => _fetch(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteTask        = (id)             => _fetch(`/tasks/${id}`, { method: 'DELETE' });

// ── Intel ─────────────────────────────────────────────────────────────────────
export const getAdvisory       = (connId)         => _fetch(`/intel/advisory${connId ? `?connection_id=${connId}` : ''}`);
export const getReceipt        = (connId, table)  => _fetch(`/intel/receipt${connId ? `?connection_id=${connId}` : ''}${table ? `&table_fqn=${encodeURIComponent(table)}` : ''}`);

// ── Lineage ───────────────────────────────────────────────────────────────────
export const getLineage            = (tableFqn, connId) => _fetch(`/lineage/${encodeURIComponent(tableFqn)}${connId ? `?connection_id=${connId}` : ''}`);
export const getConnectionLineage  = (connId)           => _fetch(`/lineage/graph/${connId}`);
export const seedLineage           = (connId)           => _fetch(`/lineage/seed/${connId}`, { method: 'POST' });
export const propagateLineage      = (connId)           => _fetch(`/lineage/propagate/${connId}`, { method: 'POST' });
export const createLineageNode     = (body)             => _fetch('/lineage/nodes', { method: 'POST', body: JSON.stringify(body) });
export const updateLineageNode     = (nodeId, body)     => _fetch(`/lineage/nodes/${nodeId}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteLineageNode     = (nodeId)           => _fetch(`/lineage/nodes/${nodeId}`, { method: 'DELETE' });
export const createLineageEdge     = (body)             => _fetch('/lineage/edges', { method: 'POST', body: JSON.stringify(body) });
export const deleteLineageEdge     = (edgeId)           => _fetch(`/lineage/edges/${edgeId}`, { method: 'DELETE' });

// ── Simulation ────────────────────────────────────────────────────────────────
export const listScenarios         = ()              => _fetch('/simulation/scenarios');
export const getSimulationHistory  = (connId)        => _fetch(`/simulation/history${connId ? `?connection_id=${connId}` : ''}`);
export const remediateSimulation   = (runId, connId) => _fetch('/simulation/remediate', { method: 'POST', body: JSON.stringify({ run_id: runId, connection_id: connId || null }) });

/**
 * Stream scenario injection events via SSE.
 * onMeta(meta)          → called once with {key, run_id, scenario_type, drop, undercount, title, body}
 * onEvent(evt)          → called per event {at, kind, title, detail}
 * onNarrative(data)     → called with {text} when LLM narrative is ready
 * onDone()              → called when stream ends
 * onError(msg)          → called on error
 * Returns an abort function.
 */
export function streamSimulation({ scenarioText, connectionId, onMeta, onEvent, onNarrative, onDone, onError }) {
  const ctrl = new AbortController();
  const body = JSON.stringify({ scenario_text: scenarioText, connection_id: connectionId || null });
  fetch(`${BASE}/simulation/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body,
    signal: ctrl.signal,
  })
    .then(res => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) { onDone?.(); return; }
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop();
          for (const part of parts) {
            if (!part.startsWith('data:')) continue;
            try {
              const evt = JSON.parse(part.slice(5).trim());
              if (evt.type === 'meta')      onMeta?.(evt.data);
              else if (evt.type === 'event')     onEvent?.(evt.data);
              else if (evt.type === 'narrative') onNarrative?.(evt.data);
              else if (evt.type === 'done')      onDone?.();
              else if (evt.type === 'error')     onError?.(evt.message);
            } catch (_) {}
          }
          pump();
        }).catch(err => { if (err.name !== 'AbortError') onError?.(err.message); });
      }
      pump();
    })
    .catch(err => { if (err.name !== 'AbortError') onError?.(err.message); });
  return () => ctrl.abort();
}
