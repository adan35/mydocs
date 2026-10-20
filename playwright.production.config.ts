import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-production',
  timeout: 60_000,
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4175',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host localhost --port 4175 --strictPort',
    url: 'http://localhost:4175',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
