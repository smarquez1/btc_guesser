import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  workers: 1,
  retries: 0,
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
});
