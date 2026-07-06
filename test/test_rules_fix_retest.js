// Retest after fixing: (1) false-positive 'dbo'/self-ref unverified-column warnings,
// (2) filter-pill row wrapping (Layer/Status/Type now each on their own row),
// (3) Run-button tooltip no longer duplicates "Approve".
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, ss, collectJsErrors, useConnection, CONNECTIONS } = require('./config');

const apiCalls = [];
function trackApi(page) {
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/')) {
      apiCalls.push({ method: res.request().method(), url: url.replace('http://localhost', ''), status: res.status(), t: Date.now() });
    }
  });
}

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  const errors = collectJsErrors(page);
  trackApi(page);

  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(1200);

    // ── 1. Check filter row layout — Layer/Status/Type each own row ──────
    const filterLayout = await page.evaluate(() => {
      const eyebrows = Array.from(document.querySelectorAll('*')).filter(el =>
        el.children.length === 0 && ['Layer', 'Status', 'Type'].includes(el.textContent.trim())
      );
      return eyebrows.map(e => {
        const row = e.parentElement;
        const rect = row.getBoundingClientRect();
        return { label: e.textContent.trim(), rowTop: Math.round(rect.top), rowHeight: Math.round(rect.height) };
      });
    });
    console.log('Filter row layout:', JSON.stringify(filterLayout));
    await ss(page, '01-header-filters-layout');

    // Check for orphaned single-pill rows (a "Rejected"-only row disconnected from its label)
    const orphanCheck = await page.evaluate(() => {
      const rejectedBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Rejected');
      const statusLabel = Array.from(document.querySelectorAll('*')).find(el => el.children.length === 0 && el.textContent.trim() === 'Status');
      if (!rejectedBtn || !statusLabel) return null;
      const rBox = rejectedBtn.getBoundingClientRect();
      const sBox = statusLabel.getBoundingClientRect();
      return { sameRow: Math.abs(rBox.top - sBox.top) < 10, rejectedTop: rBox.top, statusTop: sBox.top };
    });
    console.log('Rejected pill same row as Status label?', JSON.stringify(orphanCheck));

    // ── 2. Find a table with an existing false-positive 'dbo' warning ────
    const beforeState = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('div')).filter(el =>
        el.innerText && el.innerText.includes("Unverified column reference(s) ('dbo'") && el.innerText.length < 500
      );
      return { dboWarningCount: rows.length, sample: rows[0] ? rows[0].innerText.trim() : null };
    });
    console.log('BEFORE regen — live "dbo" false-positive warnings on page:', beforeState.dboWarningCount);
    console.log('Sample:', beforeState.sample);

    // ── 3. Select SilverDB.dim_category and regenerate ────────────────────
    const clicked = await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      if (!container) return 'NO_SIDEBAR';
      const btns = Array.from(container.querySelectorAll('button'));
      const target = btns.find(b => b.innerText.trim().split('\n')[0] === 'dim_category');
      if (target) { target.click(); return 'dim_category clicked'; }
      return 'NOT_FOUND';
    });
    console.log('Sidebar click result:', clicked);
    await page.waitForTimeout(600);
    await ss(page, '02-dim_category-selected');

    const regenBtn = page.locator('button', { hasText: /^(Generate|Regenerate) rules for/ }).first();
    if (await regenBtn.count()) {
      const label = await regenBtn.innerText();
      console.log('Clicking:', label);
      await regenBtn.click();
      await page.waitForTimeout(7000);
      await ss(page, '03-after-regenerate');
    } else {
      console.log('Regenerate button not found for dim_category');
    }

    // ── 4. Check post-regeneration rules for the false-positive pattern ──
    const afterState = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('div')).filter(el =>
        el.innerText && el.innerText.includes("Unverified column reference(s) ('dbo'") && el.innerText.length < 500
      );
      const allExprs = Array.from(document.querySelectorAll('div')).filter(el =>
        el.children.length === 0 && /CategoryKey|dim_category/i.test(el.textContent) && el.textContent.length < 400
      ).map(el => el.textContent.trim());
      return { dboWarningCount: rows.length, sampleWarning: rows[0] ? rows[0].innerText.trim() : null, exprSample: allExprs.slice(0, 5) };
    });
    console.log('AFTER regen — "dbo" false-positive warnings for dim_category view:', afterState.dboWarningCount);
    console.log('Sample warning (should be null/different now):', afterState.sampleWarning);
    console.log('Expression samples:', JSON.stringify(afterState.exprSample, null, 2));

    // ── 5. Sanity: sidebar selection persists (re-click same table shouldn't vanish) ──
    await ss(page, '04-final-state');

    console.log('\n=== JS ERRORS ===');
    console.log(errors.length ? errors.join('\n') : 'None');

    console.log('\n=== Relevant API calls ===');
    apiCalls.filter(c => c.url.includes('/rules')).forEach(c => console.log(`${c.method} ${c.url} -> ${c.status}`));

  } catch (e) {
    console.error('RETEST FAILED:', e);
    await ss(page, '99-error-state');
  } finally {
    await browser.close();
  }
})();
