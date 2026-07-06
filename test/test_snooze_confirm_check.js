const { chromium } = require('playwright');
const { launchBrowser, login, goTo, useConnection, CONNECTIONS } = require('./config');

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(1000);

    // Find the first snooze-clock button and click it
    const snoozeBtn = page.locator('button[title="Snooze"]').first();
    await snoozeBtn.click();
    await page.waitForTimeout(400);

    // Scope strictly to THIS row's snooze picker container, not the whole page
    const result = await page.evaluate(() => {
      const clockBtns = Array.from(document.querySelectorAll('button[title="Snooze"]'));
      // Find the currently-open picker (has a date input as sibling)
      const openPicker = Array.from(document.querySelectorAll('div')).find(d =>
        d.querySelector('input[type="date"]') && d.innerText.includes('Confirm')
      );
      if (!openPicker) return { found: false };
      const confirmBtn = Array.from(openPicker.querySelectorAll('button')).find(b => b.textContent.trim() === 'Confirm');
      return {
        found: true,
        disabledWithNoDate: confirmBtn.disabled,
        dateInputValue: openPicker.querySelector('input[type="date"]').value,
      };
    });
    console.log('Snooze Confirm check (scoped):', JSON.stringify(result));

    // Now set a date and check again
    const dateInput = page.locator('input[type="date"]').first();
    await dateInput.fill('2026-12-31');
    await page.waitForTimeout(200);
    const result2 = await page.evaluate(() => {
      const openPicker = Array.from(document.querySelectorAll('div')).find(d =>
        d.querySelector('input[type="date"]') && d.innerText.includes('Confirm')
      );
      const confirmBtn = Array.from(openPicker.querySelectorAll('button')).find(b => b.textContent.trim() === 'Confirm');
      return { disabledWithDate: confirmBtn.disabled };
    });
    console.log('After setting a date:', JSON.stringify(result2));

  } finally {
    await browser.close();
  }
})();
