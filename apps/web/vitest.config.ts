import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Exclude `e2e/` — those are Playwright specs, not vitest. Their
    // `test()` import comes from @playwright/test and throws when picked
    // up by vitest's runner.
    exclude: ['**/node_modules/**', '**/infra/**', '**/.open-next/**', '**/.next/**', 'e2e/**'],
    globalSetup: ['./src/tests/global-setup.ts'],
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
