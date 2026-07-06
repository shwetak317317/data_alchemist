// DE stakeholder review — Rule Studio edge cases, batch 3:
// snooze validation, reject flow, NL converter edge inputs (empty/very long/unresolvable),
// bulk-select behavior.
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, ss, collectJsErrors, useConnection, CONNECTIONS } = require('./config');

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  const errors = collectJsErrors(page);

  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(1200);

    // ---- Edge: Snooze with a PAST date ----
    console.log('=== Snooze with a past date ===');
    await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      const btns = Array.from(container.querySelectorAll('button'));
      const target = btns.find(b => b.innerText.trim().split('\n')[0] === 'BrzLoadLog');
      if (target) target.click();
    });
    await page.waitForTimeout(600);
    const snoozeBtn = page.locator('button[title="Snooze"]').first();
    if (await snoozeBtn.count()) {
      await snoozeBtn.click();
      await page.waitForTimeout(300);
      const dateInput = page.locator('input[type="date"]').first();
      await dateInput.fill('2020-01-01'); // clearly in the past
      await page.waitForTimeout(200);
      await ss(page, 'edge-10-snooze-past-date');
      const confirmBtn = page.locator('button', { hasText: 'Confirm' }).first();
      const isDisabled = await confirmBtn.isDisabled().catch(() => null);
      console.log('  Confirm allowed with a PAST date (no validation)?', !isDisabled, '— if true, this is a gap: nothing stops snoozing into the past');
      // Cancel without confirming — don't actually corrupt data with a bad snooze
      await page.locator('button', { hasText: 'Cancel' }).first().click().catch(() => {});
    } else {
      console.log('  No snooze button found on BrzLoadLog rules — skipping');
    }

    // ---- Edge: NL converter — empty submit (already partially covered, recheck) ----
    console.log('\n=== NL converter: empty input submit ===');
    const nlInput = page.locator('input[placeholder*="revenue should never be negative"]');
    await nlInput.click({ clickCount: 3 });
    await nlInput.fill('');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    let body = await page.locator('body').innerText();
    console.log('  No crash / no fake result shown for empty submit:', !/Generated rule — review/i.test(body));
    await ss(page, 'edge-11-nl-empty-submit');

    // ---- Edge: NL converter — very long input (2000+ chars) ----
    console.log('\n=== NL converter: very long input ===');
    const longText = 'revenue should never be negative and also ' + 'x'.repeat(2000);
    await nlInput.fill(longText);
    await page.waitForTimeout(200);
    await ss(page, 'edge-12-nl-long-input-typed');
    const convertBtn = page.locator('button', { hasText: /Convert to rule|Converting/ }).first();
    await convertBtn.click();
    await page.waitForTimeout(15000);
    await ss(page, 'edge-13-nl-long-input-result');
    body = await page.locator('body').innerText();
    console.log('  No crash after long-input submit:', body.length > 200);
    console.log('  No raw error/stack leaked:', !/Traceback|\.js:\d+:\d+/.test(body));

    // ---- Edge: NL converter — gibberish/unresolvable input ----
    console.log('\n=== NL converter: unresolvable gibberish input ===');
    await nlInput.click({ clickCount: 3 });
    await nlInput.fill('the flibbertigibbet quantum must never exceed the moon cheese ratio');
    await page.waitForTimeout(200);
    await convertBtn.click();
    await page.waitForTimeout(15000);
    await ss(page, 'edge-14-nl-gibberish-result');
    body = await page.locator('body').innerText();
    console.log('  "unresolved" warning shown for nonsense input:', /Could not verify|Unresolved|unresolved/i.test(body));

    console.log('\n=== JS ERRORS ===');
    console.log(errors.length ? errors.join('\n') : 'None');

  } catch (e) {
    console.error('BATCH 3 FAILED:', e);
    await ss(page, 'edge-99-error-batch3');
  } finally {
    await browser.close();
  }
})();
