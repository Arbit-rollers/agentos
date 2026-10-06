import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // The suite runs against `next dev`, which compiles each route on first visit.
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
