import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  timeout: 60_000,
  retries: 1,
  // The lineage-*.spec.ts and scenario-simulator.spec.ts files all pin to and
  // mutate the SAME shared "My Connection demo" fixture (create/delete edges,
  // toggle health status, etc.) and restore it afterward. Running spec files
  // across workers in parallel lets one test's mutation land mid another
  // test's before/after diff, corrupting both — and the extra concurrent
  // logins/reloads were also blowing past the per-test timeout under load.
  // Serializing is a correctness requirement here, not just a speed knob.
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: 'http://localhost',
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'chromium', use: { channel: 'chrome' } },
  ],
});
