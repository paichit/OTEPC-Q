import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false,
  // Multi-display tests already open several pages; avoid competing Chrome suites on Windows.
  workers: process.platform === 'win32' ? 1 : undefined,
  use: { baseURL: 'http://localhost:5187', browserName: 'chromium', channel: 'chrome', headless: true },
  webServer: { command: 'npm run dev -- --port 5187 --strictPort', url: 'http://localhost:5187', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://queue-test.supabase.co', VITE_SUPABASE_ANON_KEY: 'test-public-key' } },
});
