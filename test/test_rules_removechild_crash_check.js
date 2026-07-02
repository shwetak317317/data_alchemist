// Check for the known app-wide removeChild crash pattern (lucide.createIcons() +
// conditional unmount of icon-bearing <Button icon="..."> / IconBtn elements)
// anywhere else in Rule Studio besides the already-fixed "Edit expression" flow.
// Candidate spots: approve/reject/snooze icon buttons that disappear when a row's
// status changes (done/rejected/snoozed branches at screens_rules.jsx ~622-648),
// and the inline expression edit row (Save/Cancel replacing Mono display).
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
    await ss(page, 'crash-00-loaded');

    // 1. Rapidly approve a pending rule (icon buttons unmount: check/pencil/clock/x -> single chip+play)
    for (let i = 0; i < 3; i++) {
      const approveBtn = page.locator('button[title="Approve"]').first();
      if (await approveBtn.count() === 0) break;
      await approveBtn.click();
      await page.waitForTimeout(800);
    }
    await ss(page, 'crash-01-after-rapid-approves');

    // 2. Open + close the inline expression editor repeatedly (Mono <-> input+Save/Cancel swap)
    const pencilBtn = page.locator('button[title="Edit"]').first();
    if (await pencilBtn.count() > 0) {
      for (let i = 0; i < 3; i++) {
        await pencilBtn.click();
        await page.waitForTimeout(400);
        const cancelBtn = page.getByRole('button', { name: 'Cancel', exact: true }).first();
        if (await cancelBtn.count() > 0) {
          await cancelBtn.click();
          await page.waitForTimeout(400);
        }
      }
      await ss(page, 'crash-02-after-edit-toggle-loop');
    }

    // 3. Open snooze picker, cancel, repeat (icon clock button coexists with Confirm/Cancel row)
    const snoozeBtn = page.locator('button[title="Snooze"]').first();
    if (await snoozeBtn.count() > 0) {
      for (let i = 0; i < 3; i++) {
        await snoozeBtn.click();
        await page.waitForTimeout(400);
        const cancelBtn2 = page.getByRole('button', { name: 'Cancel', exact: true }).first();
        if (await cancelBtn2.count() > 0) {
          await cancelBtn2.click();
          await page.waitForTimeout(400);
        }
      }
      await ss(page, 'crash-03-after-snooze-toggle-loop');
    }

    // 4. Reject a rule right after approving another (mixed status transitions in same render pass)
    const rejectBtn = page.locator('button[title="Reject"]').first();
    if (await rejectBtn.count() > 0) {
      await rejectBtn.click();
      await page.waitForTimeout(800);
    }
    const approveBtn2 = page.locator('button[title="Approve"]').nth(1);
    if (await approveBtn2.count() > 0) {
      await approveBtn2.click();
      await page.waitForTimeout(800);
    }
    await ss(page, 'crash-04-mixed-transitions');

    // 5. Check for React error boundary text / removeChild in console
    const bodyText = await page.locator('body').innerText();
    const crashed = bodyText.includes('Something went wrong') || bodyText.includes('removeChild') || bodyText.includes('Unexpected Application Error');
    console.log('[crash-check] Error boundary triggered:', crashed);
    console.log('[crash-check] JS errors found:', errors.length);
    errors.forEach(e => console.log('  -', e.split('\n')[0]));

    await ss(page, 'crash-05-final-state');
  } finally {
    await browser.close();
  }
})();
