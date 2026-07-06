// DE stakeholder review — Rule Studio edge cases, batch 2:
// API failure, slow API, snooze validation, reject/re-approve flow, NL edge inputs,
// bulk-select with mixed own/not-own rules, rapid double-click.
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, ss, collectJsErrors, useConnection, CONNECTIONS } = require('./config');

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  const errors = collectJsErrors(page);

  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);

    // ---- Edge: API failure on /api/rules (listRules) ----
    console.log('=== API failure: /api/rules aborted ===');
    await page.route('**/api/rules?**', route => route.abort('failed'));
    await goTo(page, 'rules');
    await page.waitForTimeout(1500);
    await ss(page, 'edge-07-api-failure-listrules');
    let body = await page.locator('body').innerText();
    console.log('  Body has stack trace leak:', /Traceback|\.js:\d+:\d+|at Object\./.test(body));
    console.log('  Page still renders shell (not blank):', body.length > 200);
    await page.unroute('**/api/rules?**');

    // ---- Edge: API failure on rule generation (POST /api/rules/recommend) ----
    console.log('\n=== API failure: rule generation aborted ===');
    await page.reload();
    await page.waitForTimeout(1500);
    await goTo(page, 'rules'); // reload drops SPA client-side route back to Workspace Home — re-navigate
    await page.waitForTimeout(1000);
    await page.route('**/api/rules/recommend', route => route.abort('failed'));
    await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      const btns = Array.from(container.querySelectorAll('button'));
      const target = btns.find(b => b.innerText.trim().split('\n')[0] === 'dim_customer');
      if (target) target.click();
    });
    await page.waitForTimeout(500);
    const genBtn = page.locator('button', { hasText: /^Generate rules$/ }).first();
    if (await genBtn.count()) {
      await genBtn.click();
      await page.waitForTimeout(2000);
      await ss(page, 'edge-08-generate-api-failure');
      body = await page.locator('body').innerText();
      console.log('  Error toast/message shown:', /unavailable|failed|error/i.test(body));
      console.log('  Button re-enabled after failure (not stuck "Generating…"):',
        !/Generating…/.test(await genBtn.innerText().catch(() => '')));
    } else {
      console.log('  Generate button not found for dim_customer — skipping');
    }
    await page.unroute('**/api/rules/recommend');

    // ---- Edge: rapid double-click on Generate (race condition guard) ----
    console.log('\n=== Rapid double-click on Generate ===');
    await page.reload();
    await page.waitForTimeout(1500);
    await goTo(page, 'rules');
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      const btns = Array.from(container.querySelectorAll('button'));
      const target = btns.find(b => b.innerText.trim().split('\n')[0] === 'dim_customer');
      if (target) target.click();
    });
    await page.waitForTimeout(500);
    const apiCalls = [];
    page.on('request', req => { if (req.url().includes('/api/rules/recommend') && req.method() === 'POST') apiCalls.push(Date.now()); });
    const genBtn2 = page.locator('button', { hasText: /^Generate rules$/ }).first();
    if (await genBtn2.count()) {
      await Promise.all([genBtn2.click(), genBtn2.click(), genBtn2.click()]);
      await page.waitForTimeout(1000);
      console.log('  POST /recommend calls fired from triple-click:', apiCalls.length, '(expected 1 if guarded)');
      await ss(page, 'edge-09-rapid-doubleclick-generate');
      // Let the single legit generation finish before moving on
      await page.waitForTimeout(15000);
    }

    console.log('\n=== JS ERRORS so far ===');
    console.log(errors.length ? errors.join('\n') : 'None');

  } catch (e) {
    console.error('BATCH 2 FAILED:', e);
    await ss(page, 'edge-99-error-batch2');
  } finally {
    await browser.close();
  }
})();
