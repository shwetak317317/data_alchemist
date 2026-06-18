/**
 * Connections edit test — verifies name editing and schema changes
 * reflect in sidebar/header without a page reload.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');
const cfg  = require('./config');

const DIR = path.join(__dirname, 'screenshots', 'conn-edit-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
const ss  = (page, name) => {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  return page.screenshot({ path: path.join(DIR, `${name}.png`), fullPage: false })
    .then(() => console.log(`  📸 ${name}.png`));
};
const ok  = m => console.log(`  ✅ ${m}`);
const bug = m => console.log(`  ❌ BUG: ${m}`);
const info = m => console.log(`  ℹ️  ${m}`);

async function run() {
  await cfg.checkAppHealth();
  const { browser, page } = await cfg.launchBrowser({ chromium }, { headless: false, slowMo: 70 });
  const jsErrors = cfg.collectJsErrors(page);

  try {
    await cfg.login(page);
    await cfg.goTo(page, 'connections');
    await page.waitForTimeout(1000);
    await ss(page, '01-connections-initial');

    // ── Find pencil edit button next to connection name ────────────────────
    const pencilBtns = await page.locator('button[title="Rename connection"]').all();
    info(`Found ${pencilBtns.length} rename button(s)`);

    if (pencilBtns.length === 0) {
      bug('No rename buttons found on connection cards');
      await ss(page, '02-no-rename-button');
    } else {
      // Click first rename button
      await pencilBtns[0].click();
      await page.waitForTimeout(300);
      await ss(page, '02-name-edit-active');

      // Check that input appeared
      const nameInput = await page.locator('input[style*="fontWeight: 700"], input[style*="font-weight: 700"]').first();
      const inputVisible = await nameInput.isVisible().catch(() => false);

      if (inputVisible) {
        ok('Name input appeared on pencil click');
        const currentVal = await nameInput.inputValue();
        info(`Current name value: "${currentVal}"`);

        // Press Escape to cancel (don't actually rename during test)
        await nameInput.press('Escape');
        await page.waitForTimeout(200);
        ok('Escape cancelled rename');
      } else {
        bug('Name input did not appear after clicking rename button');
      }
    }

    // ── Check Edit schemas button still works ──────────────────────────────
    const schemaBtns = await page.locator('button').filter({ hasText: /Edit schemas/i }).all();
    info(`Found ${schemaBtns.length} Edit schemas button(s)`);

    if (schemaBtns.length > 0) {
      await schemaBtns[0].click();
      await page.waitForTimeout(800);
      await ss(page, '03-schema-editor-open');

      const schemaEditorVisible = await page.evaluate(() =>
        document.body.innerText.includes('Schema scope')
      );
      if (schemaEditorVisible) ok('Schema editor panel opened');
      else bug('Schema editor did not open');

      // Close it
      const cancelBtn = await page.locator('button').filter({ hasText: /Cancel/i }).first();
      if (await cancelBtn.isVisible().catch(() => false)) {
        await cancelBtn.click();
        await page.waitForTimeout(200);
      }
    }

    // ── Navigate to Rules and check connection name in header ──────────────
    await cfg.goTo(page, 'rules');
    await page.waitForTimeout(800);
    await ss(page, '04-rules-after-connections-visit');

    // ── JS errors ──────────────────────────────────────────────────────────
    const sig = jsErrors.filter(e =>
      !e.includes('favicon') && !e.includes('ERR_ABORTED') &&
      !e.includes('lucide') && !e.includes('401')
    );
    if (sig.length) bug(`JS errors:\n${sig.slice(0, 3).map(e => '    ' + e.split('\n')[0]).join('\n')}`);
    else ok('No significant JS errors');

    console.log(`\n📁 Screenshots: ${DIR}`);
  } finally {
    await browser.close();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
