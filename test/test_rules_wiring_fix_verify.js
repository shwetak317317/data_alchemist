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
    await ss(page, 'rules-loaded');

    // Try running a single APPROVED rule via the real ▶ button and watch for a real result (not fabricated)
    const playBtn = page.locator('button[title="Run this rule"]:not([disabled])').first();
    if (await playBtn.count() > 0) {
      await playBtn.click();
      await page.waitForTimeout(15000);
      await ss(page, 'rules-after-run-one');
    } else {
      console.log('[warn] No enabled (approved) runnable rule row found to click');
    }

    // Confirm a pending rule's Run button is disabled (no more guaranteed-400 click)
    const disabledPlayBtn = page.locator('button[title*="Approve this rule before running"]').first();
    console.log('Disabled play buttons found:', await disabledPlayBtn.count());

    // Try the NL suggestion chip flow (now hits the real API instead of synthRule stub)
    const chip = page.getByText('emails must be valid format', { exact: true });
    if (await chip.count() > 0) {
      await chip.click();
      await page.waitForTimeout(4000);
      await ss(page, 'rules-nl-chip-result');
    }

    // Test the previously-dead "Edit expression" button
    const editExprBtn = page.getByText('Edit expression', { exact: true });
    if (await editExprBtn.count() > 0) {
      await editExprBtn.click();
      await page.waitForTimeout(500);
      const textarea = page.locator('textarea');
      const hasTextarea = await textarea.count() > 0;
      console.log('Edit expression opened a textarea:', hasTextarea);
      if (hasTextarea) {
        await textarea.fill('LEN(email) > 5 AND email LIKE \'%@%\'');
        await page.getByText('Save expression', { exact: true }).click();
        await page.waitForTimeout(500);
        await ss(page, 'rules-edit-expr-saved');
      }
    } else {
      console.log('[warn] Edit expression button not found (no generated rule visible)');
    }

    console.log('JS ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
  } finally {
    await browser.close();
  }
})();
