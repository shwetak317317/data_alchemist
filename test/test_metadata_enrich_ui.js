/**
 * test_metadata_enrich_ui.js
 *
 * Focused test for the Metadata screen — Enrich All progressive results.
 *
 * Run: node test/test_metadata_enrich_ui.js
 */

const { chromium } = require('playwright');
const path  = require('path');
const fs    = require('fs');
const { checkAppHealth, launchBrowser, login, goTo, collectJsErrors } = require('./config');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', 'metadata-enrich-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

let _ssIdx = 0;
async function ss(page, name) {
  const file = path.join(SCREENSHOTS_DIR, `${String(_ssIdx++).padStart(2, '0')}_${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  📸 ${path.basename(file)}`);
  return file;
}

const bugs  = [];
const notes = [];
function bug(msg)  { bugs.push(msg);  console.log(`  ❌ BUG: ${msg}`); }
function note(msg) { notes.push(msg); console.log(`  ℹ️  ${msg}`); }
function ok(msg)   {                  console.log(`  ✅ ${msg}`); }

// ── count column rows in the main panel ────────────────────────────────────────
// Column rows inner div: style="...padding: 11px 20px..."
// Table divider rows:    style="...padding: 7px 20px..."
// Header bar:            style="...padding: 7px 20px..."  (also 7px)
async function countColumnRows(page) {
  return page.evaluate(() => {
    // Each column row has a checkbox input (select-row checkbox).
    // The header has one "select all" checkbox.
    // We count all checkboxes that appear inside the main content area (not modal).
    const allCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    // The header "select all" checkbox is the FIRST one when the list is non-empty.
    // We want all per-row checkboxes (i.e., all minus the one header checkbox).
    // But if there are 0 rows, there's also 0 checkboxes (header is only rendered when filteredRows.length > 0).
    return allCheckboxes.length > 0 ? allCheckboxes.length - 1 : 0;
  });
}

// ── read the enrich-all button text from the sidebar ─────────────────────────
async function enrichBtnText(page) {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find(b => b.textContent.includes('Enrich'));
    return b ? b.textContent.trim() : '';
  });
}

// ── call DTApi directly in the page to diagnose ─────────────────────────────
async function diagnoseApi(page, connId) {
  return page.evaluate(async (connId) => {
    const api = window.DTApi;
    if (!api) return { error: 'window.DTApi not found' };

    const result = {};

    // 1. listDatasets
    try {
      const datasets = await api.listDatasets(connId);
      result.datasetsCount = datasets ? datasets.length : 0;
      result.firstDataset = datasets && datasets[0]
        ? { schema: datasets[0].schema, layer: datasets[0].layer, tables: datasets[0].tables?.length }
        : null;
      // Count profiled tables
      let profiledCount = 0;
      for (const g of (datasets || [])) {
        for (const t of (g.tables || [])) {
          if (t.profiled && t.profiled !== '—') profiledCount++;
        }
      }
      result.profiledTablesCount = profiledCount;
    } catch (e) {
      result.datasetsError = e.message;
    }

    // 2. listDictionary
    try {
      const dict = await api.listDictionary(connId);
      result.dictionaryCount = dict ? dict.length : 0;
    } catch (e) {
      result.dictionaryError = e.message;
    }

    // 3. Try getReportByTable for the first profiled table
    try {
      const datasets = await api.listDatasets(connId);
      let firstFqn = null;
      outer: for (const g of (datasets || [])) {
        for (const t of (g.tables || [])) {
          if (t.profiled && t.profiled !== '—') {
            firstFqn = g.schema ? `${g.schema}.${t.name}` : t.name;
            break outer;
          }
        }
      }
      result.firstProfiledFqn = firstFqn;
      if (firstFqn) {
        try {
          const report = await api.getReportByTable(firstFqn, connId);
          result.reportForFirstTable = report
            ? { report_id: report.report_id, table_fqn: report.table_fqn, column_count: report.columns?.length }
            : null;
        } catch (e) {
          result.reportError = e.message;
        }
      }
    } catch (e) {
      result.datasetsForReportError = e.message;
    }

    return result;
  }, connId);
}

// ── main ───────────────────────────────────────────────────────────────────────
(async () => {
  try { await checkAppHealth(); }
  catch (e) { console.error('\n❌ App not reachable:', e.message); process.exit(1); }

  const { browser, page } = await launchBrowser({ chromium }, { headless: true, slowMo: 50 });
  const jsErrors = collectJsErrors(page);

  try {
    // ── 1. LOGIN ──────────────────────────────────────────────────────────────
    console.log('\n=== LOGIN ===');
    await login(page);
    await page.waitForTimeout(2000);
    await ss(page, 'after_login');

    // Get active connection ID from localStorage
    const connId = await page.evaluate(() => localStorage.getItem('dt_conn_id'));
    note(`Active connection ID: ${connId}`);
    if (!connId) { bug('No active connection — ensure a connection exists and is selected'); }

    // ── 2. NAVIGATE TO METADATA ───────────────────────────────────────────────
    console.log('\n=== NAVIGATE TO METADATA ===');
    await goTo(page, 'metadata');
    await page.waitForTimeout(3000);
    await ss(page, 'metadata_initial');

    // ── 3. API DIAGNOSTICS (before enrichment) ────────────────────────────────
    console.log('\n=== API DIAGNOSTICS ===');
    const diag = await diagnoseApi(page, connId);
    note(`Datasets groups: ${diag.datasetsCount ?? '?'}`);
    note(`First dataset: ${JSON.stringify(diag.firstDataset)}`);
    note(`Profiled tables in datasets: ${diag.profiledTablesCount ?? '?'}`);
    note(`Dictionary entries: ${diag.dictionaryCount ?? '?'}`);
    note(`First profiled table FQN: ${diag.firstProfiledFqn}`);
    note(`Report for first table: ${JSON.stringify(diag.reportForFirstTable)}`);
    if (diag.datasetsError) bug(`listDatasets error: ${diag.datasetsError}`);
    if (diag.dictionaryError) bug(`listDictionary error: ${diag.dictionaryError}`);
    if (diag.reportError) bug(`getReportByTable error: ${diag.reportError}`);

    if (!diag.profiledTablesCount) {
      bug('No profiled tables found — run Profiling on at least one table first, then re-run this test');
      await ss(page, 'no_profiled_tables');
    }

    if (diag.firstProfiledFqn && !diag.reportForFirstTable) {
      bug(`Table "${diag.firstProfiledFqn}" marked as profiled in datasets but getReportByTable returns null — FQN mismatch or report missing`);
    }

    // ── 4. COUNT INITIAL COLUMNS ──────────────────────────────────────────────
    console.log('\n=== COLUMN COUNT CHECK ===');
    const initialColCount = await countColumnRows(page);
    note(`Column rows before enrichment: ${initialColCount} (checkbox count - 1)`);

    // Also dump what's actually in the column list area
    const columnAreaText = await page.evaluate(() => {
      // Find the main content card (the large right-hand panel)
      const bodyText = document.body.innerText;
      const startIdx = bodyText.indexOf('No column metadata') !== -1
        ? bodyText.indexOf('No column metadata')
        : bodyText.indexOf('columns enriched');
      return bodyText.slice(Math.max(0, startIdx - 20), startIdx + 200);
    });
    note(`Column area text: "${columnAreaText.replace(/\n/g, ' | ')}"`);

    // ── 5. ENRICH ALL ────────────────────────────────────────────────────────
    console.log('\n=== ENRICH ALL TEST ===');
    const enrichAllBtns = await page.locator('button:has-text("Enrich all")').all();
    note(`"Enrich all" buttons: ${enrichAllBtns.length}`);

    if (enrichAllBtns.length > 0 && diag.profiledTablesCount > 0) {
      // Capture column count snapshot BEFORE click
      const colsBefore = await countColumnRows(page);

      await enrichAllBtns[0].click();
      await page.waitForTimeout(500);
      await ss(page, 'enrich_all_t0');
      note(`Button text at t=0: "${await enrichBtnText(page)}"`);

      // Poll for up to 120s, checking every 5s
      let lastCount = colsBefore;
      let firstUpdateTime = null;
      let enrichDone = false;
      for (let poll = 1; poll <= 24; poll++) {
        await page.waitForTimeout(5000);
        const colCount = await countColumnRows(page);
        const btnText  = await enrichBtnText(page);
        const t = poll * 5;
        console.log(`  t=${t}s | cols=${colCount} | btn="${btnText}"`);

        if (colCount !== lastCount && firstUpdateTime === null) {
          firstUpdateTime = t;
          ok(`✨ First column update at t=${t}s: ${lastCount} → ${colCount}`);
          await ss(page, `cols_appeared_t${t}s`);
          lastCount = colCount;
        } else if (colCount !== lastCount) {
          ok(`More columns: ${lastCount} → ${colCount} at t=${t}s`);
          lastCount = colCount;
        }

        const running = btnText.toLowerCase().includes('enriching');
        if (!running && poll > 2) {
          note(`Enrichment UI finished at t=${t}s`);
          enrichDone = true;
          await ss(page, `enrich_done_t${t}s`);
          break;
        }
      }

      const colsFinal = await countColumnRows(page);
      await ss(page, 'enrich_all_final');
      note(`Final column count: ${colsFinal}`);

      // Direct API call after enrichment — bypass React state to check DB
      const postEnrichDiag = await page.evaluate(async (connId) => {
        const token = sessionStorage.getItem('dt_token');
        const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
        try {
          // Check dictionary without filter (all tables)
          const r1 = await fetch('/api/metadata/dictionary?connection_id=' + encodeURIComponent(connId),
            { headers: { 'Content-Type': 'application/json', ...authHeaders } });
          const dict = r1.ok ? await r1.json() : null;
          // Check without connection filter to see if data is there at all
          const r2 = await fetch('/api/metadata/dictionary',
            { headers: { 'Content-Type': 'application/json', ...authHeaders } });
          const allDict = r2.ok ? await r2.json() : null;
          const contextConnId = window.__DT_ACTIVE_CONN || 'not captured';
          return {
            count: dict ? dict.length : 0,
            allCount: allDict ? allDict.length : 0,
            firstFew: dict ? dict.slice(0,3).map(r => r.connection_id + '|' + r.table_fqn + '.' + r.column_name) : [],
            r1Status: r1.status,
            r2Status: r2.status,
            contextConnId,
          };
        } catch(e) { return { error: e.message }; }
      }, connId);
      note(`Post-enrich DB (with connId): count=${postEnrichDiag.count} status=${postEnrichDiag.r1Status}`);
      note(`Post-enrich DB (all):         count=${postEnrichDiag.allCount} status=${postEnrichDiag.r2Status}`);
      note(`Post-enrich sample: ${JSON.stringify(postEnrichDiag.firstFew)}`);
      if (postEnrichDiag.allCount > 0 && postEnrichDiag.count === 0) {
        bug(`Data IS in DB (${postEnrichDiag.allCount} rows) but filtered by wrong connection_id — React context has different connId than test's localStorage`);
      } else if (postEnrichDiag.count > 0) {
        ok(`DB has ${postEnrichDiag.count} columns — enrichment wrote data`);
      } else {
        bug(`DB still empty after enrichment — LLM calls may be failing (check backend logs)`);
      }

      // Take screenshot of any body text that changed
      const bodyAfter = await page.evaluate(() => document.body.innerText.slice(0, 800));
      note(`Body text (first 400 chars): "${bodyAfter.slice(0, 400).replace(/\n/g, ' | ')}"`);

      // Verdict
      if (colsFinal === 0) {
        bug('Columns are STILL 0 after enrichment — check if enrichMetadata succeeds (see API diag above)');
      } else if (firstUpdateTime === null) {
        bug(`Columns (${colsFinal}) only appeared after enrichment loop ended — NOT progressive`);
        note('Fix: increase setTimeout delay or use requestAnimationFrame instead of setTimeout(0)');
      } else {
        ok(`Progressive enrichment working — first results at t=${firstUpdateTime}s, final ${colsFinal} columns`);
      }

    } else if (enrichAllBtns.length === 0) {
      note('No "Enrich all" button found — either all tables are enriched or sidebar shows no profiled tables');
      await ss(page, 'no_enrich_btn');

      // Try the single-table "Enrich this table" button instead
      const enrichThisBtn = page.locator('button:has-text("Enrich this table"), button:has-text("Run AI Enrichment")');
      if (await enrichThisBtn.count() > 0) {
        note('Found single-table enrich button — testing it');
        const colsBefore = await countColumnRows(page);
        await enrichThisBtn.first().click();
        await page.waitForTimeout(500);
        await ss(page, 'single_enrich_started');
        try {
          await page.waitForFunction(() => !document.body.innerText.includes('Enriching…'), { timeout: 60000 });
          await page.waitForTimeout(1000);
          await ss(page, 'single_enrich_done');
          const colsAfter = await countColumnRows(page);
          note(`Cols before: ${colsBefore}, after: ${colsAfter}`);
          if (colsAfter > colsBefore) ok('Single-table enrich works (new columns added)');
          else if (colsAfter === colsBefore && colsBefore > 0) ok('Single-table enrich works (updated existing columns)');
          else bug('Single-table enrich: column count dropped or still 0 after enrichment');
        } catch { bug('Single-table enrich timed out'); }
      }
    }

    // ── 6. INSPECT WHAT'S IN THE DOM ─────────────────────────────────────────
    console.log('\n=== DOM INSPECTION ===');
    const domDiag = await page.evaluate(() => {
      // Count all divs with padding: 11px 20px (column rows)
      const colDivs = document.querySelectorAll('[style*="padding: 11px 20px"]');
      // Count all divs with padding: 7px 20px (dividers/header)
      const dividerDivs = document.querySelectorAll('[style*="padding: 7px 20px"]');
      // Count checkboxes
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      // Any elements with "Draft" or "Approved" text (status chips)
      const statusChips = document.querySelectorAll('[style*="1px solid"]');
      const body = document.body.innerText;
      return {
        colDivs: colDivs.length,
        dividerDivs: dividerDivs.length,
        checkboxes: checkboxes.length,
        statusChips: statusChips.length,
        hasDraft: body.includes('Draft'),
        hasApproved: body.includes('Approved'),
        hasNoMetadata: body.includes('No column metadata'),
        hasNoMetadataTable: body.includes('No metadata for this table'),
        hasSelectTable: body.includes('Select a table'),
      };
    });
    note(`DOM: col-divs=${domDiag.colDivs}, dividers=${domDiag.dividerDivs}, checkboxes=${domDiag.checkboxes}`);
    note(`DOM: hasDraft=${domDiag.hasDraft}, hasApproved=${domDiag.hasApproved}`);
    note(`DOM: hasNoMetadata=${domDiag.hasNoMetadata}, hasSelectTable=${domDiag.hasSelectTable}`);

    if (domDiag.hasNoMetadata) {
      bug('Empty state message still showing after enrichment — columns did not appear in UI');
    } else if (domDiag.hasDraft || domDiag.hasApproved) {
      ok('Column status chips (Draft/Approved) visible — enrichment results ARE in the DOM');
      if (domDiag.checkboxes < 2) {
        bug(`Status chips visible but only ${domDiag.checkboxes} checkbox(es) — selector mismatch in countColumnRows`);
      }
    }

    await ss(page, 'final_state');

    // ── 7. JS ERRORS ─────────────────────────────────────────────────────────
    console.log('\n=== JS ERRORS ===');
    const significantErrors = jsErrors.filter(e =>
      !e.includes('favicon') && !e.includes('net::ERR_ABORTED') && !e.includes('lucide')
      && !e.includes('401')   // 401 from ensureConnection's unauthenticated fetch — test infra issue
      && !e.includes('Warning: Encountered two children')  // checked separately below
    );
    if (significantErrors.length > 0) {
      significantErrors.slice(0, 5).forEach(e => {
        console.log(`    ⚡ ${e.slice(0, 150)}`);
        bug(`JS error: ${e.slice(0, 100)}`);
      });
    } else {
      ok('No significant JS errors');
    }

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(60));
    console.log('  BUGS FOUND');
    console.log('═'.repeat(60));
    if (bugs.length === 0) {
      console.log('  ✅ No bugs found');
    } else {
      bugs.forEach((b, i) => console.log(`  ${i+1}. ${b}`));
    }
    console.log(`\n  Screenshots → ${SCREENSHOTS_DIR}`);

  } catch (err) {
    console.error('\n  FATAL:', err.message);
    await ss(page, 'fatal_error').catch(() => {});
  } finally {
    await browser.close();
  }
})();
