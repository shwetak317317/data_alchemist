// Retest part 2 — wait for regeneration to actually finish, then check for the
// false-positive 'dbo' warning in the freshly-generated rules.
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, ss, collectJsErrors, useConnection, CONNECTIONS } = require('./config');

const apiCalls = [];
function trackApi(page) {
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/rules')) {
      let body = '';
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('json')) body = (await res.text()).slice(0, 200);
      } catch (_) {}
      apiCalls.push({ method: res.request().method(), url: url.replace('http://localhost', ''), status: res.status(), body });
    }
  });
}

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  const errors = collectJsErrors(page);
  trackApi(page);

  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(1200);

    await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      const btns = Array.from(container.querySelectorAll('button'));
      const target = btns.find(b => b.innerText.trim().split('\n')[0] === 'dim_category');
      if (target) target.click();
    });
    await page.waitForTimeout(600);

    const regenBtn = page.locator('button', { hasText: /^(Generate|Regenerate) rules for/ }).first();
    await regenBtn.click();
    console.log('Clicked regenerate — waiting for it to finish (polling up to 60s)...');

    // Poll until the button text returns to "Regenerate rules for..." (not "Generating…")
    let finished = false;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000);
      const label = await page.locator('button', { hasText: /Generating|Regenerate rules for|Generate rules for/ }).first().innerText().catch(() => '');
      console.log(`  [${i * 2}s] button label: "${label}"`);
      if (label && !label.includes('Generating')) { finished = true; break; }
    }
    console.log('Regeneration finished:', finished);
    await page.waitForTimeout(800);
    await ss(page, '01-regenerated-dim_category');

    const result = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('div')).filter(el =>
        el.innerText && el.innerText.includes("Unverified column reference(s) ('dbo'") && el.innerText.length < 500
      );
      const exprBlocks = Array.from(document.querySelectorAll('pre, div')).filter(el =>
        el.children.length === 0 && /\[dbo\]|IS NOT NULL/.test(el.textContent) && el.textContent.length < 400
      ).map(e => e.textContent.trim());
      return { dboFalsePositiveCount: rows.length, expressions: exprBlocks.slice(0, 12) };
    });
    console.log('\n=== RESULT ===');
    console.log('"dbo" false-positive warnings after regeneration:', result.dboFalsePositiveCount);
    console.log('Sample expressions from freshly-generated rules:');
    result.expressions.forEach(e => console.log('  -', e));

    console.log('\n=== /api/rules calls ===');
    apiCalls.forEach(c => console.log(`${c.method} ${c.url} -> ${c.status}  ${c.status >= 400 ? c.body : ''}`));

    console.log('\n=== JS ERRORS ===');
    console.log(errors.length ? errors.join('\n') : 'None');

  } catch (e) {
    console.error('RETEST FAILED:', e);
    await ss(page, '99-error-state');
  } finally {
    await browser.close();
  }
})();
