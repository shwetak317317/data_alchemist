/**
 * Rule Studio UI Test
 * 1. Screenshots all Rule Studio states
 * 2. Validates "Generate All" progressive display
 * 3. Checks for layout / text overlap issues
 */

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');
const cfg  = require('./config');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', 'rules-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
function ss(page, name) {
  if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const p = path.join(SCREENSHOTS_DIR, `${name}.png`);
  return page.screenshot({ path: p, fullPage: false }).then(() => console.log(`  📸 ${name}.png`));
}

function ok(msg)  { console.log(`  ✅ ${msg}`); }
function bug(msg) { console.log(`  ❌ BUG: ${msg}`); }
function info(msg){ console.log(`  ℹ️  ${msg}`); }

async function run() {
  await cfg.checkAppHealth();
  const { browser, page } = await cfg.launchBrowser({ chromium }, { headless: false, slowMo: 60 });
  const jsErrors = cfg.collectJsErrors(page);

  try {
    await cfg.login(page);
    await cfg.goTo(page, 'rules');
    await page.waitForTimeout(1500);
    await ss(page, '01-rule-studio-initial');

    // ── Inspect sidebar ──────────────────────────────────────────────────────
    const sidebarText = await page.locator('body').innerText();
    info(`Page has "Rule Studio": ${sidebarText.includes('Rule Studio')}`);

    // Count sidebar tables
    const tableCount = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.filter(b => {
        const style = b.getAttribute('style') || '';
        return b.innerText && b.innerText.length < 50 && !b.innerText.includes('Generate');
      }).length;
    });
    info(`Sidebar-ish button count: ${tableCount}`);

    // ── Click first profiled table ───────────────────────────────────────────
    const firstGenBtn = await page.locator('button').filter({ hasText: /Generate/ }).first();
    const hasGenBtn = await firstGenBtn.isVisible().catch(() => false);

    if (hasGenBtn) {
      // Get the table this generate belongs to - click its parent table button first
      info('Found Generate button — clicking the table above it first');

      // Find sidebar table buttons (not Generate buttons)
      const tableBtns = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('button'));
        return all
          .filter(b => b.innerText && b.innerText.trim().length > 0 &&
                       !b.innerText.includes('Generate') &&
                       !b.innerText.includes('All tables') &&
                       !b.innerText.includes('Run') &&
                       !b.innerText.includes('Bulk') &&
                       !b.innerText.includes('Convert') &&
                       !b.innerText.includes('Activate'))
          .slice(0, 6)
          .map(b => b.innerText.trim());
      });
      info(`Sidebar buttons found: ${JSON.stringify(tableBtns)}`);

      // Click the first available Generate button
      await firstGenBtn.click();
      info('Clicked Generate on first profiled table');
      await ss(page, '02-after-generate-click');

      // Wait up to 60s for rules to appear
      info('Waiting for rules to generate (up to 60s)…');
      const ruleAppeared = await page.waitForFunction(() => {
        const body = document.body.innerText;
        // Look for rule patterns: rule names, expressions, severity levels
        return body.includes('CRITICAL') || body.includes('HIGH') ||
               body.includes('MEDIUM') || body.includes('LOW') ||
               body.includes('NULL_CHECK') || body.includes('RANGE') ||
               body.includes('FORMAT') || document.querySelectorAll('[style*="green-50"]').length > 0;
      }, { timeout: 60000 }).catch(() => null);

      if (ruleAppeared) {
        ok('Rules appeared after generate');
        await ss(page, '03-rules-generated-success');
      } else {
        bug('Rules did NOT appear within 60s after generate');
        await ss(page, '03-rules-not-generated');
      }
    } else {
      info('No Generate buttons visible — either no profiled tables or already generated');
      await ss(page, '02-no-generate-buttons');
    }

    // ── Check rule card layout ───────────────────────────────────────────────
    // Look for any visible rule cards
    await page.waitForTimeout(500);
    await ss(page, '04-rule-list-view');

    const layoutCheck = await page.evaluate(() => {
      const issues = [];
      // Check for text overflow in rule cards
      document.querySelectorAll('[style*="font-family"][style*="monospace"], [style*="JetBrains"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && el.scrollWidth > el.offsetWidth + 5) {
          issues.push(`OVERFLOW: "${el.innerText?.slice(0, 60)}"`);
        }
      });
      // Check for overlapping elements - simplified: look for extremely narrow containers
      document.querySelectorAll('[style*="display: flex"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.width < 30 && el.innerText && el.innerText.trim().length > 5) {
          issues.push(`NARROW: "${el.innerText?.slice(0, 40)}" (width: ${Math.round(rect.width)}px)`);
        }
      });
      return issues;
    });

    if (layoutCheck.length > 0) {
      bug(`Layout issues found:\n${layoutCheck.map(i => '    ' + i).join('\n')}`);
    } else {
      ok('No obvious overflow/layout issues detected');
    }

    // ── Check NL converter section ───────────────────────────────────────────
    // Scroll to bottom to see NL section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    await ss(page, '05-nl-converter-section');

    // Trigger NL generation with default text
    const convertBtn = await page.locator('button').filter({ hasText: /Convert to rule/ }).first();
    const hasConvert = await convertBtn.isVisible().catch(() => false);
    if (hasConvert) {
      await convertBtn.click();
      info('Clicked Convert to rule');
      await page.waitForTimeout(8000);
      await ss(page, '06-nl-generated-result');

      // Check if generated rule card is visible and well-laid-out
      const genResult = await page.evaluate(() => {
        const body = document.body.innerText;
        return {
          hasRuleName: body.includes('Rule name') || body.includes('rule_name'),
          hasExpression: body.includes('Expression') || body.includes('expression'),
          hasSeverity: body.includes('Severity'),
          hasApproveBtn: Array.from(document.querySelectorAll('button')).some(b => b.innerText?.includes('Approve')),
        };
      });
      info(`Generated rule card: ${JSON.stringify(genResult)}`);

      if (genResult.hasRuleName && genResult.hasExpression) {
        ok('NL → rule card rendered correctly');
      } else {
        bug('NL → rule card missing expected fields');
      }
      await ss(page, '06-nl-result-detail');
    }

    // ── Scroll back to top and take final full screenshot ────────────────────
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await ss(page, '07-final-state');

    // ── JS Error report ──────────────────────────────────────────────────────
    const significant = jsErrors.filter(e =>
      !e.includes('favicon') && !e.includes('net::ERR_ABORTED') &&
      !e.includes('lucide') && !e.includes('401') &&
      !e.includes('Encountered two children')
    );
    if (significant.length > 0) {
      bug(`JS errors:\n${significant.slice(0, 5).map(e => '    ' + e.split('\n')[0]).join('\n')}`);
    } else {
      ok('No significant JS errors');
    }

    console.log(`\n📁 Screenshots saved to: ${SCREENSHOTS_DIR}`);

  } finally {
    await browser.close();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
