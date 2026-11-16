import { defineConfig, devices } from '@playwright/test'

// The accessibility + console sweep (docs/night-shift/jobs/sweep.md).
//
// Separate config from the critical-path suite so it can point at the
// night-shift dev server on :3600 instead of the owner's :3000. No `webServer`
// block: this config never starts a server (the runner starts one on :3600 and
// cognito-local on :9230; the main config starts :3000, which may be the
// owner's). The spec measures findings rather than asserting on them, so a
// clean run means "every page loaded" — a finding is a number, not a failure.
//
// Run: pnpm --filter web exec playwright test -c e2e/sweep/playwright.config.ts --reporter=list

const isCi = !!process.env.CI

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  // A page that hangs on networkidle shouldn't sink the whole sweep; 60s is
  // long enough for the slowest route to settle.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  reporter: isCi ? [['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3600',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
