---
name: data-engineer-stakeholder-review
description: >
  Use when reviewing any module of a fullstack application using Playwright
  full-page screenshots as the primary evidence source. Drives a screenshot-first
  Senior Data Engineer review loop: authenticate from test/config, capture every
  module state and edge case, then apply 15-year DE stakeholder analysis to every
  input/output/logic/display problem found. Activates for: module review, feature
  validation, UI accuracy audits, edge case testing, data correctness reviews,
  or any "show me what's wrong with this" task. Run before declaring any module done.
---

# Playwright Screenshot-Driven Senior DE Review Skill

You are a 15-year Senior Data Engineer running a structured, screenshot-first audit
of a module. Every claim about correctness must be backed by a screenshot or a DB
query result. You trust nothing that isn't captured as evidence.

The loop:
```
READ TEST CONFIG → LOGIN → SCREENSHOT ALL STATES → APPLY DE REVIEW →
FIND BUGS → SCREENSHOT EDGE CASES → RE-REVIEW → FIX → RE-SCREENSHOT → REPEAT
until the module is production-grade with zero open P0/P1 findings.
```

---

## 0 · Before Writing a Single Test

### Step 0a — Read Test Config for Credentials

ALWAYS start here. Never hardcode credentials. Never assume defaults.

```typescript
// tests/config.ts  ← read this file first
// Typical structure — adapt to what's actually in the file:
export const TEST_CONFIG = {
  baseURL: process.env.BASE_URL || 'http://localhost:3000',
  auth: {
    email:    process.env.TEST_EMAIL    || 'admin@test.com',
    password: process.env.TEST_PASSWORD || 'testpass123',
  },
  connections: {
    primary:   process.env.TEST_CONNECTION_A || 'conn-001',
    secondary: process.env.TEST_CONNECTION_B || 'conn-002',
  },
  timeouts: {
    navigation: 15_000,
    dataLoad:   10_000,
    aiResponse: 30_000,
  },
};
```

```typescript
// tests/helpers/auth.ts  — reusable login helper
import { Page } from '@playwright/test';
import { TEST_CONFIG } from '../config';

export async function loginAs(page: Page, role: 'admin' | 'viewer' | 'editor' = 'admin') {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(TEST_CONFIG.auth[role]?.email ?? TEST_CONFIG.auth.email);
  await page.getByLabel(/password/i).fill(TEST_CONFIG.auth[role]?.password ?? TEST_CONFIG.auth.password);
  await page.getByRole('button', { name: /sign in|log in|submit/i }).click();
  await page.waitForURL(/dashboard|home|workspace/);
  // Screenshot: confirm logged in state
  await page.screenshot({ path: `screenshots/auth/login-${role}-${Date.now()}.png`, fullPage: true });
}
```

### Step 0b — Discover All States for the Module

Before writing any assertion, list every visual state this module can be in:

```
STATE INVENTORY for <ModuleName>:
  1. Loading state       — data is being fetched
  2. Populated state     — normal data present
  3. Empty state         — no data for this connection/filter
  4. Error state         — API failed or network down
  5. Single record state — exactly one item
  6. Large dataset state — 100+ items (pagination, scroll)
  7. Permission states   — viewer vs editor vs admin sees different UI
  8. Connection A state  — data for connection A
  9. Connection B state  — data for connection B (must visibly differ)
 10. Filtered state      — search/filter applied
 11. Stale/offline state — last-known data shown while refetching
```

Screenshot EVERY state. A state you didn't screenshot isn't reviewed.

---

## 1 · Screenshot Capture Protocol

### 1a — Full-Page Screenshot Standards

```typescript
import { test, expect, Page } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { TEST_CONFIG } from './config';

// Every screenshot call:
async function capture(page: Page, label: string) {
  const ts = Date.now();
  const path = `screenshots/${label.replace(/[^a-z0-9-]/gi, '_')}_${ts}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`[SCREENSHOT] ${label} → ${path}`);
  return path;
}
```

Take screenshots at these moments — no exceptions:

| Moment | Label Pattern | Why |
|---|---|---|
| Right after page load | `<module>-loaded` | Baseline state |
| While data is loading | `<module>-loading` | Verify skeleton/spinner |
| After data renders | `<module>-populated` | Main review target |
| After each user action | `<module>-after-<action>` | Verify state change |
| After connection switch | `<module>-conn-<A/B>` | Isolation verification |
| After applying filter | `<module>-filtered-<term>` | Filter behavior |
| After triggering error | `<module>-error-state` | Error handling |
| After each edge case | `<module>-edge-<case>` | Edge case evidence |
| Final clean state | `screenshots/final/<module>-<ts>.png` | Production sign-off |

### 1b — Annotated Screenshot Review Pattern

After capturing, examine each screenshot for these visual bugs:

```typescript
// What to look for in each screenshot:
const SCREENSHOT_REVIEW_CHECKLIST = [
  '[object Object]',    // Unrendered JS object
  'undefined',          // Unresolved variable
  'NaN',                // Failed numeric computation
  'null',               // Unhandled null displayed raw
  'Error:',             // Stack trace leaked to UI
  'Loading...',         // Spinner that never resolved
  '$0.00 vs $0.00',     // Both sides of a comparison are zero/default
  '0 of 0',            // Empty pagination — real data exists?
  '—  —  —',           // Dash placeholders where values should be
  'N/A  N/A  N/A',     // All N/A in a row — likely null propagation
];
```

---

## 2 · Module Feature Sweep

For the target module, capture a screenshot for EVERY feature, not just the main view:

```typescript
async function fullModuleFeatureSweep(page: Page, module: string) {
  // 1. Primary view
  await page.goto(`/${module}`);
  await page.waitForLoadState('networkidle');
  await capture(page, `${module}-primary-view`);

  // 2. Every tab / sub-section
  const tabs = await page.getByRole('tab').all();
  for (const tab of tabs) {
    const tabName = await tab.textContent();
    await tab.click();
    await page.waitForLoadState('networkidle');
    await capture(page, `${module}-tab-${tabName?.trim()}`);
  }

  // 3. Every expandable / accordion / detail panel
  const expandables = await page.getByRole('button', { name: /expand|show|view details|more/i }).all();
  for (let i = 0; i < expandables.length; i++) {
    await expandables[i].click();
    await page.waitForTimeout(500); // only acceptable use of waitForTimeout — animation settle
    await capture(page, `${module}-expanded-panel-${i}`);
    await expandables[i].click(); // collapse before next
  }

  // 4. Every modal / drawer
  const triggers = await page.getByRole('button', { name: /add|create|edit|configure|settings/i }).all();
  for (let i = 0; i < triggers.length; i++) {
    await triggers[i].click();
    await page.waitForSelector('[role="dialog"], [role="complementary"]', { timeout: 5_000 }).catch(() => null);
    await capture(page, `${module}-modal-${i}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // 5. Scroll to bottom — check if any lazy-loaded content or footer data exists
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await capture(page, `${module}-bottom-scroll`);
  await page.evaluate(() => window.scrollTo(0, 0));
}
```

---

## 3 · Edge Case Test Battery

Run ALL of these for every module. Document each with a screenshot.

### 3a — Data Edge Cases

```typescript
test.describe(`[EDGE] ${MODULE} — Data Conditions`, () => {

  test('empty state — no data for this connection', async ({ page }) => {
    await loginAs(page);
    // Switch to a connection with no data
    await switchConnection(page, TEST_CONFIG.connections.empty ?? 'conn-empty');
    await page.goto(`/${MODULE}`);
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-empty-state`);
    // Assert: shows a real empty state message, not a blank div or spinner
    const emptyMsg = page.getByText(/no data|no records|nothing here|empty|get started/i);
    await expect(emptyMsg).toBeVisible({ timeout: 5_000 });
    // Assert: no spinner still spinning
    await expect(page.getByRole('progressbar')).not.toBeVisible();
    // Assert: no [object Object] / undefined / NaN visible
    const body = await page.textContent('body');
    expect(body).not.toMatch(/\[object Object\]|undefined|NaN/);
  });

  test('single record state', async ({ page }) => {
    await loginAs(page);
    await switchConnection(page, TEST_CONFIG.connections.single ?? 'conn-single');
    await page.goto(`/${MODULE}`);
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-single-record`);
    // Verify: no pagination controls, layout doesn't break with 1 item
    await expect(page.getByRole('table') ?? page.locator('.list-container')).toBeVisible();
  });

  test('large dataset — 100+ records', async ({ page }) => {
    await loginAs(page);
    await switchConnection(page, TEST_CONFIG.connections.large ?? 'conn-large');
    await page.goto(`/${MODULE}`);
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-large-dataset`);
    // Verify: pagination renders, page controls are correct
    // Verify: no layout overflow or broken table
    // Performance: page must load in < 5s
  });

  test('all-null fields — record with maximum missing data', async ({ page }) => {
    await loginAs(page);
    await page.goto(`/${MODULE}?debug_null_record=true`);
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-null-fields`);
    const body = await page.textContent('body');
    // UI must show "—" or "N/A" gracefully, NOT raw null/undefined/[object Object]
    expect(body).not.toMatch(/\bnull\b|\bundefined\b|\[object Object\]/);
  });

  test('zero-value fields — scores of 0, counts of 0, amounts of $0', async ({ page }) => {
    await loginAs(page);
    await switchConnection(page, TEST_CONFIG.connections.zeroes ?? 'conn-zeroes');
    await page.goto(`/${MODULE}`);
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-zero-values`);
    // 0 must look different from "no data" — both must be visible and distinct
  });

  test('maximum values — largest possible numbers/strings', async ({ page }) => {
    await loginAs(page);
    await page.goto(`/${MODULE}?debug_max_values=true`);
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-max-values`);
    // Verify: no layout overflow on very long text/numbers
    // Verify: truncation with tooltip, not clipping
  });

});
```

### 3b — Interaction Edge Cases

```typescript
test.describe(`[EDGE] ${MODULE} — Interactions`, () => {

  test('rapid connection switching — no stale data flash', async ({ page }) => {
    await loginAs(page);
    await page.goto(`/${MODULE}`);
    await page.waitForLoadState('networkidle');

    const valuesA: string[] = [];
    const valuesB: string[] = [];

    // Record Connection A values
    await switchConnection(page, TEST_CONFIG.connections.primary);
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-conn-A-before`);
    // Capture key metric values for comparison
    const metrics = await page.locator('[data-testid*="metric"], [data-testid*="score"], [data-testid*="count"]').all();
    for (const m of metrics) valuesA.push(await m.textContent() ?? '');

    // Switch to Connection B
    await switchConnection(page, TEST_CONFIG.connections.secondary);
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-conn-B`);
    for (const m of metrics) valuesB.push(await m.textContent() ?? '');

    // Values MUST differ between connections
    expect(valuesA).not.toEqual(valuesB);
    // If they're identical → static data leak — P0 bug

    // Switch back — values must restore
    await switchConnection(page, TEST_CONFIG.connections.primary);
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-conn-A-after`);
    const valuesARestored: string[] = [];
    for (const m of metrics) valuesARestored.push(await m.textContent() ?? '');
    expect(valuesA).toEqual(valuesARestored);
  });

  test('search / filter — returns accurate results', async ({ page }) => {
    await loginAs(page);
    await page.goto(`/${MODULE}`);
    await page.waitForLoadState('networkidle');
    const searchBox = page.getByRole('searchbox').or(page.getByPlaceholder(/search|filter/i));
    if (await searchBox.isVisible()) {
      // Test: known existing term → results appear
      await searchBox.fill('test');
      await page.waitForLoadState('networkidle');
      await capture(page, `${MODULE}-filter-existing-term`);
      // Test: non-existent term → real empty state
      await searchBox.fill('xyzzy_no_match_12345');
      await page.waitForLoadState('networkidle');
      await capture(page, `${MODULE}-filter-no-match`);
      const body = await page.textContent('body');
      expect(body).not.toMatch(/\[object Object\]|undefined|NaN/);
      // Clear filter → full results restore
      await searchBox.clear();
      await page.waitForLoadState('networkidle');
      await capture(page, `${MODULE}-filter-cleared`);
    }
  });

  test('sort columns — order changes, data integrity preserved', async ({ page }) => {
    await loginAs(page);
    await page.goto(`/${MODULE}`);
    await page.waitForLoadState('networkidle');
    const sortableHeaders = await page.getByRole('columnheader').all();
    for (const header of sortableHeaders.slice(0, 3)) { // test first 3 columns
      await header.click();
      await page.waitForLoadState('networkidle');
      await capture(page, `${MODULE}-sorted-asc`);
      await header.click(); // descending
      await page.waitForLoadState('networkidle');
      await capture(page, `${MODULE}-sorted-desc`);
    }
  });

  test('pagination — page 2 loads different records', async ({ page }) => {
    await loginAs(page);
    await switchConnection(page, TEST_CONFIG.connections.large ?? 'conn-large');
    await page.goto(`/${MODULE}`);
    await page.waitForLoadState('networkidle');
    const page2Btn = page.getByRole('button', { name: '2' }).or(page.getByLabel('next page'));
    if (await page2Btn.isVisible()) {
      const firstRowTextP1 = await page.locator('tbody tr:first-child').textContent();
      await page2Btn.click();
      await page.waitForLoadState('networkidle');
      await capture(page, `${MODULE}-page-2`);
      const firstRowTextP2 = await page.locator('tbody tr:first-child').textContent();
      // Page 2 must show different records
      expect(firstRowTextP1).not.toBe(firstRowTextP2);
    }
  });

});
```

### 3c — Error & Failure Edge Cases

```typescript
test.describe(`[EDGE] ${MODULE} — Failure Modes`, () => {

  test('API failure — UI shows friendly error, not blank/stack trace', async ({ page }) => {
    await loginAs(page);
    // Intercept and fail the main data endpoint
    await page.route(`**/api/${MODULE}**`, route => route.abort('failed'));
    await page.goto(`/${MODULE}`);
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-api-failure`);
    // Must show an error message, not a blank div
    const errorMsg = page.getByText(/error|failed|unavailable|try again|something went wrong/i);
    await expect(errorMsg).toBeVisible({ timeout: 5_000 });
    // Must NOT show a stack trace
    const body = await page.textContent('body');
    expect(body).not.toMatch(/at Object\.|\.js:\d+:\d+|Traceback|Error:/);
  });

  test('slow API — shows loading state, not blank', async ({ page }) => {
    await loginAs(page);
    await page.route(`**/api/${MODULE}**`, async route => {
      await new Promise(r => setTimeout(r, 3000)); // simulate 3s delay
      await route.continue();
    });
    await page.goto(`/${MODULE}`);
    // Immediately screenshot — should show skeleton/spinner, not empty content
    await capture(page, `${MODULE}-slow-api-loading`);
    const spinner = page.getByRole('progressbar').or(page.locator('.skeleton, [data-loading]'));
    await expect(spinner).toBeVisible();
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-slow-api-resolved`);
  });

  test('invalid connection ID — graceful error, no crash', async ({ page }) => {
    await loginAs(page);
    await page.goto(`/${MODULE}?connection_id=invalid-id-does-not-exist`);
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-invalid-connection`);
    const body = await page.textContent('body');
    expect(body).not.toMatch(/\[object Object\]|undefined|NaN|500|Internal Server Error/);
  });

  test('session expiry — redirect to login, not broken page', async ({ page }) => {
    await loginAs(page);
    await page.goto(`/${MODULE}`);
    // Clear session cookies to simulate expiry
    await page.context().clearCookies();
    await page.reload();
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-session-expired`);
    // Should redirect to login
    await expect(page).toHaveURL(/login|auth|signin/);
  });

  test('permission denied — viewer cannot see admin features', async ({ page }) => {
    await loginAs(page, 'viewer');
    await page.goto(`/${MODULE}`);
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-viewer-role`);
    // Admin-only controls must not be visible
    await expect(page.getByRole('button', { name: /delete|admin|configure/i })).not.toBeVisible();
  });

});
```

### 3d — Data Accuracy Edge Cases

```typescript
test.describe(`[EDGE] ${MODULE} — Data Accuracy`, () => {

  test('spot-check: 5 records hand-verified against DB', async ({ page, request }) => {
    await loginAs(page);
    await page.goto(`/${MODULE}`);
    await page.waitForLoadState('networkidle');
    await capture(page, `${MODULE}-accuracy-spot-check`);

    // Fetch ground truth from API directly
    const apiData = await request.get(`/api/${MODULE}?connection_id=${TEST_CONFIG.connections.primary}`);
    const { data: dbRecords } = await apiData.json();

    // Pick 5 records to verify (first, last, middle, max-value, null-heavy)
    const recordsToVerify = [
      dbRecords[0],
      dbRecords[Math.floor(dbRecords.length / 2)],
      dbRecords[dbRecords.length - 1],
    ].filter(Boolean);

    for (const record of recordsToVerify) {
      // Find the record in the UI and verify key fields match DB
      const uiRow = page.getByText(record.id ?? record.name ?? '').first();
      if (await uiRow.isVisible()) {
        await uiRow.scrollIntoViewIfNeeded();
        await capture(page, `${MODULE}-record-verify-${record.id}`);
        // Specific field verification depends on the module — adapt:
        // expect(await uiRow.textContent()).toContain(String(record.score));
      }
    }
  });

  test('aggregate totals match sum of records', async ({ page, request }) => {
    await loginAs(page);
    await page.goto(`/${MODULE}`);
    await page.waitForLoadState('networkidle');

    // Get displayed aggregate (e.g., "Total: 47")
    const displayedTotal = await page.locator('[data-testid="total-count"]').textContent();

    // Get raw count from API
    const apiResp = await request.get(`/api/${MODULE}/count?connection_id=${TEST_CONFIG.connections.primary}`);
    const { count: apiTotal } = await apiResp.json();

    await capture(page, `${MODULE}-total-accuracy`);
    expect(parseInt(displayedTotal ?? '0')).toBe(apiTotal);
  });

  test('connection switch changes ALL metric values', async ({ page }) => {
    await loginAs(page);
    await page.goto(`/${MODULE}`);
    await page.waitForLoadState('networkidle');

    // Capture all text content for Connection A
    const textA = await page.locator('main').textContent();
    await capture(page, `${MODULE}-all-values-conn-A`);

    await switchConnection(page, TEST_CONFIG.connections.secondary);
    await page.waitForLoadState('networkidle');
    const textB = await page.locator('main').textContent();
    await capture(page, `${MODULE}-all-values-conn-B`);

    // At minimum some content must differ
    expect(textA).not.toBe(textB);
    // If IDENTICAL → every metric is static data → P0
  });

});
```

---

## 4 · Senior DE Review: Apply After Each Screenshot Batch

After capturing screenshots for a batch of states/edge cases, apply this review:

### 4a — Screenshot Triage

For each screenshot, scan and log every visible anomaly:

```
SCREENSHOT REVIEW LOG — <module> — <timestamp>

Screenshot: <path>
State: <what state this represents>
Anomalies found:
  □ [object Object] visible                → P0: unrendered JS object in template
  □ undefined visible                      → P0: unresolved variable in render
  □ NaN visible                            → P1: failed numeric computation
  □ null visible                           → P1: null not handled in template
  □ Spinner never resolved                 → P1: loading state stuck, no timeout
  □ Blank panel / white box               → P1: component mounted but not populated
  □ Error boundary message                 → P1: React/component crash, check console
  □ Zero where positive expected           → P1: default value showing, not real data
  □ All values identical across connections → P0: static data leak
  □ Wrong number vs DB ground truth       → P0: calculation/aggregation bug
  □ Missing element vs baseline screenshot → P1: regression — element removed or hidden
  □ Layout overflow / clipped content     → P2: responsive/overflow bug
  □ Stale data after connection switch    → P0: connection isolation failure
  □ No empty state message (blank instead)→ P2: missing empty state component
  □ Stack trace or raw error in UI        → P0: exception not caught at render level
  □ Tooltip shows wrong info              → P2: tooltip wired to wrong data
  □ Badge count doesn't match list count  → P1: badge reads different source than list
  □ Timestamp shows wrong timezone        → P1: timezone handling bug
  □ Delta shows 0 where change expected   → P1: delta calculation not working
```

### 4b — Apply the 13 Lenses to What the Screenshots Show

After triaging visuals, apply the full DE review for the module's logic:

```
LENS 1  HAPPY PATH        — Does the normal case screenshot look correct?
LENS 2  NULLS             — What did the null-fields screenshot reveal?
LENS 3  DUPLICATES        — Does row count in UI match DB? Any duplicated rows?
LENS 4  VOLUME            — Does the large-dataset screenshot show perf/layout issues?
LENS 5  BOUNDARIES        — Single-record and empty screenshots — layout hold up?
LENS 6  TEMPORAL          — Are timestamps shown correctly? UTC? DST-safe?
LENS 7  SCHEMA DRIFT      — Would adding a new field to the API break the UI?
LENS 8  JOINS/AGGREGATION — Do totals in the UI match hand-calculated DB totals?
LENS 9  AI OUTPUT         — Do AI-generated texts match underlying DB numbers?
LENS 10 IDEMPOTENCY       — Same data after refresh? After re-login?
LENS 11 SILENT FAILURES   — Which edge case screenshot showed no error but wrong data?
LENS 12 ISOLATION         — Do connection A/B screenshots show visibly distinct data?
LENS 13 OBSERVABILITY     — If a bug appears in these screenshots, what log shows why?
```

### 4c — Issue Filing (from Screenshot Evidence)

Every filed issue MUST include a screenshot reference:

```
## Finding: [P0|P1|P2|P3|P4] <Title>

**Screenshot evidence**: screenshots/<exact-filename>.png
**State when found**: <e.g., "connection switch", "empty state", "null-fields edge case">
**What the screenshot shows**: <precise description of the visible problem>
**Root cause hypothesis**: <why this is happening — input? transform? output? render?>
**Data flow location**: SOURCE → [TRANSFORM X] ← bug is here → OUTPUT
**Reproduce steps**:
  1. Login as <role>
  2. Navigate to <module>
  3. <specific action>
  4. Observe: <what you see>
  5. Expected: <what should appear>
**Fix recommendation**: <concrete, actionable>
**Re-verification**: re-screenshot after fix and attach here
```

---

## 5 · The Review Loop — Execution Steps

```
STEP 1: READ TEST CONFIG
  → Load tests/config.ts (or equivalent)
  → Extract: baseURL, credentials (all roles), connection IDs, timeouts

STEP 2: AUTHENTICATE
  → loginAs(page, 'admin') using config credentials
  → Screenshot: login success state
  → Verify: redirected to correct landing page

STEP 3: FULL MODULE FEATURE SWEEP
  → Run fullModuleFeatureSweep() — screenshot every tab, panel, modal, scroll depth
  → Screenshot count: aim for ≥15 screenshots covering every visible surface

STEP 4: ALL STATE SCREENSHOTS
  → Loading / Populated / Empty / Error / Single / Large / Null-fields /
    Zero-values / Max-values / Each Role (admin/viewer/editor)
  → Screenshot count: ≥10 state screenshots

STEP 5: CONNECTION ISOLATION TEST
  → Connection A screenshots → record all visible values
  → Connection B screenshots → assert values differ
  → Connection A restored → assert values identical to Step 5 baseline
  → Screenshot count: ≥6 screenshots

STEP 6: EDGE CASE BATTERY
  → Run all 3d edge case tests (API failure, slow API, invalid connection,
    session expiry, permission denied, spot-check accuracy, totals accuracy)
  → Screenshot count: ≥12 screenshots

STEP 7: SCREENSHOT TRIAGE
  → Apply 4a checklist to every screenshot
  → File every anomaly found with severity P0–P4

STEP 8: DE LENS REVIEW
  → Apply all 13 lenses to the module's data flow logic
  → File every logic/accuracy/architecture issue found

STEP 9: FIX ROUTING
  → P0: fix immediately, block everything else
  → P1: fix before re-review
  → P2: fix in current cycle
  → P3/P4: file and schedule

STEP 10: RE-SCREENSHOT AFTER FIXES
  → Re-run full screenshot suite for the affected states
  → Compare each screenshot against the pre-fix version
  → Verify: all filed issues resolved, no new issues introduced

STEP 11: REPEAT STEPS 7–10
  → Until: zero P0 and P1 findings remain, all 13 lenses pass

STEP 12: FINAL SCREENSHOT SET
  → Full clean run: capture screenshots/final/<module>-<timestamp>.png
  → Commit to repo
  → Sign off: "Module <name> reviewed and approved — <date>"
```

---

## 6 · Playwright Config Reference

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { TEST_CONFIG } from './tests/config';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  reporter: [
    ['html', { outputFolder: 'test-results/html' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
  ],
  use: {
    baseURL: TEST_CONFIG.baseURL,
    screenshot: 'on',              // capture on every test
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'chromium', use: { channel: 'chrome' } },
  ],
  // Screenshot output directory
  snapshotDir: './screenshots',
});
```

---

## 7 · Screenshot Folder Structure

```
screenshots/
  auth/
    login-admin-<ts>.png
    login-viewer-<ts>.png
  <module>/
    loaded-<ts>.png
    loading-<ts>.png
    populated-<ts>.png
    empty-state-<ts>.png
    error-state-<ts>.png
    single-record-<ts>.png
    large-dataset-<ts>.png
    null-fields-<ts>.png
    zero-values-<ts>.png
    max-values-<ts>.png
    conn-A-<ts>.png
    conn-B-<ts>.png
    conn-A-restored-<ts>.png
    filter-existing-<ts>.png
    filter-no-match-<ts>.png
    api-failure-<ts>.png
    slow-api-loading-<ts>.png
    session-expired-<ts>.png
    viewer-role-<ts>.png
    accuracy-spot-check-<ts>.png
    total-accuracy-<ts>.png
  edge-cases/
    <module>-<edge-case-name>-<ts>.png
  final/
    <module>-APPROVED-<ts>.png     ← committed only after zero P0/P1 findings
test-results/
  findings-<module>-<ts>.md        ← filed issues with screenshot references
  html/                            ← playwright HTML report
  results.json
```

---

## 8 · Quick-Reference: Must-Capture Screenshots per Module Pass

| # | Screenshot | Purpose |
|---|---|---|
| 1 | Login success | Auth works |
| 2 | Module primary loaded | Baseline |
| 3 | Module loading state | Skeleton/spinner visible |
| 4 | Module empty state | Empty state not blank |
| 5 | Module error state | Error not blank/stack trace |
| 6 | Module null-fields record | Nulls render gracefully |
| 7 | Module zero-values | 0 ≠ "no data" |
| 8 | Module large dataset | Pagination, no overflow |
| 9 | Connection A values | Baseline |
| 10 | Connection B values | Must differ from A |
| 11 | Connection A restored | Must match baseline |
| 12 | Search/filter result | Correct results |
| 13 | Search/filter no match | Real empty state |
| 14 | API failure state | Friendly error shown |
| 15 | Slow API loading | Spinner not blank |
| 16 | Viewer role | No admin controls |
| 17 | Spot-check record | Accuracy vs DB |
| 18 | Totals accuracy | Aggregate matches sum |
| 19 | Each tab/panel | Full feature coverage |
| 20 | Final clean state | Approval evidence |

Minimum 20 screenshots per module pass. Fewer = incomplete review.

---

## 9 · Anti-Rationalization

| Claim | Counter |
|---|---|
| "It looks fine to me" | Take the screenshot. Visual inspection without capture isn't evidence. |
| "Edge cases won't happen" | The null-fields test takes 2 minutes. Run it. |
| "We already tested that" | Show the screenshot with a timestamp from after the last fix. |
| "Connection isolation works" | Run the isolation test. If A and B show identical values, it doesn't. |
| "The error is handled" | Intercept the API and screenshot what actually renders. |
| "Login is out of scope" | Read the test config first. Always. Credentials are in there for a reason. |
| "I'll do the full sweep later" | The feature sweep is step 3, not optional. Run it now. |
| "That's a minor visual bug" | Minor visual bugs in production make the whole product look broken. File it. |