// Full UI/UX + PM audit of Rule Studio — every component, every click flow.
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, ss, collectJsErrors, useConnection, CONNECTIONS } = require('./config');

const apiCalls = [];
function trackApi(page) {
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/')) {
      let bodySnippet = '';
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('application/json')) bodySnippet = (await res.text()).slice(0, 400);
      } catch (_) {}
      apiCalls.push({
        method: res.request().method(),
        url: url.replace('http://localhost', ''),
        status: res.status(),
        body: bodySnippet,
        t: Date.now(),
      });
    }
  });
}
function tail(n = 15) {
  apiCalls.slice(-n).forEach(c => console.log(`    [API] ${c.method} ${c.url} -> ${c.status}  ${c.status >= 400 ? c.body : ''}`));
}

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  const errors = collectJsErrors(page);
  trackApi(page);

  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    console.log('=== Logged in, pinned to demo connection ===');

    await goTo(page, 'rules');
    await page.waitForTimeout(1500);
    await ss(page, '01-initial-load');
    console.log('--- 01 initial load ---');
    tail(20);

    // ── Sidebar exploration ──────────────────────────────────────────────
    const sidebarInfo = await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      if (!container) return null;
      const layerBtns = Array.from(container.querySelectorAll('button')).map(b => b.innerText.trim());
      return layerBtns;
    });
    console.log('Sidebar buttons:', JSON.stringify(sidebarInfo));

    // Collapse/expand first layer group
    const layerHeader = page.locator('div[style*="248px"] button').filter({ hasText: /^[A-Z]+\n/ }).first();
    if (await layerHeader.count()) {
      await layerHeader.click();
      await page.waitForTimeout(300);
      await ss(page, '02-sidebar-layer-collapsed');
      await layerHeader.click();
      await page.waitForTimeout(300);
      await ss(page, '03-sidebar-layer-expanded');
    }

    // Click first real table row
    const tableClicked = await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      if (!container) return 'NO_SIDEBAR_FOUND';
      const btns = Array.from(container.querySelectorAll('button'));
      for (const b of btns) {
        const txt = b.innerText.trim().split('\n')[0];
        if (!txt || txt === 'All tables') continue;
        if (/^[A-Z_]+$/.test(txt)) continue;
        b.click();
        return txt;
      }
      return null;
    });
    console.log('Clicked table:', tableClicked);
    await page.waitForTimeout(800);
    await ss(page, '04-table-selected');
    tail(10);

    // Click "All tables" to deselect
    await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      if (!container) return;
      const btn = Array.from(container.querySelectorAll('button')).find(b => b.innerText.trim() === 'All tables');
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);
    await ss(page, '05-all-tables-deselected');

    // ── Filter pills: Layer ──────────────────────────────────────────────
    for (const layer of ['RAW', 'BRONZE', 'SILVER', 'GOLD']) {
      const btn = page.locator('button', { hasText: new RegExp(`^${layer}$`) }).first();
      if (await btn.count()) {
        await btn.click();
        await page.waitForTimeout(300);
        await ss(page, `06-filter-layer-${layer}`);
      }
    }
    // back to ALL
    await page.locator('button', { hasText: /^ALL$/ }).first().click().catch(() => {});
    await page.waitForTimeout(300);

    // ── Filter pills: Status ─────────────────────────────────────────────
    for (const [label] of [['Pending'], ['Approved'], ['Active'], ['Snoozed'], ['Rejected']]) {
      const btn = page.locator('button', { hasText: new RegExp(`^${label}$`) }).first();
      if (await btn.count()) {
        await btn.click();
        await page.waitForTimeout(300);
        await ss(page, `07-filter-status-${label}`);
      }
    }
    await page.locator('button', { hasText: /^All$/ }).first().click().catch(() => {});
    await page.waitForTimeout(300);

    // ── Filter pills: Type ───────────────────────────────────────────────
    for (const label of ['Null', 'Range', 'Format', 'FK', 'Volume', 'Custom']) {
      const btn = page.locator('button', { hasText: new RegExp(`^${label}$`) }).first();
      if (await btn.count()) {
        await btn.click();
        await page.waitForTimeout(300);
        await ss(page, `08-filter-type-${label}`);
      }
    }
    await page.locator('button', { hasText: /^All$/ }).first().click().catch(() => {});
    await page.waitForTimeout(300);

    // ── Search — matching, then no-match ─────────────────────────────────
    const searchInput = page.locator('input[placeholder="Search rules…"]');
    await searchInput.fill('order');
    await page.waitForTimeout(400);
    await ss(page, '09-search-matching');
    await searchInput.fill('zzz_nonexistent_xyz');
    await page.waitForTimeout(400);
    await ss(page, '10-search-no-match-empty-state');
    await searchInput.fill('');
    await page.waitForTimeout(300);

    // ── Select a table with rules, screenshot rule list detail ───────────
    await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      const btns = Array.from(container.querySelectorAll('button'));
      for (const b of btns) {
        const txt = b.innerText.trim().split('\n')[0];
        if (!txt || txt === 'All tables' || /^[A-Z_]+$/.test(txt)) continue;
        b.click();
        return;
      }
    });
    await page.waitForTimeout(600);
    await ss(page, '11-table-with-rules-detail');

    // ── Per-rule actions: Edit expression inline ──────────────────────────
    const editBtn = page.locator('button[title="Edit"]').first();
    if (await editBtn.count()) {
      await editBtn.click();
      await page.waitForTimeout(300);
      await ss(page, '12-rule-edit-mode');
      // Cancel
      await page.locator('button', { hasText: 'Cancel' }).first().click().catch(() => {});
      await page.waitForTimeout(300);
    }

    // ── Per-rule actions: Snooze picker ───────────────────────────────────
    const snoozeBtn = page.locator('button[title="Snooze"]').first();
    if (await snoozeBtn.count()) {
      await snoozeBtn.click();
      await page.waitForTimeout(300);
      await ss(page, '13-snooze-picker-open');
      // Try confirm without date (should be disabled)
      const confirmBtn = page.locator('button', { hasText: 'Confirm' }).first();
      const isDisabled = await confirmBtn.isDisabled().catch(() => null);
      console.log('Snooze Confirm disabled with no date?', isDisabled);
      await ss(page, '14-snooze-confirm-disabled-state');
      // Cancel
      await page.locator('button', { hasText: 'Cancel' }).first().click().catch(() => {});
      await page.waitForTimeout(300);
    }

    // ── Per-rule actions: Approve (own rule should be disabled) ───────────
    const approveBtn = page.locator('button[title*="Approve"], button[title*="ask a teammate"]').first();
    if (await approveBtn.count()) {
      const title = await approveBtn.getAttribute('title');
      const disabled = await approveBtn.isDisabled().catch(() => null);
      console.log('First approve button title:', title, 'disabled:', disabled);
      await ss(page, '15-approve-button-state');
    }

    // ── Per-rule actions: Reject ───────────────────────────────────────────
    // Find a draft rule's reject button, click it, observe state change
    const rejectBtn = page.locator('button[title="Reject"]').first();
    if (await rejectBtn.count()) {
      await rejectBtn.click();
      await page.waitForTimeout(700);
      await ss(page, '16-after-reject');
      tail(5);
    }

    // ── Action row: Run {layer} with no runnable rules ────────────────────
    const runBtn = page.locator('button', { hasText: /^Run / }).first();
    if (await runBtn.count()) {
      await runBtn.click();
      await page.waitForTimeout(700);
      await ss(page, '17-run-layer-clicked');
      tail(5);
    }

    // ── Action row: Bulk approve LOW ──────────────────────────────────────
    const bulkBtn = page.locator('button', { hasText: 'Bulk approve LOW' }).first();
    if (await bulkBtn.count()) {
      await bulkBtn.click();
      await page.waitForTimeout(900);
      await ss(page, '18-bulk-approve-low-clicked');
      tail(8);
    }

    // ── Cross-table rules button ───────────────────────────────────────────
    const crossBtn = page.locator('button', { hasText: /Cross-table rules/ }).first();
    if (await crossBtn.count()) {
      await crossBtn.click();
      await ss(page, '19a-cross-table-loading');
      await page.waitForTimeout(6000);
      await ss(page, '19b-cross-table-result');
      tail(8);
    }

    // ── Generate rules for selected table (regenerate) ─────────────────────
    const genBtn = page.locator('button', { hasText: /^(Generate|Regenerate) rules for/ }).first();
    if (await genBtn.count()) {
      await genBtn.click();
      await ss(page, '20a-generate-loading');
      await page.waitForTimeout(6000);
      await ss(page, '20b-generate-result');
      tail(10);
    }

    // ── Deselect table, then test "Generate all tables" ────────────────────
    await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      if (!container) return;
      const btn = Array.from(container.querySelectorAll('button')).find(b => b.innerText.trim() === 'All tables');
      if (btn) btn.click();
    });
    await page.waitForTimeout(400);
    const genAllBtn = page.locator('button', { hasText: 'Generate all tables' }).first();
    if (await genAllBtn.count()) {
      await genAllBtn.click();
      await ss(page, '21a-generate-all-loading');
      await page.waitForTimeout(2500);
      await ss(page, '21b-generate-all-progress');
      // don't wait for full completion (could be long) — just observe progress UX
    }
    await page.waitForTimeout(3000);
    await ss(page, '21c-generate-all-later');
    tail(10);

    // ── NL → DQ rule converter ──────────────────────────────────────────────
    await ss(page, '22-nl-converter-default');
    const nlInput = page.locator('input[placeholder*="revenue should never be negative"]');
    await nlInput.click({ clickCount: 3 });
    await nlInput.fill('customer_id must not be null');
    await ss(page, '23-nl-input-typed');
    const convertBtn = page.locator('button', { hasText: /Convert to rule|Converting/ }).first();
    await convertBtn.click();
    await ss(page, '24a-nl-converting-loading');
    await page.waitForTimeout(6000);
    await ss(page, '24b-nl-generated-result');
    tail(8);

    // Edit expression on generated rule
    const editExprBtn = page.locator('button', { hasText: 'Edit expression' }).first();
    if (await editExprBtn.count()) {
      await editExprBtn.click();
      await page.waitForTimeout(300);
      await ss(page, '25-nl-edit-expression-mode');
      await page.locator('button', { hasText: 'Cancel' }).last().click().catch(() => {});
      await page.waitForTimeout(300);
    }

    // Save as draft / Approve & add
    const saveBtn = page.locator('button', { hasText: /Save as draft|Approve & add|Approve with refinement/ }).first();
    if (await saveBtn.count()) {
      const label = await saveBtn.innerText();
      console.log('Save/approve button label:', label);
      await saveBtn.click();
      await page.waitForTimeout(1200);
      await ss(page, '26-nl-saved');
      tail(8);
    }

    // Try NL with empty connection scope / quick suggestion chip
    const chip = page.locator('button', { hasText: 'emails must be valid format' }).first();
    if (await chip.count()) {
      await chip.click();
      await ss(page, '27a-nl-chip-clicked-loading');
      await page.waitForTimeout(6000);
      await ss(page, '27b-nl-chip-result');
      const rejectGenBtn = page.locator('button', { hasText: 'Reject' }).last();
      if (await rejectGenBtn.count()) {
        await rejectGenBtn.click();
        await page.waitForTimeout(300);
        await ss(page, '28-nl-rejected-cleared');
      }
    }

    // Empty NL input submit (Enter key edge case)
    await nlInput.click({ clickCount: 3 });
    await nlInput.fill('');
    await nlInput.press('Enter');
    await page.waitForTimeout(500);
    await ss(page, '29-nl-empty-submit');

    // ── Bottom CTA ────────────────────────────────────────────────────────
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await ss(page, '30-bottom-cta-visible');

    console.log('\n=== ALL API CALLS ===');
    apiCalls.forEach(c => console.log(`${c.method} ${c.url} -> ${c.status}`));

    console.log('\n=== JS ERRORS ===');
    if (errors.length) errors.forEach(e => console.log('ERROR:', e));
    else console.log('None');

  } catch (e) {
    console.error('TEST FAILED:', e);
    await ss(page, '99-error-state');
  } finally {
    await browser.close();
  }
})();
