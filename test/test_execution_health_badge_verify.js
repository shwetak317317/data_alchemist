/**
 * Verifies the P0 fix: pipeline health badge must reflect ERROR status, not just FAIL.
 * Switches to the `demo` connection (has existing ERROR-status results from a dead
 * SQL Server) and confirms the header badge shows Issues, not Healthy.
 */
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, useConnection, CONNECTIONS, ss } = require('./config');

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false, slowMo: 30 });
  page.setDefaultTimeout(15000);
  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    await ss(page, '01_demo_execution_badge');

    const headerText = await page.locator('body').innerText();
    const hasIssuesBadge = /Pipeline\s*[·\-]\s*Issues/i.test(headerText) || headerText.includes('Issues detected');
    const hasHealthyBadge = /Pipeline\s*[·\-]\s*Healthy/i.test(headerText);
    console.log('[badge] Issues detected:', hasIssuesBadge, '| Healthy shown:', hasHealthyBadge);

    if (hasHealthyBadge && !hasIssuesBadge) {
      console.log('❌ FAIL — pipeline badge shows Healthy on a connection with only ERROR-status rules');
      process.exitCode = 1;
    } else {
      console.log('✅ PASS — pipeline badge does not falsely claim Healthy');
    }
  } catch (err) {
    console.error('TEST FAILED:', err);
    await ss(page, 'ERROR_STATE');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
