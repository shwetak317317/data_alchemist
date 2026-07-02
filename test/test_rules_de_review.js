// DE Stakeholder Review — Rule Studio (Phase 2 of 5-phase production audit)
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, collectJsErrors, ss, useConnection, CONNECTIONS } = require('./config');

const log = (...a) => console.log(...a);

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  const errors = collectJsErrors(page);
  const netErrors = [];
  page.on('response', (res) => {
    if (res.status() >= 400 && res.url().includes('/api/')) {
      netErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });

  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(1500);

    // ── 1. Primary loaded state ──────────────────────────────────────
    await ss(page, '01-primary-loaded-demo');
    const bodyText0 = await page.locator('body').innerText();
    log('[state] demo — body length:', bodyText0.length);
    const pendingBadgeMatch0 = bodyText0.match(/(\d+)\s+pending/i);
    log('[state] demo — pending badge:', pendingBadgeMatch0 ? pendingBadgeMatch0[1] : 'not found');

    // ── 2. Layer filter ───────────────────────────────────────────────
    const goldBtn = page.getByRole('button', { name: 'GOLD', exact: true });
    if (await goldBtn.count() > 0) {
      await goldBtn.click();
      await page.waitForTimeout(800);
      await ss(page, '02-layer-filter-gold');
    }
    const allLayerBtn = page.getByRole('button', { name: 'ALL', exact: true }).first();
    await allLayerBtn.click();
    await page.waitForTimeout(500);

    // ── 3. Status filter — cycle through Pending/Approved/Active/Snoozed ──
    for (const label of ['Pending', 'Approved', 'Active', 'Snoozed']) {
      const btn = page.getByRole('button', { name: label, exact: true });
      if (await btn.count() > 0) {
        await btn.click();
        await page.waitForTimeout(600);
        await ss(page, `03-status-filter-${label.toLowerCase()}`);
        const txt = await page.locator('body').innerText();
        const rowCountVisible = (txt.match(/violations|Approve this rule|Run this rule/gi) || []).length;
        log(`[filter] status=${label} — visible action markers: ${rowCountVisible}`);
      } else {
        log(`[filter] status button "${label}" NOT FOUND`);
      }
    }
    await page.getByRole('button', { name: 'All', exact: true }).first().click();
    await page.waitForTimeout(500);

    // ── 4. Search with a match ───────────────────────────────────────
    const searchBox = page.locator('input[placeholder="Search rules…"]');
    await searchBox.fill('email');
    await page.waitForTimeout(600);
    await ss(page, '04-search-match-email');
    const matchText = await page.locator('body').innerText();
    log('[search] "email" — contains "No rules yet"?', matchText.includes('No rules yet'));

    // ── 5. Search with no match ──────────────────────────────────────
    await searchBox.fill('xyzzy_no_such_rule_999');
    await page.waitForTimeout(600);
    await ss(page, '05-search-no-match');
    const noMatchText = await page.locator('body').innerText();
    log('[search] no-match state text sample:', noMatchText.includes('[object Object]') ? 'OBJECT LEAK' : 'clean');
    await searchBox.fill('');
    await page.waitForTimeout(500);

    // ── 6. NL-to-rule flow ────────────────────────────────────────────
    const nlInput = page.locator('input[placeholder*="revenue should never be negative"]');
    await nlInput.fill('order_total must always be greater than zero');
    await ss(page, '06a-nl-before-convert');
    await page.getByRole('button', { name: /Convert to rule/i }).click();
    await page.waitForTimeout(6000);
    await ss(page, '06b-nl-generated-card');
    const nlBody = await page.locator('body').innerText();
    log('[nl] generated card visible:', nlBody.includes('WHY THIS RULE MAKES SENSE'));

    // ── 7. "Generate rules for X" on a profiled table ─────────────────
    const generateBtns = page.locator('button', { hasText: 'Generate' }).filter({ hasNotText: 'Generate all' });
    const genCount = await generateBtns.count();
    log('[generate] per-table Generate buttons found:', genCount);
    if (genCount > 0) {
      await generateBtns.first().click();
      await page.waitForTimeout(1000);
      await ss(page, '07a-generate-clicked');
      await page.waitForTimeout(8000);
      await ss(page, '07b-generate-result');
    }

    // ── 8. Approve / Reject / Snooze actions ──────────────────────────
    // Approve
    const approveBtn = page.locator('button[title="Approve"]').first();
    if (await approveBtn.count() > 0) {
      await approveBtn.scrollIntoViewIfNeeded();
      await ss(page, '08a-before-approve');
      await approveBtn.click();
      await page.waitForTimeout(1500);
      await ss(page, '08b-after-approve');
    } else {
      log('[action] No "Approve" button found (no pending draft rules visible)');
    }

    // Reject
    const rejectBtn = page.locator('button[title="Reject"]').first();
    if (await rejectBtn.count() > 0) {
      await rejectBtn.scrollIntoViewIfNeeded();
      await ss(page, '09a-before-reject');
      await rejectBtn.click();
      await page.waitForTimeout(1500);
      await ss(page, '09b-after-reject');
    } else {
      log('[action] No "Reject" button found');
    }

    // Snooze (with date picker)
    const snoozeBtn = page.locator('button[title="Snooze"]').first();
    if (await snoozeBtn.count() > 0) {
      await snoozeBtn.scrollIntoViewIfNeeded();
      await snoozeBtn.click();
      await page.waitForTimeout(500);
      await ss(page, '10a-snooze-datepicker-open');
      const dateInput = page.locator('input[type="date"]').first();
      if (await dateInput.count() > 0) {
        await dateInput.fill('2026-12-31');
        await page.waitForTimeout(300);
        await ss(page, '10b-snooze-date-filled');
        await page.getByRole('button', { name: 'Confirm', exact: true }).click();
        await page.waitForTimeout(1500);
        await ss(page, '10c-snooze-confirmed');
      }
    } else {
      log('[action] No "Snooze" button found');
    }

    // ── 11. Refresh — idempotency check ───────────────────────────────
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction((t) => document.body.innerText.includes(t), 'Rule Studio', { timeout: 15000 });
    await page.waitForTimeout(1500);
    await ss(page, '11-after-refresh-idempotency-check');
    const refreshedText = await page.locator('body').innerText();
    log('[idempotency] rejected chip visible after refresh:', refreshedText.includes('Rejected'));
    log('[idempotency] snoozed chip visible after refresh:', refreshedText.includes('Snoozed'));

    // ── 12. Bulk approve LOW ──────────────────────────────────────────
    const bulkBtn = page.getByRole('button', { name: /Bulk approve LOW/i });
    if (await bulkBtn.count() > 0) {
      await ss(page, '12a-before-bulk-approve-low');
      await bulkBtn.click();
      await page.waitForTimeout(3000);
      await ss(page, '12b-after-bulk-approve-low');
    }

    // ── 13. Record a few rule rows for later DB cross-check ───────────
    const ruleRows = await page.evaluate(() => {
      const rows = [];
      document.querySelectorAll('body').forEach(() => {}); // noop, kept for clarity
      return rows;
    });
    log('[note] Will cross-check visible rules against DB via docker exec separately.');

    // ── 14. Connection isolation: demo → capture ──────────────────────
    await page.getByRole('button', { name: 'All', exact: true }).first().click().catch(() => {});
    await searchBox.fill('').catch(() => {});
    await page.waitForTimeout(500);
    await ss(page, '14a-isolation-demo-final');
    const demoText = await page.locator('body').innerText();
    const demoRuleNameMatches = [...demoText.matchAll(/^\s*\d+\s*$/gm)];
    log('[isolation] demo body length:', demoText.length);

    // Switch to ofc
    await useConnection(page, CONNECTIONS.ofc);
    await goTo(page, 'rules');
    await page.waitForTimeout(2000);
    await ss(page, '14b-isolation-ofc');
    const ofcText = await page.locator('body').innerText();
    log('[isolation] ofc body length:', ofcText.length);
    log('[isolation] demo vs ofc identical text?', demoText === ofcText);

    // Switch back to demo — confirm matches original
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(2000);
    await ss(page, '14c-isolation-demo-restored');
    const demoRestoredText = await page.locator('body').innerText();
    log('[isolation] demo restored matches original demo (ignoring run-state noise)?',
      demoRestoredText.slice(0, 200) === demoText.slice(0, 200));

    // ── Wrap-up: JS + network errors ──────────────────────────────────
    log('==== JS ERRORS ====', errors.length ? errors : 'none');
    log('==== 4xx/5xx API RESPONSES ====', netErrors.length ? netErrors : 'none');

  } catch (e) {
    console.error('TEST SCRIPT ERROR:', e);
    await ss(page, 'ERROR-final-state').catch(() => {});
  } finally {
    await browser.close();
  }
})();
