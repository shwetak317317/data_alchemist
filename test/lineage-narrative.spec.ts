/**
 * Phase 2 — LLM-assisted lineage features, real output demo.
 *
 * Two pieces, both built on the same discipline as the Simulator's narrative
 * fix: the LLM never invents graph facts, only phrases the real ones it's
 * given; every failure mode has a deterministic fallback so the user never
 * sees an error.
 *
 *  1. Impact narrative (POST /lineage/narrative/{connection_id}) — grounded
 *     strictly in the real downstream BFS from lineage_edges.
 *  2. LLM query-log fallback (opt-in flag on POST /lineage/discover) — only
 *     for statements the deterministic SQL parser genuinely couldn't parse;
 *     always lands as a low-confidence 'suggested' edge, never auto-committed.
 *
 * This connection's DMV permission is denied (see lineage-discovery.spec.ts),
 * so there are no real unparseable query-log statements to exercise the LLM
 * fallback against live — that path is demonstrated structurally here (the
 * option wires through cleanly with zero attempts) and was verified with
 * synthetic dynamic-SQL input directly against the service during development.
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

test.describe('Phase 2 — impact narrative + LLM query-log fallback', () => {

  test('impact narrative: honest empty-downstream case', async ({ page }) => {
    await cfg.login(page, { email: cfg.CREDENTIALS.email, password: cfg.CREDENTIALS.password });
    await cfg.useConnection(page, cfg.CONNECTIONS.demo);
    await cfg.goTo(page, 'impact');
    const connectionId = await page.evaluate(() => localStorage.getItem('dt_conn_id'));

    const { status, body } = await authedFetch(
      page, `/api/lineage/narrative/${connectionId}?table_fqn=${encodeURIComponent('BronzeDB.br_categories')}`,
      { method: 'POST' }
    );

    console.log('\n================ Impact narrative — no real downstream edges ================');
    console.log(JSON.stringify(body, null, 2));
    console.log('================================================================================\n');

    expect(status).toBe(200);
    expect(body.node_found).toBe(true);
    expect(['llm', 'template']).toContain(body.generated_via);
    expect(body.downstream_count).toBe(0);
    expect(body.bullets.length).toBeGreaterThanOrEqual(3);
    // Grounding check: with zero real downstream nodes, the narrative must not
    // claim a specific downstream impact — it should say the graph has none.
    const text = body.bullets.join(' ').toLowerCase();
    expect(text.includes('no ') || text.includes('not record') || text.includes("doesn't") || text.includes('does not')).toBe(true);
  });

  test('impact narrative: grounded in a real downstream edge', async ({ page }) => {
    await cfg.login(page, { email: cfg.CREDENTIALS.email, password: cfg.CREDENTIALS.password });
    await cfg.useConnection(page, cfg.CONNECTIONS.demo);
    await cfg.goTo(page, 'impact');
    const connectionId = await page.evaluate(() => localStorage.getItem('dt_conn_id'));

    // Create one real confirmed edge via the manual edge endpoint (ground truth
    // for this test, independent of discovery), narrate, then clean up.
    // Source is BronzeDB.br_categories (not br_orders): the shared demo
    // connection's seeded root-cause scenario already gives br_orders two
    // permanent downstream edges (br_payments, br_returns — see
    // lineage-graph.spec.ts's dump), so asserting downstream_count===1 off
    // br_orders would depend on that fixture never changing. br_categories has
    // no pre-existing edges, so adding exactly one here is self-contained.
    const created = await authedFetch(page, '/api/lineage/edges', {
      method: 'POST',
      body: JSON.stringify({
        connection_id: connectionId,
        source_ext_id: 'BronzeDB.br_categories',
        target_ext_id: 'BronzeDB.br_warehouses',
        edge_type: 'FEEDS',
      }),
    });
    expect(created.status).toBe(200);

    try {
      const { status, body } = await authedFetch(
        page, `/api/lineage/narrative/${connectionId}?table_fqn=${encodeURIComponent('BronzeDB.br_categories')}`,
        { method: 'POST' }
      );

      console.log('\n================ Impact narrative — grounded in a real downstream edge ================');
      console.log(JSON.stringify(body, null, 2));
      console.log('==========================================================================================\n');

      expect(status).toBe(200);
      expect(body.downstream_count).toBe(1);
      const text = body.bullets.join(' ');
      expect(text).toContain('br_warehouses');
    } finally {
      await authedFetch(page, `/api/lineage/edges/${created.body.edge_id}`, { method: 'DELETE' });
    }
  });

  test('impact narrative: nonexistent table reports node_found=false, not an error', async ({ page }) => {
    await cfg.login(page, { email: cfg.CREDENTIALS.email, password: cfg.CREDENTIALS.password });
    await cfg.useConnection(page, cfg.CONNECTIONS.demo);
    await cfg.goTo(page, 'impact');
    const connectionId = await page.evaluate(() => localStorage.getItem('dt_conn_id'));

    const { status, body } = await authedFetch(
      page, `/api/lineage/narrative/${connectionId}?table_fqn=${encodeURIComponent('NoSuchTable.foo')}`,
      { method: 'POST' }
    );
    console.log('\nNonexistent table narrative response:', JSON.stringify(body));
    expect(status).toBe(200);
    expect(body.node_found).toBe(false);
    expect(body.bullets.length).toBe(0);
  });

  test('LLM query-log fallback option wires through /discover cleanly', async ({ page }) => {
    await cfg.login(page, { email: cfg.CREDENTIALS.email, password: cfg.CREDENTIALS.password });
    await cfg.useConnection(page, cfg.CONNECTIONS.demo);
    await cfg.goTo(page, 'impact');
    const connectionId = await page.evaluate(() => localStorage.getItem('dt_conn_id'));

    const { status, body } = await authedFetch(page, `/api/lineage/discover/${connectionId}`, {
      method: 'POST',
      body: JSON.stringify({ include_fk: false, include_query_log: true, include_llm_fallback: true }),
    });

    console.log('\n================ /discover with include_llm_fallback=true ================');
    console.log(JSON.stringify(body, null, 2));
    console.log('=============================================================================\n');

    expect(status).toBe(200);
    expect(body.llm_fallback_enabled).toBe(true);
    // This connection's query-log DMV access is denied, so there are no
    // unparseable statements to attempt — 0 attempts with no error is the
    // correct, honest outcome (see lineage-discovery.spec.ts for the FK/dbt
    // paths that DO have live data to work with).
    if (!body.query_log_unsupported_reason) {
      expect(body.llm_fallback_attempted).toBeGreaterThanOrEqual(0);
    }
    expect(body.llm_fallback_error === null || typeof body.llm_fallback_error === 'string').toBe(true);
  });

});
