/**
 * Diagnostic: Why do Bronze / Silver show 0 tables?
 *
 * Hits the backend API directly (no browser) to inspect every step of the
 * schema→layer→table resolution chain.
 *
 * Run:  node test/test_profiling_layers.js
 */

const http = require('http');
const { CREDENTIALS } = require('./config');

const BASE = 'http://localhost/api';

// ── thin fetch helper ─────────────────────────────────────────────────────────
function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost',
      port: 80,
      path: '/api' + path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 400)}`));
          return;
        }
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('=== Profiling Layer Diagnostic ===\n');

  // 1. Login
  console.log('[1] Logging in as', CREDENTIALS.email);
  let token;
  try {
    const res = await api('POST', '/auth/login', {
      email: CREDENTIALS.email,
      password: CREDENTIALS.password,
    });
    token = res.access_token;
    console.log('    ✅ Token received\n');
  } catch (e) {
    console.error('    ❌ Login failed:', e.message);
    process.exit(1);
  }

  // 2. List connections
  console.log('[2] Listing connections');
  let connections;
  try {
    connections = await api('GET', '/connections', null, token);
    if (!connections.length) {
      console.log('    ⚠️  No connections found — add one first');
      process.exit(0);
    }
    connections.forEach(c => {
      console.log(`    • [${c.platform}] "${c.name}"  id=${c.id}`);
      console.log(`      org_id scope  : ${JSON.stringify(c.schemas_scope)}`);
      console.log(`      status        : ${c.status}`);
    });
    console.log();
  } catch (e) {
    console.error('    ❌ list connections failed:', e.message);
    process.exit(1);
  }

  // 3. For each non-demo connection, probe schemas and datasets
  for (const conn of connections) {
    if (conn.platform === 'demo') {
      console.log(`[skip] "${conn.name}" is a demo connection\n`);
      continue;
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Connection: "${conn.name}" (${conn.platform})`);
    console.log(`${'─'.repeat(60)}`);

    // 3a. Available schemas from the connector
    console.log('\n[3a] GET /connections/{id}/schemas  (live connector)');
    try {
      const scData = await api('GET', `/connections/${conn.id}/schemas`, null, token);
      console.log('     available schemas :', JSON.stringify(scData.available));
      console.log('     selected (scope)  :', JSON.stringify(scData.selected));

      if (!scData.available.length) {
        console.log('     ⚠️  Connector returned NO schemas — check host/credentials/firewall');
      }
      if (scData.selected.length && !scData.available.some(s => scData.selected.includes(s))) {
        console.log('     ⚠️  MISMATCH: selected schemas are not in available list');
        console.log('        → Tables will always be 0 because scope filter excludes everything');
      }
    } catch (e) {
      console.log('     ❌ /schemas call failed:', e.message);
      if (e.message.includes('503') || e.message.includes('500')) {
        console.log('        → Connector cannot reach the database');
        console.log('        → If using localhost on Docker, change host to host.docker.internal');
      }
    }

    // 3b. Dataset tree (/profiling/datasets)
    console.log('\n[3b] GET /profiling/datasets  (full layer tree)');
    try {
      const datasets = await api('GET', `/profiling/datasets?connection_id=${conn.id}`, null, token);

      if (!datasets.length) {
        console.log('     ❌ API returned empty array — connector likely failed entirely');
        console.log('        Check backend logs: docker compose logs backend | tail -50');
        continue;
      }

      let totalTables = 0;
      datasets.forEach(group => {
        const n = group.tables.length;
        totalTables += n;
        const flag = n === 0 ? ' ← ⚠️  EMPTY' : '';
        console.log(`     ${(group.layer || group.schema || '?').padEnd(10)}  schema="${group.schema || '?'}"  tables=${n}${flag}`);
        if (n > 0) {
          group.tables.slice(0, 5).forEach(t => console.log(`       - ${t.name}`));
          if (n > 5) console.log(`       ... and ${n - 5} more`);
        }
      });

      console.log(`\n     Total tables visible: ${totalTables}`);

      // Diagnose specific patterns
      const layerNames = datasets.map(g => (g.layer || '').toUpperCase());
      const emptyLayers = datasets.filter(g => g.tables.length === 0).map(g => g.layer || g.schema);
      const filledLayers = datasets.filter(g => g.tables.length > 0).map(g => g.layer || g.schema);

      if (emptyLayers.length > 0 && filledLayers.length > 0) {
        console.log('\n  🔍 DIAGNOSIS: Some layers have tables, others are empty');
        console.log('     Filled :', filledLayers.join(', '));
        console.log('     Empty  :', emptyLayers.join(', '));
        console.log('\n  Likely causes:');
        console.log('  A) Cross-DB mode: SQL login lacks CONNECT permission on those databases');
        console.log('     Fix: GRANT CONNECT ON DATABASE::bronze TO <login>');
        console.log('         GRANT SELECT ON SCHEMA::dbo TO <login> -- inside bronze DB');
        console.log('  B) Single-DB mode: connection is locked to one database (e.g. "raw")');
        console.log('     Fix: remove "database" from connection config, use cross-DB mode');
        console.log('  C) schemas_scope filter excludes bronze/silver — edit connection schemas');
        console.log('     Current scope:', JSON.stringify(conn.schemas_scope));
      } else if (totalTables === 0) {
        console.log('\n  ❌ ALL layers empty — connector failed for all schemas');
        console.log('  Check: docker compose logs backend | grep "list_tables\\|list_datasets"');
      }
    } catch (e) {
      console.log('     ❌ /profiling/datasets failed:', e.message);
    }
  }

  console.log('\n=== Done — check backend logs for full stack traces ===');
  console.log('  docker compose logs backend --tail=80 | grep -E "ERROR|WARNING|list_tables"\n');
})();
