/**
 * test_metadata_promote_icon_verify.js
 *
 * Independent verification of the contested claim:
 * "CDE-promote (^) icon still renders on columns where API confirms is_cde: true
 *  (e.g. BronzeDB.BrzLoadLog / RunFinishedAt, RunStartedAt, Status)"
 *
 * Cross-checks rendered DOM state against a direct GET /api/metadata/dictionary call.
 *
 * Run: node test/test_metadata_promote_icon_verify.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { checkAppHealth, launchBrowser, login, goTo, useConnection, CONNECTIONS } = require('./config');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', 'metadata-promote-icon-verify-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
let _i = 0;
async function ss(page, name) {
  const file = path.join(SCREENSHOTS_DIR, `${String(_i++).padStart(2, '0')}_${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  [SS] ${path.basename(file)}`);
}

(async () => {
  try { await checkAppHealth(); } catch (e) { console.error(e.message); process.exit(1); }
  const { browser, page } = await launchBrowser({ chromium }, { headless: true, slowMo: 20 });

  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'metadata');
    await page.waitForTimeout(2000);

    // ── Direct API ground truth for BronzeDB.BrzLoadLog ─────────────────────
    const apiRows = await page.evaluate(async (connId) => {
      const token = sessionStorage.getItem('dt_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const r = await fetch(`/api/metadata/dictionary?connection_id=${encodeURIComponent(connId)}&table_fqn=${encodeURIComponent('BronzeDB.BrzLoadLog')}`, { headers });
      return r.ok ? await r.json() : { error: r.status };
    }, CONNECTIONS.demo.id);
    console.log('\n=== API ground truth: BronzeDB.BrzLoadLog ===');
    console.log(JSON.stringify(apiRows, null, 2));

    const targetCols = ['RunFinishedAt', 'RunStartedAt', 'Status'];
    const apiByCol = {};
    (Array.isArray(apiRows) ? apiRows : []).forEach(r => { apiByCol[r.column_name] = r; });
    targetCols.forEach(c => {
      const r = apiByCol[c];
      console.log(`  ${c}: is_cde=${r ? r.is_cde : 'MISSING'} cde_score=${r ? r.cde_score : 'MISSING'} status=${r ? r.status : 'MISSING'}`);
    });

    // ── Navigate UI to that exact table ──────────────────────────────────────
    // Find and click the table row named "BrzLoadLog" in the sidebar
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('div[style*="width: 248"] button'));
      const target = btns.find(b => b.innerText.includes('BrzLoadLog'));
      if (target) { target.click(); return true; }
      return false;
    });
    console.log(`\n[nav] Clicked BrzLoadLog sidebar row: ${clicked}`);
    await page.waitForTimeout(1500);
    await ss(page, 'brzloadlog_selected');

    if (!clicked) {
      console.log('!! Could not find BrzLoadLog in sidebar — searching all sidebar table names for diagnostics');
      const allNames = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('div[style*="width: 248"] button'));
        return btns.map(b => b.innerText.trim()).filter(Boolean);
      });
      console.log(JSON.stringify(allNames, null, 2));
    }

    // ── For each target column, inspect DOM row: is CDE chip shown? is promote icon shown? ──
    console.log('\n=== DOM inspection per column ===');
    for (const colName of targetCols) {
      const domState = await page.evaluate((colName) => {
        // Find the row containing this column name (Mono span with fontWeight 700)
        const monos = Array.from(document.querySelectorAll('span')).filter(s => s.textContent.trim() === colName);
        if (monos.length === 0) return { found: false };
        // Walk up to the row container (the flex row with padding 11px 20px)
        let el = monos[0];
        while (el && !(el.getAttribute('style') || '').includes('padding: 11px 20px')) {
          el = el.parentElement;
        }
        if (!el) return { found: true, rowFound: false };
        const rowText = el.innerText;
        const hasCdeChip = /CDE\s*.\s*\d+/.test(rowText);
        const promoteBtn = el.querySelector('button[title="Promote to CDE"]');
        const rejectBtn = el.querySelector('button[title="Reject"]');
        const approveBtn = el.querySelector('button[title="Approve"]');
        const demoteAnywhereNearby = null;
        return {
          found: true, rowFound: true, rowText: rowText.replace(/\n/g, ' | '),
          hasCdeChip,
          promoteIconPresent: !!promoteBtn,
          rejectIconPresent: !!rejectBtn,
          approveIconPresent: !!approveBtn,
        };
      }, colName);
      console.log(`  ${colName}: ${JSON.stringify(domState)}`);
    }

    await ss(page, 'brzloadlog_full_state');

    // Expand each target row to double check via detail panel CDE score
    for (const colName of targetCols) {
      const expanded = await page.evaluate((colName) => {
        const monos = Array.from(document.querySelectorAll('span')).filter(s => s.textContent.trim() === colName);
        if (monos.length === 0) return false;
        let el = monos[0];
        while (el && !(el.getAttribute('style') || '').includes('padding: 11px 20px')) el = el.parentElement;
        if (!el) return false;
        const chevronBtn = el.querySelector('button');
        if (chevronBtn) { chevronBtn.click(); return true; }
        return false;
      }, colName);
      await page.waitForTimeout(400);
    }
    await ss(page, 'brzloadlog_rows_expanded');

    console.log('\nDone. Screenshots ->', SCREENSHOTS_DIR);
  } catch (err) {
    console.error('FATAL:', err.message, err.stack);
    await ss(page, 'fatal_error').catch(() => {});
  } finally {
    await browser.close();
  }
})();
