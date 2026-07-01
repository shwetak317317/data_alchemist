/**
 * Phase 0 — connection isolation for the lineage module.
 *
 * Creates a second, throwaway DuckDB in-memory connection (no real external
 * system touched), seeds a distinct node under it, and proves every lineage
 * read endpoint keeps the two connections' data completely separate — the
 * kind of check that's cheap to write and catastrophic to skip if a WHERE
 * connection_id clause is ever missing.
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

test.describe('Lineage — connection isolation', () => {

  test('a node created under connection B never appears in connection A\'s graph, and vice versa', async ({ page }) => {
    await cfg.login(page, { email: cfg.CREDENTIALS.email, password: cfg.CREDENTIALS.password });
    await cfg.useConnection(page, cfg.CONNECTIONS.demo);
    await cfg.goTo(page, 'impact');
    const connA = await page.evaluate(() => localStorage.getItem('dt_conn_id'));
    expect(connA, 'A real active connection must exist to compare against').toBeTruthy();

    // 1. Create a throwaway second connection (DuckDB in-memory — no real system touched).
    const created = await authedFetch(page, '/api/connections', {
      method: 'POST',
      body: JSON.stringify({
        name: `Isolation Test ${Date.now()}`,
        platform: 'duckdb',
        environment: 'test',
        credentials: { file_path: ':memory:' },
        schemas_scope: [],
      }),
    });
    expect(created.status).toBe(201);
    const connB = created.body.id;
    console.log(`\nCreated throwaway connection B: ${connB}`);
    let nodeId: string | null = null;

    try {
      // 2. Seed one distinctly-named node under connection B only.
      const uniqueLabel = `IsolationCheck_${Date.now()}`;
      const nodeCreated = await authedFetch(page, '/api/lineage/nodes', {
        method: 'POST',
        body: JSON.stringify({
          connection_id: connB,
          external_id: `TestDB.${uniqueLabel}`,
          label: `TestDB.${uniqueLabel}`,
          layer: 'BRONZE',
          node_type: 'table',
        }),
      });
      expect(nodeCreated.status).toBe(200);
      nodeId = nodeCreated.body.node_id;

      // 3. Connection A's graph must NEVER contain connection B's node.
      const graphA = await authedFetch(page, `/api/lineage/graph/${connA}`);
      expect(graphA.status).toBe(200);
      const aLabels = graphA.body.nodes.map((n: any) => n.label);
      expect(aLabels).not.toContain(`TestDB.${uniqueLabel}`);
      console.log(`Connection A graph: ${graphA.body.nodes.length} nodes, none named ${uniqueLabel} — confirmed`);

      // 4. Connection B's graph must contain ONLY its own node — none of A's real tables.
      const graphB = await authedFetch(page, `/api/lineage/graph/${connB}`);
      expect(graphB.status).toBe(200);
      expect(graphB.body.nodes.length).toBe(1);
      expect(graphB.body.nodes[0].label).toBe(`TestDB.${uniqueLabel}`);
      const bLabels = graphB.body.nodes.map((n: any) => n.label);
      for (const realTable of ['BronzeDB.br_orders', 'BronzeDB.br_customers']) {
        expect(bLabels).not.toContain(realTable);
      }
      console.log(`Connection B graph: exactly 1 node (its own), zero of connection A's real tables — confirmed`);

      // 5. Suggested-edges queue is also connection-scoped.
      const suggestedB = await authedFetch(page, `/api/lineage/suggested/${connB}`);
      expect(suggestedB.status).toBe(200);
      expect(suggestedB.body).toEqual([]);

      // 6. Discovery run against B must not touch or see A's data (schemas_scope
      // is empty for B, so this should be a clean no-op, not an error, and must
      // not somehow report A's tables).
      const discoverB = await authedFetch(page, `/api/lineage/discover/${connB}`, {
        method: 'POST',
        body: JSON.stringify({ include_fk: true, include_query_log: false }),
      });
      console.log('\nDiscovery run against isolated connection B (expected to find nothing):');
      console.log(JSON.stringify(discoverB.body, null, 2));
      expect(discoverB.status).toBe(200);
      expect(discoverB.body.fk_edges_found).toBe(0);
    } finally {
      // Clean up: the lineage node explicitly (connection soft-delete via
      // deleted_at does NOT cascade to lineage_nodes — only a hard DELETE on
      // the connections row would), then the connection itself.
      if (nodeId) await authedFetch(page, `/api/lineage/nodes/${nodeId}`, { method: 'DELETE' });
      await authedFetch(page, `/api/connections/${connB}`, { method: 'DELETE' });
    }
  });

});
