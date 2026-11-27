import { defineConfig } from '@playwright/test';
import { env } from './src/config/env';

/**
 * API tests only: no browser is launched.
 * Tags (in test titles via { tag }): @smoke @p0 @money @security @contract @mock-only
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,
  retries: 0, // a retried money test hides real bugs. Flaky tests get fixed or quarantined, not retried.
  timeout: env.isMock ? 30_000 : 120_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [['list'], ['junit', { outputFile: 'test-results/junit.xml' }], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: { baseURL: env.baseURL },
  webServer: env.isMock
    ? {
        command: 'npx tsx mock-server/server.ts',
        url: `http://localhost:${env.mockPort}/health`,
        reuseExistingServer: !process.env.CI,
        stdout: 'ignore',
      }
    : undefined,
});
