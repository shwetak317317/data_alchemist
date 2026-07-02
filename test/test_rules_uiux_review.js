// Phase 4 UI/UX audit walkthrough for Rule Studio (app/screens_rules.jsx)
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, ss, collectJsErrors, useConnection, CONNECTIONS, TIMEOUTS } = require('./config');

const apiCalls = [];

function trackApi(page) {
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/')) {
      let bodySnippet = '';
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('application/json')) {
          const txt = await res.text();
          bodySnippet = txt.slice(0, 300);
        }
      } catch (_) {}
      apiCalls.push({
        method: res.request().method(),
        url: url.replace('http://localhost', ''),
        status: res.status(),
        body: bodySnippet,
        ts: Date.now(),
      });
    }
  });
}

function logApiTail(n = 10) {
  const tail = apiCalls.slice(-n);
  tail.forEach(c => console.log(`    [API] ${c.method} ${c.url} -> ${c.status}`));
}

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  const errors = collectJsErrors(page);
  trackApi(page);

  try {
    await login(page);
    console.log('=== Logged in ===');

    // Pin to demo connection first (has seeded profiling/lineage fixtures)
    await useConnection(page, CONNECTIONS.demo);
    console.log('=== Pinned to demo connection ===');

    await goTo(page, 'rules');
    await page.waitForTimeout(1200);
    await ss(page, '01-initial-load');
    console.log('--- Step 1: initial load ---');
    logApiTail(20);

    // Sidebar table selection
    const sidebarTableBtn = page.locator('div[style*="width: 248"] button').filter({ hasText: /^(?!All tables).+/ }).first();
    const tableButtons = await page.locator('div[style*="248"] >> button').all();
    console.log(`Found ~${tableButtons.length} sidebar buttons`);

    // Try clicking first real table row (not "All tables", not layer header)
    // Layer headers are buttons with uppercase text; table rows have normal case + optional Generate btn
    let clickedTable = null;
    const allSidebarBtns = await page.$$('div');
    // Simpler: use text-based selector via evaluate to find a table name button under a layer group
    const tableInfo = await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      if (!container) return null;
      const btns = Array.from(container.querySelectorAll('button'));
      // skip "All tables" (index 0) and layer header buttons (contain a small count + all-caps layer text)
      for (const b of btns) {
        const txt = b.innerText.trim();
        if (!txt || txt === 'All tables') continue;
        if (/^[A-Z_]+$/.test(txt.split('\n')[0])) continue; // layer header e.g. "RAW\n3"
        return txt;
      }
      return null;
    });
    console.log('Candidate table button text:', tableInfo);

    if (tableInfo) {
      await page.evaluate((label) => {
        const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
        const btns = Array.from(container.querySelectorAll('button'));
        const target = btns.find(b => b.innerText.trim().startsWith(label.split('\n')[0]) && b.innerText.trim() !== 'All tables');
        if (target) target.click();
      }, tableInfo);
      await page.waitForTimeout(800);
      await ss(page, '02-sidebar-table-selected');
      console.log('--- Step 2: sidebar table selected:', tableInfo, '---');
      logApiTail(10);
    } else {
      await ss(page, '02-sidebar-no-tables-found');
      console.log('--- Step 2: NO sidebar tables found (only layer headers / All tables) ---');
    }

    // Layer filter
    await page.locator('button', { hasText: 'RAW' }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    await ss(page, '03-filter-layer-raw');
    console.log('--- Step 3: layer filter RAW ---');

    await page.locator('button', { hasText: 'ALL' }).first().click().catch(() => {});
    await page.waitForTimeout(300);

    // Status filter
    const statusPending = page.locator('button', { hasText: 'Pending' }).first();
    if (await statusPending.count()) {
      await statusPending.click();
      await page.waitForTimeout(400);
      await ss(page, '04-filter-status-pending');
      console.log('--- Step 4: status filter Pending ---');
    }
    // Reset status filter to ALL (first "All" pill in status group is 2nd "ALL"-ish; use text 'All' exact within status row)
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const statusAll = btns.find(b => b.innerText.trim() === 'All');
      if (statusAll) statusAll.click();
    });
    await page.waitForTimeout(300);

    // Type filter
    const typeNull = page.locator('button', { hasText: 'Null' }).first();
    if (await typeNull.count()) {
      await typeNull.click();
      await page.waitForTimeout(400);
      await ss(page, '05-filter-type-null');
      console.log('--- Step 5: type filter Null ---');
    }
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const typeAllBtns = btns.filter(b => b.innerText.trim() === 'All');
      if (typeAllBtns[1]) typeAllBtns[1].click();
    });
    await page.waitForTimeout(300);

    // Search — match
    const searchBox = page.locator('input[placeholder="Search rules…"]');
    await searchBox.fill('null');
    await page.waitForTimeout(500);
    await ss(page, '06-search-match');
    console.log('--- Step 6: search match "null" ---');

    // Search — no match
    await searchBox.fill('zzzznonexistentrulexyz');
    await page.waitForTimeout(500);
    await ss(page, '07-search-no-match');
    console.log('--- Step 7: search no-match ---');
    await searchBox.fill('');
    await page.waitForTimeout(400);

    // Generate rules for X — capture loading state immediately
    if (tableInfo) {
      // Re-select table if deselected
      await page.evaluate((label) => {
        const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
        const btns = Array.from(container.querySelectorAll('button'));
        const target = btns.find(b => b.innerText.trim().startsWith(label.split('\n')[0]) && b.innerText.trim() !== 'All tables');
        if (target) target.click();
      }, tableInfo);
      await page.waitForTimeout(500);

      const genBtn = page.locator('button', { hasText: /^Generate rules for/ }).first();
      if (await genBtn.count()) {
        const genClickPromise = genBtn.click();
        // Screenshot immediately, before resolving
        await page.waitForTimeout(50);
        await ss(page, '08-generate-loading-state');
        console.log('--- Step 8: generate rules loading state (immediate) ---');
        await genClickPromise;
        await page.waitForTimeout(2500);
        await ss(page, '09-generate-result');
        console.log('--- Step 9: generate rules result ---');
        logApiTail(10);
      } else {
        await ss(page, '08-no-generate-button');
        console.log('--- Step 8: No "Generate rules for X" button visible (table may not be profiled) ---');
      }
    }

    // Generate all tables — progress UI
    const genAllBtn = page.locator('button', { hasText: /Generate all tables/ }).first();
    if (await genAllBtn.count()) {
      const genAllPromise = genAllBtn.click();
      await page.waitForTimeout(80);
      await ss(page, '10-generate-all-loading');
      console.log('--- Step 10: generate all loading/progress state (immediate) ---');
      await genAllPromise;
      await page.waitForTimeout(6000);
      await ss(page, '11-generate-all-result');
      console.log('--- Step 11: generate all result ---');
      logApiTail(20);
    }

    // Deselect table -> All tables view
    await page.locator('button', { hasText: 'All tables' }).first().click();
    await page.waitForTimeout(800);
    await ss(page, '12-all-tables-view');
    console.log('--- Step 12: All tables view (rule list) ---');

    // NL to rule box — type text and convert
    const nlInput = page.locator('input[placeholder*="revenue should never be negative"]').first();
    await nlInput.fill('order total must not be null');
    await ss(page, '13-nl-input-typed');
    console.log('--- Step 13: NL input typed ---');

    const convertBtn = page.locator('button', { hasText: /Convert to rule/ }).first();
    const convertPromise = convertBtn.click();
    await page.waitForTimeout(80);
    await ss(page, '14-nl-convert-loading');
    console.log('--- Step 14: NL convert loading state (immediate) ---');
    await convertPromise;
    await page.waitForTimeout(3000);
    await ss(page, '15-nl-convert-result');
    console.log('--- Step 15: NL convert result ---');
    logApiTail(5);

    // Suggestion chips
    const chip = page.locator('button', { hasText: 'emails must be valid format' }).first();
    if (await chip.count()) {
      await chip.click();
      await page.waitForTimeout(3000);
      await ss(page, '16-suggestion-chip-result');
      console.log('--- Step 16: suggestion chip clicked & result ---');
      logApiTail(5);
    }

    // Generated-rule card: edit expression
    const editExprBtn = page.locator('button', { hasText: 'Edit expression' }).first();
    if (await editExprBtn.count()) {
      await editExprBtn.click();
      await page.waitForTimeout(400);
      await ss(page, '17-generated-edit-expression');
      console.log('--- Step 17: generated rule edit expression mode ---');

      const cancelBtn = page.locator('button', { hasText: 'Cancel' }).last();
      await cancelBtn.click().catch(() => {});
      await page.waitForTimeout(300);
    }

    // Generated-rule card: approve
    const approveAddBtn = page.locator('button', { hasText: /Approve( with refinement)?( & add)?/ }).first();
    if (await approveAddBtn.count()) {
      await approveAddBtn.click();
      await page.waitForTimeout(1500);
      await ss(page, '18-generated-approved');
      console.log('--- Step 18: generated rule approved ---');
      logApiTail(10);
    }

    // Generate one more NL rule to test Reject path
    await nlInput.fill('customer id must be unique across all records');
    await convertBtn.click();
    await page.waitForTimeout(2500);
    await ss(page, '19-nl-second-generated', ).catch(() => {});
    const rejectBtn = page.locator('button', { hasText: 'Reject' }).first();
    if (await rejectBtn.count()) {
      await rejectBtn.click();
      await page.waitForTimeout(500);
      await ss(page, '20-generated-rejected');
      console.log('--- Step 20: generated rule (NL card) rejected/dismissed ---');
    }

    // Per-row actions: approve / edit / snooze / reject on real rule rows
    await page.waitForTimeout(500);
    await ss(page, '21-rule-list-before-row-actions');

    // find a pending (draft) rule row's action buttons via title attr
    const approveIcon = page.locator('button[title="Approve"]').first();
    const editIcon = page.locator('button[title="Edit"]').first();
    const snoozeIcon = page.locator('button[title="Snooze"]').first();
    const rejectIcon = page.locator('button[title="Reject"]').first();

    if (await editIcon.count()) {
      await editIcon.click();
      await page.waitForTimeout(400);
      await ss(page, '22-row-edit-expression');
      console.log('--- Step 22: row-level edit expression mode ---');
      const cancelRowBtn = page.locator('button', { hasText: 'Cancel' }).last();
      await cancelRowBtn.click().catch(() => {});
      await page.waitForTimeout(300);
    }

    if (await snoozeIcon.count()) {
      await snoozeIcon.click();
      await page.waitForTimeout(400);
      await ss(page, '23-row-snooze-datepicker');
      console.log('--- Step 23: row-level snooze datepicker opened ---');

      const dateInput = page.locator('input[type="date"]').first();
      if (await dateInput.count()) {
        const future = new Date();
        future.setDate(future.getDate() + 14);
        const iso = future.toISOString().slice(0, 10);
        await dateInput.fill(iso);
        await page.waitForTimeout(200);
        await ss(page, '24-row-snooze-date-filled');
        const confirmBtn = page.locator('button', { hasText: 'Confirm' }).first();
        await confirmBtn.click();
        await page.waitForTimeout(800);
        await ss(page, '25-row-snoozed-confirmed');
        console.log('--- Step 25: row snoozed & confirmed ---');
        logApiTail(5);
      }
    }

    // Approve a rule (for later Run test)
    if (await approveIcon.count()) {
      await approveIcon.click();
      await page.waitForTimeout(1000);
      await ss(page, '26-row-approved');
      console.log('--- Step 26: row approved ---');
      logApiTail(5);
    }

    // Reject another rule
    const rejectIcon2 = page.locator('button[title="Reject"]').first();
    if (await rejectIcon2.count()) {
      await rejectIcon2.click();
      await page.waitForTimeout(1000);
      await ss(page, '27-row-rejected');
      console.log('--- Step 27: row rejected ---');
      logApiTail(5);
    }

    // Run button — single rule (find an approved/active row's play button, should now be enabled)
    const playBtn = page.locator('button[title="Run this rule"]').first();
    if (await playBtn.count()) {
      const runPromise = playBtn.click();
      await page.waitForTimeout(50);
      await ss(page, '28-run-single-loading');
      console.log('--- Step 28: run single rule loading state (immediate) ---');
      await runPromise;
      await page.waitForTimeout(2500);
      await ss(page, '29-run-single-result');
      console.log('--- Step 29: run single rule result ---');
      logApiTail(5);
    } else {
      await ss(page, '28-no-runnable-rule-found');
      console.log('--- Step 28: no enabled "Run this rule" button found ---');
    }

    // Run X (layer-level) button
    const runLayerBtn = page.locator('button', { hasText: /^Run (all|RAW|BRONZE|SILVER|GOLD)$/ }).first();
    if (await runLayerBtn.count()) {
      await runLayerBtn.click();
      await page.waitForTimeout(300);
      await ss(page, '30-run-layer-loading');
      console.log('--- Step 30: run-layer loading/toast state ---');
      await page.waitForTimeout(3000);
      await ss(page, '31-run-layer-result');
      console.log('--- Step 31: run-layer result ---');
      logApiTail(10);
    }

    // Bulk approve LOW
    const bulkApproveBtn = page.locator('button', { hasText: 'Bulk approve LOW' }).first();
    if (await bulkApproveBtn.count()) {
      await bulkApproveBtn.click();
      await page.waitForTimeout(2000);
      await ss(page, '32-bulk-approve-low-result');
      console.log('--- Step 32: bulk approve LOW result ---');
      logApiTail(10);
    }

    // Connection switch demo -> ofc
    await useConnection(page, CONNECTIONS.ofc);
    await goTo(page, 'rules');
    await page.waitForTimeout(1200);
    await ss(page, '33-connection-switched-ofc');
    console.log('--- Step 33: connection switched to ofc ---');
    logApiTail(10);

    // Switch back to demo for consistency
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(800);
    await ss(page, '34-connection-switched-back-demo');
    console.log('--- Step 34: connection switched back to demo ---');

    console.log('\n=== ALL API CALLS ===');
    apiCalls.forEach(c => console.log(`${c.method} ${c.url} -> ${c.status}  ${c.body ? '| ' + c.body.slice(0,150) : ''}`));

    console.log('\n=== JS ERRORS ===');
    if (errors.length === 0) console.log('None');
    else errors.forEach(e => console.log(e));

  } catch (e) {
    console.error('TEST SCRIPT ERROR:', e);
    await ss(page, '99-error-state').catch(() => {});
  } finally {
    await browser.close();
  }
})();
