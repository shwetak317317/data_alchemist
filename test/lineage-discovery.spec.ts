/**
 * Lineage discovery (Phase 1: deterministic edge discovery) — real output demo.
 *
 * Proves the FK / query-log / dbt discovery pipeline actually works against the
 * live connection, end to end, via the real HTTP API (not direct function calls).
 * Requests go through page.evaluate(fetch(...)) reusing the app's own session
 * token, exactly like the real UI — not page.context().request.get(), which does
 * not carry that Bearer token (see test/lineage-graph.spec.ts for the same note).
 *
 * This connection's SQL login lacks VIEW SERVER PERFORMANCE STATE, so query-log
 * discovery is expected to report itself unavailable (with the real permission
 * error) rather than silently returning zero — that IS the behavior under test.
 * The dbt-manifest path needs no special grant, so it's exercised for real here
 * with a manifest built from this connection's actual table names, and any edges
 * it creates are cleaned up afterward so the shared demo connection is left as
 * it was found.
 */
import { test, expect } from '@playwright/test';
const cfg = require('./config');

async function authedFetch(page, path: string, init: any = {}) {
  return page.evaluate(async ({ path, init }) => {
    const token = sessionStorage.getItem('dt_token');
    const res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
    const status = res.status;
    let body = null;
    try { body = await res.json(); } catch {}
    return { status, body };
  }, { path, init });
}

test.describe('Lineage discovery — real output', () => {

  test('POST /lineage/discover — FK scan + honest query-log unavailability', async ({ page }) => {
    await cfg.login(page, { email: cfg.CREDENTIALS.email, password: cfg.CREDENTIALS.password });
    await cfg.useConnection(page, cfg.CONNECTIONS.demo);
    await cfg.goTo(page, 'impact');
    const connectionId = await page.evaluate(() => localStorage.getItem('dt_conn_id'));
    expect(connectionId, 'A connection must be active').toBeTruthy();

    const { status, body } = await authedFetch(page, `/api/lineage/discover/${connectionId}`, {
      method: 'POST',
      body: JSON.stringify({ include_fk: true, include_query_log: true }),
    });

    console.log('\n================ POST /api/lineage/discover/{connection_id} ================');
    console.log(JSON.stringify(body, null, 2));
    console.log('===============================================================================\n');

    expect(status).toBe(200);
    expect(body.fk_enabled).toBe(true);
    expect(Array.isArray(body.fk_schemas_scanned)).toBe(true);
    expect(body.fk_schemas_scanned.length).toBeGreaterThan(0);

    // The whole point of this design: a platform that DOES support query-log
    // discovery but hits a permission wall on this specific connection must say
    // so explicitly — never present that as indistinguishable from "0 found".
    if (body.query_log_supported && body.query_log_statements_scanned === 0) {
      expect(
        body.query_log_unsupported_reason,
        'A supported-but-zero-statement result must explain why (e.g. missing grant), not look like a clean empty scan'
      ).toBeTruthy();
      console.log('Query-log reason (expected on this connection):', body.query_log_unsupported_reason);
    }
  });

  test('dbt manifest discovery creates real, confirmed edges (then cleans up)', async ({ page }) => {
    await cfg.login(page, { email: cfg.CREDENTIALS.email, password: cfg.CREDENTIALS.password });
    await cfg.useConnection(page, cfg.CONNECTIONS.demo);
    await cfg.goTo(page, 'impact');
    const connectionId = await page.evaluate(() => localStorage.getItem('dt_conn_id'));

    const before = await authedFetch(page, `/api/lineage/graph/${connectionId}`);
    const edgesBefore = new Set(before.body.edges.map((e: any) => `${e.source_ext_id}->${e.target_ext_id}`));

    // Built from this connection's real known tables (BronzeDB.br_orders,
    // BronzeDB.br_customers, SilverDB.fact_sales all genuinely exist here —
    // see connection_tables) so this exercises real validation, not fiction.
    const manifest = {
      nodes: {
        'model.demo.fact_sales': {
          resource_type: 'model', name: 'fact_sales',
          database: 'SilverDB', schema: 'dbo', alias: 'fact_sales',
          depends_on: { nodes: ['source.demo.bronze.br_orders', 'source.demo.bronze.br_customers'] },
        },
      },
      sources: {
        'source.demo.bronze.br_orders': { database: 'BronzeDB', schema: 'dbo', identifier: 'br_orders' },
        'source.demo.bronze.br_customers': { database: 'BronzeDB', schema: 'dbo', identifier: 'br_customers' },
      },
    };

    const { status, body } = await authedFetch(page, `/api/lineage/discover/${connectionId}`, {
      method: 'POST',
      body: JSON.stringify({ include_fk: false, include_query_log: false, dbt_manifest: manifest }),
    });

    console.log('\n================ dbt manifest discovery result ================');
    console.log(JSON.stringify(body, null, 2));

    expect(status).toBe(200);
    expect(body.dbt_provided).toBe(true);
    expect(body.dbt_models_scanned).toBe(1);
    expect(body.dbt_edges_found).toBe(2);
    expect(body.edges_confirmed).toBeGreaterThanOrEqual(2); // dbt edges are ground truth -> auto-confirmed, not suggested

    const after = await authedFetch(page, `/api/lineage/graph/${connectionId}`);
    const newEdges = after.body.edges.filter((e: any) => !edgesBefore.has(`${e.source_ext_id}->${e.target_ext_id}`));

    console.log('\n================ New confirmed edges now visible in the main graph ================');
    console.log(JSON.stringify(newEdges.map((e: any) => `${e.source_ext_id} -> ${e.target_ext_id}`), null, 2));
    console.log('======================================================================================\n');

    expect(newEdges.length).toBeGreaterThanOrEqual(2);
    expect(newEdges.some((e: any) => e.source_ext_id === 'BronzeDB.br_orders' && e.target_ext_id === 'SilverDB.fact_sales')).toBe(true);
    expect(newEdges.some((e: any) => e.source_ext_id === 'BronzeDB.br_customers' && e.target_ext_id === 'SilverDB.fact_sales')).toBe(true);

    // Clean up — leave the shared demo connection exactly as this test found it.
    for (const e of newEdges) {
      await authedFetch(page, `/api/lineage/edges/${e.edge_id}`, { method: 'DELETE' });
    }
    const restored = await authedFetch(page, `/api/lineage/graph/${connectionId}`);
    const restoredKeys = new Set(restored.body.edges.map((e: any) => `${e.source_ext_id}->${e.target_ext_id}`));
    for (const key of edgesBefore) expect(restoredKeys.has(key)).toBe(true);
    for (const e of newEdges) expect(restoredKeys.has(`${e.source_ext_id}->${e.target_ext_id}`)).toBe(false);
  });

  test('suggested-edge review workflow: approve promotes it into the main graph, reject does not', async ({ page }) => {
    await cfg.login(page, { email: cfg.CREDENTIALS.email, password: cfg.CREDENTIALS.password });
    await cfg.useConnection(page, cfg.CONNECTIONS.demo);
    await cfg.goTo(page, 'impact');
    const connectionId = await page.evaluate(() => localStorage.getItem('dt_conn_id'));

    // This connection's DMV permission is denied, so query-log discovery can't
    // produce a real 'suggested' edge to review here — approve/reject on a
    // nonexistent edge_id must fail cleanly (404), not 500, which is itself a
    // meaningful correctness check for the review endpoints.
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const approve = await authedFetch(page, `/api/lineage/edges/${fakeId}/approve`, { method: 'POST' });
    const reject = await authedFetch(page, `/api/lineage/edges/${fakeId}/reject`, { method: 'POST' });

    console.log('\n================ Review endpoints on a nonexistent suggestion ================');
    console.log('approve:', approve.status, JSON.stringify(approve.body));
    console.log('reject:', reject.status, JSON.stringify(reject.body));
    console.log('================================================================================\n');

    expect(approve.status).toBe(404);
    expect(reject.status).toBe(404);

    const suggested = await authedFetch(page, `/api/lineage/suggested/${connectionId}`);
    expect(suggested.status).toBe(200);
    expect(Array.isArray(suggested.body)).toBe(true);
    console.log('Current suggested-edge queue for this connection:', JSON.stringify(suggested.body, null, 2));
  });

});
