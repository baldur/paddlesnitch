import { defineConfig, devices } from '@playwright/test'

// Critical-path E2E tests with Playwright.
//
// Scope is deliberately narrow — 3-5 end-to-end scenarios that touch
// real cookies, real route handlers, real DOM. Permission-matrix
// coverage stays in vitest (src/lib/permissions.test.ts and the
// integration suites). E2E catches things the unit/integration layer
// can't: form interactions, navigation flows, redirect chains.
//
// `pnpm e2e` starts the dev stack (cognito-local + Next) if it isn't
// already running, then runs the suite headless. `pnpm e2e:ui` opens
// the Playwright UI mode for local debugging.

const isCi = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  // Serialise for now — tests share filesystem state (.local-data/ and
  // .cognito-local/) so parallel runs can race on unique-id collisions.
  // When we add explicit per-test cleanup we can enable parallel mode.
  fullyParallel: false,
  workers: 1,
  // 30 s default; long enough for the slowest "create course + click
  // through map" flow, short enough to fail fast on real hangs.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  reporter: isCi ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    // Always capture a trace on failure — debugging an E2E run without it
    // is nearly impossible. Trace cost is negligible on a few-test suite.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Auto-wait covers most flake; setting a short network-idle nudge
    // for SPA-style navigation prevents leaking work between steps.
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  webServer: {
    // `pnpm dev` orchestrates cognito-local + Next together. In CI we
    // always start fresh; locally we reuse whatever's already running
    // so the developer's existing dev server isn't restarted.
    command: 'pnpm dev',
    url: 'http://localhost:3000/att',
    reuseExistingServer: !isCi,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
