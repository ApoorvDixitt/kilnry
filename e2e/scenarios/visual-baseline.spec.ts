// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// The visual regression baseline. The glance PNGs shipped in the design package
// are hand-made mocks and the design target for inspection, not a pixel baseline.
// This test renders the real Create (light and dark) and Library (light) screens
// at 1440x900 and saves them under e2e/__snapshots__/ as the regression baseline
// for future milestones. A reviewer compares these renders against the glances
// for layout, spacing, colour usage and typography.

const root = process.cwd();
const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
const snap = (name: string): string => join(root, 'e2e', '__snapshots__', name);

async function ensureSignedIn(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (/\/login$/.test(page.url())) {
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !/\/login$/.test(url.pathname));
    await page.goto(path);
  }
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    localStorage.setItem('kilnry-theme', value);
    document.documentElement.dataset.themeSetting = value;
    document.documentElement.dataset.theme = value;
  }, theme);
}

test('@visual capture Create light and dark and Library light at 1440x900', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await ensureSignedIn(page, '/create');
  await expect(page.getByRole('heading', { name: 'Create', exact: true })).toBeVisible();
  await setTheme(page, 'light');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Create', exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: snap('create-light.png'), fullPage: false });

  await setTheme(page, 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(400);
  await page.screenshot({ path: snap('create-dark.png'), fullPage: false });

  await setTheme(page, 'light');
  await ensureSignedIn(page, '/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: snap('library-light.png'), fullPage: false });

  // The Characters screen light and dark, the baseline a reviewer compares
  // against glance-characters.png and glance-characters-dark.png (M4).
  await setTheme(page, 'light');
  await ensureSignedIn(page, '/characters');
  await page.waitForTimeout(400);
  await page.screenshot({ path: snap('characters-light.png'), fullPage: false });

  await setTheme(page, 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(400);
  await page.screenshot({ path: snap('characters-dark.png'), fullPage: false });

  // The Chat and Presets screens (M5), captured light and dark as the baseline a
  // reviewer compares against the wireframes and the style tile, since there is
  // no glance for either screen.
  await setTheme(page, 'light');
  await ensureSignedIn(page, '/chat');
  await page.waitForTimeout(400);
  await page.screenshot({ path: snap('chat-light.png'), fullPage: false });
  await setTheme(page, 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(400);
  await page.screenshot({ path: snap('chat-dark.png'), fullPage: false });

  await setTheme(page, 'light');
  await ensureSignedIn(page, '/presets');
  await page.waitForTimeout(400);
  await page.screenshot({ path: snap('presets-light.png'), fullPage: false });
  await setTheme(page, 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(400);
  await page.screenshot({ path: snap('presets-dark.png'), fullPage: false });
});
