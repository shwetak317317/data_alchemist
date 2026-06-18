/**
 * Monitoring section screenshots — Anomaly Inbox, Impact Graph, Trust Dashboard.
 * Requires: docker compose up (app at http://localhost)
 * Run: node test/test_monitoring_screenshots.js
 * Output: test/screenshots/<timestamp>/
 */

const { chromium } = require('playwright');
const {
  checkAppHealth, launchBrowser, login,
  goTo, collectJsErrors, ss,
} = require('./config');

(async () => {
  await checkAppHealth();
  const { browser, page } = await launchBrowser({ chromium }, { headless: true, slowMo: 50 });
  const jsErrors = collectJsErrors(page);

  await login(page);

  // ── 1. Anomaly Inbox ────────────────────────────────────────────────────────
  console.log('\n[anomaly inbox] navigating...');
  await goTo(page, 'anomalies');
  await page.waitForTimeout(1800);
  await ss(page, '01_anomaly_inbox_default');

  // Expand first anomaly card by clicking its body (not a button)
  try {
    const cards = await page.$$('div[style*="cursor: pointer"], .dt-card, [role="button"]');
    const anomalyCard = cards.find ? cards[0] : null;
    // Try clicking the first visible anomaly row / expand area
    const expandable = await page.$('div:has-text("CRITICAL"), div:has-text("HIGH"), div:has-text("Anomaly")');
    if (expandable) {
      await expandable.click();
      await page.waitForTimeout(900);
      await ss(page, '02_anomaly_inbox_expanded');
    }
  } catch (e) {
    console.log('  [note] Could not expand anomaly card:', e.message);
  }

  // Click "Explain in business terms" if visible
  try {
    const explainBtn = await page.$('button:has-text("Explain")');
    if (explainBtn) {
      await explainBtn.click();
      await page.waitForTimeout(3000);
      await ss(page, '03_anomaly_inbox_explained');
    } else {
      console.log('  [note] Explain button not visible');
    }
  } catch (e) {
    console.log('  [note] Explain button error:', e.message);
  }

  // ── 2. Impact Graph ─────────────────────────────────────────────────────────
  console.log('\n[impact graph] navigating...');
  await goTo(page, 'impact');
  await page.waitForTimeout(2200);   // cascade animation is ~1.5s
  await ss(page, '04_impact_graph_default');

  // Click Replay
  try {
    const replayBtn = await page.$('button:has-text("Replay"), button:has-text("replay")');
    if (replayBtn) {
      await replayBtn.click();
      await page.waitForTimeout(2200);
      await ss(page, '05_impact_graph_replayed');
    }
  } catch (e) {
    console.log('  [note] Replay button not found:', e.message);
  }

  // ── 3. Trust Dashboard — all 3 tabs ────────────────────────────────────────
  console.log('\n[trust dashboard] navigating...');
  await goTo(page, 'dashboard');
  await page.waitForTimeout(1800);
  await ss(page, '06_dashboard_default_tab');   // whatever tab is default

  // Click "Executive" tab
  try {
    const execTab = await page.$('button:has-text("Executive")');
    if (execTab) {
      await execTab.click();
      await page.waitForTimeout(600);
      await ss(page, '07_dashboard_exec_tab');
    } else {
      console.log('  [note] Executive tab button not found');
    }
  } catch (e) {
    console.log('  [note] Executive tab error:', e.message);
  }

  // Click "Technical" tab
  try {
    const techTab = await page.$('button:has-text("Technical")');
    if (techTab) {
      await techTab.click();
      await page.waitForTimeout(600);
      await ss(page, '08_dashboard_tech_tab');
    }
  } catch (e) {
    console.log('  [note] Technical tab error:', e.message);
  }

  // Click "Steward" or "Governance" tab
  try {
    const stewardTab = await page.$('button:has-text("Steward"), button:has-text("Governance"), button:has-text("CDO")');
    if (stewardTab) {
      await stewardTab.click();
      await page.waitForTimeout(600);
      await ss(page, '09_dashboard_steward_tab');
    } else {
      console.log('  [note] Steward tab button not found');
    }
  } catch (e) {
    console.log('  [note] Steward tab error:', e.message);
  }

  await browser.close();

  if (jsErrors.length) {
    console.warn('\n⚠️  JS console errors during run:');
    jsErrors.forEach(e => console.warn(' -', e));
  } else {
    console.log('\n✅ No JS errors detected.');
  }

  console.log('\nDone. Screenshots saved to test/screenshots/<timestamp>/');
})().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
