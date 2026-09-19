// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const root = process.cwd();

export default defineConfig({
  testDir: './scenarios',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 120_000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3123',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'tsx e2e/serve.ts',
    cwd: root,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    url: 'http://127.0.0.1:3123/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      KILNRY_DATA_DIR: join(root, '.dev', 'e2e-data'),
      KILNRY_LIBRARY_ROOT: join(root, '.dev', 'e2e-library'),
      KILNRY_HOST: '127.0.0.1',
      KILNRY_PORT: '3123',
      KILNRY_TEST_MSW: '1',
    },
  },
});
