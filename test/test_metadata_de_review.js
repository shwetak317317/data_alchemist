/**
 * test_metadata_de_review.js
 *
 * Senior Data Engineer stakeholder review of the Dictionary & CDEs (metadata) module.
 * Screenshots every state + edge case; collects raw evidence for manual review.
 *
 * Run: node test/test_metadata_de_review.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const {
  checkAppHealth, launchBrowser, login, goTo, collectJsErrors,
  useConnection, CONNECTIONS, ss: _configSs,
} = require('./config');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', 'metadata-de-review-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

let _ssIdx = 0;
async function ss(page, name) {
  const file = path.join(SCREENSHOTS_DIR, `${String(_ssIdx++).padStart(2, '0')}_${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  [SS] ${path.basename(file)}`);
  return file;
}

const notes = [];
function note(msg) { notes.push(msg); console.log(`  i  ${msg}`); }
function ok(msg) { console.log(`  OK ${msg}`); }
function flag(msg) { notes.push('FLAG: ' + msg); console.log(`  ** FLAG: ${msg}`); }

async function getBodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

async function scanForAnomalies(page, label) {
  const body = await getBodyText(page);
  const patterns = ['[object Object]', 'undefined', 'NaN', 'Traceback', 'Internal Server Error'];
  patterns.forEach(p => {
    if (body.includes(p)) flag(`"${p}" visible in body during "${label}"`);
  });
}

async function readHeaderCounts(page) {
  // Header sub-text: "X of Y columns enriched · Z approved [in table]"
  return page.evaluate(() => {
    const body = document.body.innerText;
    const m = body.match(/(\d+) of (\d+) columns enriched(?: . (\d+) approved)?/);
    return m ? { enriched: +m[1], total: +m[2], approved: m[3] ? +m[3] : null } : null;
  });
}

async function readFooterCount(page) {
  // Footer bar: "N columns" or "N / M columns"
  return page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    const s = spans.find(s => /\d+(\s*\/\s*\d+)?\s*columns$/.test(s.textContent.trim()));
    return s ? s.textContent.trim() : null;
  });
}

async function countColumnRows(page) {
  return page.evaluate(() => {
    const allCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    return allCheckboxes.length > 0 ? allCheckboxes.length - 1 : 0;
  });
}

async function readApprovedChip(page) {
  return page.evaluate(() => {
    const body = document.body.innerText;
    const m = body.match(/(\d+)\s*approved/);
    return m ? +m[1] : null;
  });
}

async function readCdeScores(page) {
  // Grab all "CDE · N" chip scores and standalone score numbers next to rows
  return page.evaluate(() => {
    const body = document.body.innerText;
    const matches = [...body.matchAll(/CDE\s*.\s*(-?\d+)/g)].map(m => +m[1]);
    return matches;
  });
}

async function readSidebarCoverage(page) {
  // Returns array of "enriched/total" strings visible in sidebar
  return page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    return spans
      .map(s => s.textContent.trim())
      .filter(t => /^\d+\/\d+$/.test(t));
  });
}

(async () => {
  try { await checkAppHealth(); }
  catch (e) { console.error('\nApp not reachable:', e.message); process.exit(1); }

  const { browser, page } = await launchBrowser({ chromium }, { headless: true, slowMo: 30 });
  const jsErrors = collectJsErrors(page);

  try {
    // ── LOGIN ──────────────────────────────────────────────────────────────
    console.log('\n=== LOGIN ===');
    await login(page);
    await ss(page, 'after_login');

    // Pin to demo connection first (has seeded fixtures)
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'metadata');
    await page.waitForTimeout(2500);
    await ss(page, 'metadata_demo_initial_all_tables');
    await scanForAnomalies(page, 'demo initial (All tables)');

    // ── HEADER / FOOTER COUNT CONSISTENCY (All tables view) ─────────────────
    console.log('\n=== COUNT CONSISTENCY: ALL TABLES ===');
    let header = await readHeaderCounts(page);
    let footer = await readFooterCount(page);
    let rows = await countColumnRows(page);
    let approvedChip = await readApprovedChip(page);
    note(`Header: ${JSON.stringify(header)}`);
    note(`Footer: "${footer}"`);
    note(`Rendered checkbox rows: ${rows}`);
    note(`"Approved" chip value: ${approvedChip}`);
    if (header && header.total !== rows) {
      flag(`Header total (${header.total}) != rendered row count (${rows}) in All-tables view — table divider rows may be inflating/deflating the checkbox count, or header uses metaRows.length while displayRows differs`);
    }
    if (header && approvedChip !== null && header.approved !== null && header.approved !== approvedChip) {
      flag(`Header sub-text approved (${header.approved}) != top-right "approved" chip (${approvedChip})`);
    }

    const cdeScores = await readCdeScores(page);
    note(`CDE chip scores found: ${JSON.stringify(cdeScores)}`);
    cdeScores.forEach(s => {
      if (s < 0 || s > 100 || Number.isNaN(s)) flag(`CDE score out of [0,100] or NaN: ${s}`);
    });

    // ── SELECT A TABLE (populated single-table state) ───────────────────────
    console.log('\n=== SELECT TABLE ===');
    const tableBtn = page.locator('div[style*="width: 248"] button').nth(1);
    const sidebarTableButtons = await page.locator('div[style*="248"] >> Mono, div').count();
    // Click first table entry under first layer group (skip "All tables" row)
    const firstTableRow = page.locator('button:has(span.dt-mono), button').filter({ hasText: /\./ }).first();
    let selectedSomeTable = false;
    try {
      // Expand approach: find any Mono-styled table name text and click its parent button
      const candidateButtons = await page.$$('div[style*="width: 248"] button');
      for (const btn of candidateButtons) {
        const txt = (await btn.innerText()).trim();
        if (txt && !txt.toLowerCase().startsWith('all tables') && txt.length > 0 && !/^(RAW|BRONZE|SILVER|GOLD|OTHER|UNKNOWN)/.test(txt) && !txt.includes('Enrich')) {
          await btn.click();
          selectedSomeTable = true;
          break;
        }
      }
    } catch (e) { note('Table select click failed: ' + e.message); }
    await page.waitForTimeout(1500);
    await ss(page, 'metadata_demo_table_selected');
    await scanForAnomalies(page, 'table selected (populated state)');
    note(`Selected a table row: ${selectedSomeTable}`);

    header = await readHeaderCounts(page);
    footer = await readFooterCount(page);
    rows = await countColumnRows(page);
    note(`[table-selected] Header: ${JSON.stringify(header)}, Footer: "${footer}", rows: ${rows}`);
    if (header && header.total !== rows) {
      flag(`[table-selected] Header total (${header.total}) != rendered row count (${rows})`);
    }

    // ── EXPAND ROW + EDIT MODE ───────────────────────────────────────────────
    console.log('\n=== EXPAND ROW + EDIT ===');
    const chevronBtns = await page.$$('div[style*="11px 20px"] button');
    if (chevronBtns.length > 0) {
      await chevronBtns[0].click();
      await page.waitForTimeout(600);
      await ss(page, 'metadata_row_expanded');
      await scanForAnomalies(page, 'row expanded');

      // Click Edit (pencil) if present
      const editBtn = await page.$('button[title="Edit"]');
      if (editBtn) {
        await editBtn.click();
        await page.waitForTimeout(500);
        await ss(page, 'metadata_row_edit_mode');
        await scanForAnomalies(page, 'edit mode');
        // Cancel to not mutate data
        const cancelBtn = await page.$('button:has-text("Cancel")');
        if (cancelBtn) await cancelBtn.click();
      } else {
        note('No Edit button found on expanded row (maybe rejected/no column_id)');
      }
    } else {
      note('No column rows to expand');
    }

    // ── FILTERS ───────────────────────────────────────────────────────────
    console.log('\n=== FILTERS ===');
    // Search
    const searchInput = await page.$('input[placeholder="Search columns…"]');
    if (searchInput) {
      await searchInput.fill('id');
      await page.waitForTimeout(700);
      await ss(page, 'filter_search_id');
      await scanForAnomalies(page, 'search filter "id"');
      let hRows = await countColumnRows(page);
      let hFooter = await readFooterCount(page);
      note(`[search=id] rows=${hRows} footer="${hFooter}"`);

      await searchInput.fill('zzz_no_such_column_xyz');
      await page.waitForTimeout(700);
      await ss(page, 'filter_search_no_match');
      await scanForAnomalies(page, 'search filter no-match');
      hRows = await countColumnRows(page);
      hFooter = await readFooterCount(page);
      note(`[search=no-match] rows=${hRows} footer="${hFooter}"`);
      const bodyNoMatch = await getBodyText(page);
      if (!/no columns match/i.test(bodyNoMatch) && hRows !== 0) {
        flag('No-match search does not show explicit "no columns match" empty state');
      }
      await searchInput.fill('');
    }

    // Status filter
    const selects = await page.$$('select');
    // selects order: [filterLayer?] filterStatus filterIsCDE filterIsPII (filterLayer hidden when table selected)
    for (const sel of selects) {
      const options = await sel.$$eval('option', opts => opts.map(o => o.textContent));
      note(`Select options: ${JSON.stringify(options)}`);
    }
    if (selects.length > 0) {
      // Try to set status = approved (find select containing "Approved" option)
      for (const sel of selects) {
        const optVals = await sel.$$eval('option', opts => opts.map(o => o.value));
        if (optVals.includes('approved')) {
          await sel.selectOption('approved');
          await page.waitForTimeout(700);
          await ss(page, 'filter_status_approved');
          await scanForAnomalies(page, 'status=approved filter');
          const r = await countColumnRows(page);
          const f = await readFooterCount(page);
          note(`[status=approved] rows=${r} footer="${f}"`);
          await sel.selectOption('ALL');
          break;
        }
      }
      // CDE filter
      for (const sel of selects) {
        const optVals = await sel.$$eval('option', opts => opts.map(o => o.value));
        if (optVals.includes('yes') && optVals.includes('no')) {
          const label = await sel.evaluate(el => el.options[0].textContent);
          if (label.includes('CDE')) {
            await sel.selectOption('yes');
            await page.waitForTimeout(700);
            await ss(page, 'filter_cde_only');
            await scanForAnomalies(page, 'CDE-only filter');
            const r = await countColumnRows(page);
            const f = await readFooterCount(page);
            note(`[CDE=yes] rows=${r} footer="${f}"`);
            await sel.selectOption('ALL');
          }
        }
      }
      // PII filter
      for (const sel of selects) {
        const optVals = await sel.$$eval('option', opts => opts.map(o => o.value));
        if (optVals.includes('yes') && optVals.includes('no')) {
          const label = await sel.evaluate(el => el.options[0].textContent);
          if (label.includes('PII')) {
            await sel.selectOption('yes');
            await page.waitForTimeout(700);
            await ss(page, 'filter_pii_only');
            await scanForAnomalies(page, 'PII-only filter');
            const r = await countColumnRows(page);
            const f = await readFooterCount(page);
            note(`[PII=yes] rows=${r} footer="${f}"`);
            await sel.selectOption('ALL');
          }
        }
      }
    }
    await page.waitForTimeout(500);

    // Layer filter — go back to All tables first
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(b => b.textContent.trim() === 'All tables');
      if (b) b.click();
    });
    await page.waitForTimeout(1000);
    const layerSelect = await page.$('select');
    if (layerSelect) {
      const optVals = await layerSelect.$$eval('option', opts => opts.map(o => o.value));
      note(`Layer filter options: ${JSON.stringify(optVals)}`);
      if (optVals.includes('RAW')) {
        await layerSelect.selectOption('RAW');
        await page.waitForTimeout(700);
        await ss(page, 'filter_layer_raw');
        await scanForAnomalies(page, 'layer=RAW filter');
        const r = await countColumnRows(page);
        const f = await readFooterCount(page);
        note(`[layer=RAW] rows=${r} footer="${f}"`);
        await layerSelect.selectOption('ALL');
      }
    }

    // ── BULK SELECT + BULK ACTIONS ───────────────────────────────────────────
    console.log('\n=== BULK ACTIONS ===');
    await page.waitForTimeout(500);
    const rowCheckboxes = await page.$$('input[type="checkbox"]');
    if (rowCheckboxes.length > 2) {
      await rowCheckboxes[1].check();
      await rowCheckboxes[2].check();
      await page.waitForTimeout(500);
      await ss(page, 'bulk_select_two_rows');
      await scanForAnomalies(page, 'bulk select 2 rows');

      const bulkBar = await getBodyText(page);
      if (!bulkBar.includes('selected')) flag('Bulk action bar did not appear after checking rows');

      // Select-all checkbox
      if (rowCheckboxes[0]) {
        await rowCheckboxes[0].check();
        await page.waitForTimeout(500);
        await ss(page, 'bulk_select_all');
        await scanForAnomalies(page, 'select-all checkbox');
        const afterAllText = await getBodyText(page);
        const selMatch = afterAllText.match(/(\d+) selected/);
        const rowsNow = await countColumnRows(page);
        note(`[select-all] "selected" badge=${selMatch ? selMatch[1] : '?'}, rendered rows=${rowsNow}`);
        if (selMatch && +selMatch[1] !== rowsNow) {
          flag(`Select-all badge count (${selMatch[1]}) != rendered row count (${rowsNow}) — may include divider rows or filteredRows/displayRows mismatch`);
        }
      }
    } else {
      note('Not enough rows to test bulk select');
    }
    // Clear selection without mutating data (avoid destructive bulk approve/reject in shared demo data)
    const clearBtn = await page.$('button:has-text("Clear")');
    if (clearBtn) await clearBtn.click();
    await page.waitForTimeout(400);
    await ss(page, 'bulk_cleared');

    // ── CDE REGISTRY + PII PANEL ─────────────────────────────────────────────
    console.log('\n=== CDE REGISTRY + PII PANEL ===');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    await ss(page, 'cde_registry_and_pii_panel');
    await scanForAnomalies(page, 'CDE registry + PII panel');
    await page.evaluate(() => window.scrollTo(0, 0));

    // ── ADD COLUMN MODAL ──────────────────────────────────────────────────
    console.log('\n=== ADD COLUMN MODAL ===');
    const addBtn = await page.$('button:has-text("Add column manually")');
    if (addBtn) {
      await addBtn.click();
      await page.waitForTimeout(500);
      await ss(page, 'add_column_modal_open');
      await scanForAnomalies(page, 'add column modal');
      // Diagnose stacking: what element is actually on top at the submit button's location?
      const stackDiag = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const submit = btns.find(b => b.textContent.trim() === 'Add column');
        if (!submit) return { found: false };
        const rect = submit.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const topEl = document.elementFromPoint(cx, cy);
        return {
          found: true,
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          topElTag: topEl ? topEl.tagName : null,
          topElText: topEl ? topEl.textContent.slice(0, 60) : null,
          topElIsSubmitOrChild: topEl ? (topEl === submit || submit.contains(topEl)) : false,
          submitZIndex: getComputedStyle(submit).zIndex,
        };
      });
      note(`Add-column submit button stacking diag: ${JSON.stringify(stackDiag)}`);
      if (stackDiag.found && !stackDiag.topElIsSubmitOrChild) {
        flag(`Add-column modal "Add column" submit button is UNCLICKABLE — a different element ("${stackDiag.topElTag}": "${stackDiag.topElText}") is on top of it at its screen position. Modal overlay/stacking is broken.`);
      }
      // Try submitting empty to check validation (JS click bypasses the stacking issue so we can still see the toast/validation)
      const submitBtn = await page.$('button:has-text("Add column")');
      if (submitBtn) {
        await submitBtn.evaluate(el => el.click());
        await page.waitForTimeout(400);
        await ss(page, 'add_column_modal_validation');
      }
      // Close without submitting — click backdrop via JS (overlapping row content
      // intercepts pointer-events for a normal click)
      await page.evaluate(() => {
        const overlay = Array.from(document.querySelectorAll('div')).find(d =>
          d.style.position === 'fixed' && d.style.inset === '0px'
        );
        if (overlay) overlay.click();
      });
      await page.waitForTimeout(400);
    }

    // ── EXPORT BUTTON ─────────────────────────────────────────────────────
    console.log('\n=== EXPORT DICTIONARY ===');
    const exportBtn = await page.$('button:has-text("Export dictionary")');
    if (exportBtn) {
      const isDisabled = await exportBtn.isDisabled();
      note(`Export button disabled: ${isDisabled}`);
      await ss(page, 'export_button_visible');
    }

    // ── SIDEBAR COVERAGE BEFORE / AFTER APPROVE (no-reload check) ────────────
    console.log('\n=== SIDEBAR COVERAGE REACTIVITY (approve without reload) ===');
    const coverageBefore = await readSidebarCoverage(page);
    note(`Sidebar coverage fractions before: ${JSON.stringify(coverageBefore)}`);
    // Find a draft row's approve button and click it, then re-check sidebar without reload
    const approveBtn = await page.$('button[title="Approve"]');
    if (approveBtn) {
      await approveBtn.click();
      await page.waitForTimeout(1500); // loadData() is async
      await ss(page, 'after_single_approve_sidebar');
      await scanForAnomalies(page, 'after single approve (sidebar reactivity)');
      const coverageAfter = await readSidebarCoverage(page);
      note(`Sidebar coverage fractions after: ${JSON.stringify(coverageAfter)}`);
      const approvedChipAfter = await readApprovedChip(page);
      note(`"Approved" chip after approve: ${approvedChipAfter}`);
      if (JSON.stringify(coverageBefore) === JSON.stringify(coverageAfter)) {
        flag('Sidebar per-table coverage fractions unchanged after approving a column — approve does not affect enriched/total anyway (expected, since coverage counts "enriched" not "approved"), but verify approved-count displayed elsewhere updates');
      }
    } else {
      note('No Approve button found to test sidebar reactivity (all rows already approved/rejected, or none rendered)');
    }

    // ── EMPTY STATE: switch to ofc connection (may have fewer/no dictionary rows) ──
    console.log('\n=== CONNECTION SWITCH: demo -> ofc ===');
    const demoBodyBefore = await getBodyText(page);
    const demoHeaderCounts = await readHeaderCounts(page);
    const demoCdeScores = await readCdeScores(page);
    note(`[demo] header counts: ${JSON.stringify(demoHeaderCounts)}, cde scores: ${JSON.stringify(demoCdeScores)}`);

    await useConnection(page, CONNECTIONS.ofc);
    await goTo(page, 'metadata');
    await page.waitForTimeout(2500);
    await ss(page, 'metadata_ofc_after_switch');
    await scanForAnomalies(page, 'ofc connection after switch');

    const ofcBodyAfter = await getBodyText(page);
    const ofcHeaderCounts = await readHeaderCounts(page);
    const ofcCdeScores = await readCdeScores(page);
    note(`[ofc] header counts: ${JSON.stringify(ofcHeaderCounts)}, cde scores: ${JSON.stringify(ofcCdeScores)}`);

    if (demoBodyBefore === ofcBodyAfter) {
      flag('CRITICAL: metadata screen body text IDENTICAL between demo and ofc connections — possible stale data / no isolation');
    } else {
      ok('Body text differs between demo and ofc connections (isolation looks OK at text level)');
    }

    // Check for empty state on ofc if no dictionary data
    if (/No column metadata yet|Select a table from the sidebar/i.test(ofcBodyAfter)) {
      note('ofc connection shows empty-state message (no dictionary entries yet) — this IS the "empty state" required screenshot');
    }

    // Switch back to demo, verify restoration (no stale flash / leakage)
    console.log('\n=== CONNECTION SWITCH BACK: ofc -> demo ===');
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'metadata');
    await page.waitForTimeout(2500);
    await ss(page, 'metadata_demo_after_switch_back');
    await scanForAnomalies(page, 'demo after switch back');
    const demoBodyRestored = await getBodyText(page);
    const demoHeaderRestored = await readHeaderCounts(page);
    note(`[demo restored] header counts: ${JSON.stringify(demoHeaderRestored)}`);
    if (JSON.stringify(demoHeaderCounts) !== JSON.stringify(demoHeaderRestored)) {
      flag(`Demo connection header counts changed after round-trip through ofc: before=${JSON.stringify(demoHeaderCounts)} after=${JSON.stringify(demoHeaderRestored)} (could be legit due to the approve click earlier, or could indicate leakage)`);
    }

    // ── EMPTY STATE: explicit — sidebar with no tables (simulate via ofc if none) ──
    console.log('\n=== EXPLICIT EMPTY STATE CHECK ===');
    // Already captured above for ofc if applicable. Also check "no tables" sidebar text.
    const sidebarEmptyText = await page.evaluate(() => document.body.innerText.includes('No tables found'));
    note(`Sidebar shows "No tables found": ${sidebarEmptyText}`);

    // ── JS ERRORS ─────────────────────────────────────────────────────────
    console.log('\n=== JS ERRORS ===');
    const significantErrors = jsErrors.filter(e =>
      !e.includes('favicon') && !e.includes('net::ERR_ABORTED') && !e.includes('lucide')
      && !e.includes('401')
    );
    if (significantErrors.length > 0) {
      significantErrors.slice(0, 15).forEach(e => {
        console.log(`    JS-ERR: ${e.slice(0, 200)}`);
        flag(`JS error: ${e.slice(0, 150)}`);
      });
    } else {
      ok('No significant JS errors collected');
    }

    console.log('\n' + '='.repeat(70));
    console.log('  NOTES / FLAGS LOG');
    console.log('='.repeat(70));
    notes.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
    console.log(`\n  Screenshots -> ${SCREENSHOTS_DIR}`);

  } catch (err) {
    console.error('\nFATAL:', err.message, err.stack);
    await ss(page, 'fatal_error').catch(() => {});
  } finally {
    await browser.close();
  }
})();
