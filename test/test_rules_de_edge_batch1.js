// DE stakeholder review — Rule Studio edge cases, batch 1:
// state inventory (empty/single/large) + connection isolation.
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, ss, collectJsErrors, useConnection, CONNECTIONS } = require('./config');

const BAD_PATTERNS = /\[object Object\]|undefined|NaN|(?<!ISNULL\()null(?!\))/i;

function scanBody(bodyText, label) {
  const hits = [];
  if (/\[object Object\]/.test(bodyText)) hits.push('[object Object]');
  if (/(?<![\w.])undefined(?![\w])/.test(bodyText)) hits.push('undefined');
  if (/\bNaN\b/.test(bodyText)) hits.push('NaN');
  if (hits.length) console.log(`  ⚠️  [${label}] suspicious tokens found: ${hits.join(', ')}`);
  else console.log(`  ✅ [${label}] clean — no [object Object]/undefined/NaN`);
}

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  const errors = collectJsErrors(page);

  try {
    await login(page);
    console.log('=== Logged in ===');

    // ---- State 1: EMPTY (a table with zero rules) ----
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      const btns = Array.from(container.querySelectorAll('button'));
      const target = btns.find(b => b.innerText.trim().split('\n')[0] === 'dim_customer');
      if (target) target.click();
    });
    await page.waitForTimeout(600);
    await ss(page, 'edge-01-empty-state-dim_customer');
    let body = await page.locator('body').innerText();
    scanBody(body, 'empty-state');
    console.log('  Empty-state message present:', /No rules yet/i.test(body));

    // ---- State 2: SINGLE-ish (a table with very few rules, e.g. br_warehouses had 1) ----
    await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      const btns = Array.from(container.querySelectorAll('button'));
      const target = btns.find(b => b.innerText.trim().split('\n')[0] === 'br_warehouses');
      if (target) target.click();
    });
    await page.waitForTimeout(600);
    await ss(page, 'edge-02-single-record-br_warehouses');
    body = await page.locator('body').innerText();
    scanBody(body, 'single-record');

    // ---- State 3: LARGE dataset — "All tables" (700+) ----
    await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      const btn = Array.from(container.querySelectorAll('button')).find(b => b.innerText.trim() === 'All tables');
      if (btn) btn.click();
    });
    const t0 = Date.now();
    await page.waitForTimeout(1500);
    const loadMs = Date.now() - t0;
    await ss(page, 'edge-03-large-dataset-all-tables');
    body = await page.locator('body').innerText();
    scanBody(body, 'large-dataset');
    console.log(`  All-tables render settle time: ~${loadMs}ms (post-click observation window)`);

    // ---- Connection isolation: demo vs ofc ----
    console.log('\n=== Connection isolation test ===');
    const totalDemo = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('div')).find(d => /^\d+ rules ·/.test(d.textContent || ''));
      return el ? el.textContent.match(/^(\d+) rules/)[1] : null;
    });
    console.log('  Demo connection total rules:', totalDemo);
    await ss(page, 'edge-04-conn-demo-baseline');

    await useConnection(page, CONNECTIONS.ofc);
    await goTo(page, 'rules');
    await page.waitForTimeout(1200);
    const totalOfc = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('div')).find(d => /^\d+ rules ·/.test(d.textContent || ''));
      return el ? el.textContent.match(/^(\d+) rules/)[1] : null;
    });
    console.log('  Ofc connection total rules:', totalOfc);
    await ss(page, 'edge-05-conn-ofc');
    console.log('  Values differ (expected true):', totalDemo !== totalOfc);

    // Switch back to demo, confirm it restores correctly
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(1200);
    const totalDemoAgain = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('div')).find(d => /^\d+ rules ·/.test(d.textContent || ''));
      return el ? el.textContent.match(/^(\d+) rules/)[1] : null;
    });
    console.log('  Demo connection total rules (restored):', totalDemoAgain);
    await ss(page, 'edge-06-conn-demo-restored');

    console.log('\n=== JS ERRORS ===');
    console.log(errors.length ? errors.join('\n') : 'None');

  } catch (e) {
    console.error('BATCH 1 FAILED:', e);
    await ss(page, 'edge-99-error');
  } finally {
    await browser.close();
  }
})();
