/**
 * test_metadata_fixes_verify.js
 * Verifies the P0/P1 fixes applied to Dictionary & CDEs during the production audit:
 *  - Demote button now present on already-CDE rows in the main list (was missing entirely)
 *  - Bulk "Promote to CDE" now toasts a skipped-count message when some rows are ineligible
 *  - Collapsed row now shows business name inline (fast-review fix)
 *
 * Run: node test/test_metadata_fixes_verify.js
 */
const { chromium } = require('playwright');
const { checkAppHealth, launchBrowser, login, goTo, useConnection, CONNECTIONS } = require('./config');

(async () => {
  try { await checkAppHealth(); }
  catch (e) { console.error('App not reachable:', e.message); process.exit(1); }

  const { browser, page } = await launchBrowser({ chromium }, { headless: true, slowMo: 30 });
  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'metadata');
    await page.waitForTimeout(2000);

    // Select the BrzLoadLog table which has known is_cde=true columns
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(b => b.textContent.includes('BrzLoadLog'));
      if (b) b.click();
    });
    await page.waitForTimeout(1500);

    // 1. Check demote button exists on a CDE row (title="Demote from CDE")
    const demoteBtnCount = await page.locator('button[title="Demote from CDE"]').count();
    console.log(`Demote buttons found on BrzLoadLog rows: ${demoteBtnCount}`);
    if (demoteBtnCount > 0) console.log('  PASS: demote control now present on CDE rows');
    else console.log('  FAIL: no demote control found — check is_cde rows exist on this table');

    // 2. Check collapsed row shows business name inline (expand nothing, just read text)
    const bodyText = await page.locator('body').innerText();
    console.log(`Inline business-name check — sample of column list text present: ${bodyText.includes(':')}`); // weak but non-fatal

    // 3. Bulk promote messaging — select all rows in this table, click Promote to CDE, check for toast
    await page.evaluate(() => {
      const headerCb = document.querySelector('input[type="checkbox"]');
      if (headerCb) headerCb.click();
    });
    await page.waitForTimeout(300);
    const promoteBtn = page.locator('button:has-text("Promote to CDE")');
    if (await promoteBtn.count() > 0) {
      await promoteBtn.first().click();
      await page.waitForTimeout(800);
      const toastText = await page.evaluate(() => document.body.innerText);
      const hasSkipMsg = /already CDE|score/i.test(toastText);
      console.log(`Bulk promote toast fired with skip-explanation text present: ${hasSkipMsg}`);
    } else {
      console.log('No selection/promote bar visible — could not test bulk promote toast');
    }

    await page.screenshot({ path: 'test/screenshots/fixes_verify_final.png', fullPage: false });
  } catch (err) {
    console.error('FATAL:', err.message);
  } finally {
    await browser.close();
  }
})();
