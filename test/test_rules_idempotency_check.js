// Focused check: does a rejected/snoozed rule's status survive a full page refresh
// and re-navigation to Rule Studio (idempotency / status-mapping lens)?
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, collectJsErrors, ss, useConnection, CONNECTIONS } = require('./config');

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  const errors = collectJsErrors(page);
  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(1500);
    await ss(page, 'idem-01-before');

    // Find a pending rule and reject it, note its name
    const rejectBtn = page.locator('button[title="Reject"]').first();
    let rejectedName = null;
    if (await rejectBtn.count() > 0) {
      const row = rejectBtn.locator('xpath=ancestor::div[contains(@style,"padding: 14px 20px") or contains(@style,"padding:14px 20px")][1]');
      rejectedName = await page.evaluate((btn) => {
        let el = btn;
        for (let i = 0; i < 6 && el; i++) el = el.parentElement;
        return el ? el.innerText.split('\n')[1] : null;
      }, await rejectBtn.elementHandle());
      console.log('[idem] Rejecting rule:', rejectedName);
      await rejectBtn.click();
      await page.waitForTimeout(1500);
      await ss(page, 'idem-02-after-reject-insession');
    }

    // Snooze another pending rule
    const snoozeBtn = page.locator('button[title="Snooze"]').first();
    let snoozedName = null;
    if (await snoozeBtn.count() > 0) {
      snoozedName = await page.evaluate((btn) => {
        let el = btn;
        for (let i = 0; i < 6 && el; i++) el = el.parentElement;
        return el ? el.innerText.split('\n')[1] : null;
      }, await snoozeBtn.elementHandle());
      console.log('[idem] Snoozing rule:', snoozedName);
      await snoozeBtn.click();
      await page.waitForTimeout(500);
      const dateInput = page.locator('input[type="date"]').first();
      await dateInput.fill('2026-12-31');
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await page.waitForTimeout(1500);
      await ss(page, 'idem-03-after-snooze-insession');
    }

    // Now do a REAL reload + re-navigate to rules (not just page.reload alone)
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction((t) => document.body.innerText.includes(t), 'Workspace Home', { timeout: 15000 }).catch(() => {});
    await goTo(page, 'rules');
    await page.waitForTimeout(2000);
    await ss(page, 'idem-04-after-full-reload-and-renav');

    const bodyText = await page.locator('body').innerText();
    console.log('[idem] "Rejected" chip visible after reload:', bodyText.includes('Rejected'));
    console.log('[idem] "Snoozed" chip visible after reload:', bodyText.includes('Snoozed'));
    if (rejectedName) console.log(`[idem] Rejected rule name "${rejectedName}" still visible:`, bodyText.includes(rejectedName));
    if (snoozedName) console.log(`[idem] Snoozed rule name "${snoozedName}" still visible:`, bodyText.includes(snoozedName));

    // Click Rejected status filter to see if the rejected rule shows there
    const rejectedFilterBtn = page.locator('button', { hasText: /^Rejected$/ });
    console.log('[idem] A "Rejected" STATUS filter button exists:', await rejectedFilterBtn.count() > 0);

    console.log('JS ERRORS:', errors.length ? errors : 'none');
  } finally {
    await browser.close();
  }
})();
