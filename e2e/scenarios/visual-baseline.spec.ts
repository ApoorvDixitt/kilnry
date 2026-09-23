// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The visual regression check (@visual). It renders the real Create, Library,
// Characters, Chat and Presets screens in light and dark at 1440x900 and
// COMPARES each against a committed baseline with toHaveScreenshot, so a layout,
// spacing, colour or typography change fails the check instead of silently
// overwriting the picture. Dynamic regions (asset thumbnails, ids, times) are
// masked so only the chrome is compared. This check is tagged @visual and runs
// locally only — it is not in the continuous-integration grep — because the
// pixel baselines are platform-specific; regenerate them with
// `pnpm e2e --grep @visual --update-snapshots`.

import { expect, test, type Locator, type Page } from '@playwright/test';

const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
const COMPARE = { maxDiffPixelRatio: 0.02, animations: 'disabled' as const };

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

// The regions that legitimately vary between runs — asset thumbnails and any
// monospaced ids or timestamps — are masked so the comparison sees only chrome.
function masks(page: Page): Locator[] {
  return [page.locator('.asset-tile-wrap'), page.locator('.mono')];
}

test('@visual Create, Library, Characters, Chat and Presets match the baseline', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const screens: Array<{ path: string; heading?: string }> = [
    { path: '/create', heading: 'Create' },
    { path: '/library', heading: 'Library' },
    { path: '/characters' },
    { path: '/chat' },
    { path: '/presets' },
  ];

  for (const screen of screens) {
    const slug = screen.path.replace('/', '');
    for (const theme of ['light', 'dark'] as const) {
      await ensureSignedIn(page, screen.path);
      await setTheme(page, theme);
      await page.reload();
      if (screen.heading) {
        await expect(page.getByRole('heading', { name: screen.heading, exact: true })).toBeVisible();
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // A short settle lets fonts and any entrance motion finish before the pixel
      // compare; the comparison itself is deterministic.
      await page.waitForTimeout(400);
      await expect(page).toHaveScreenshot(`${slug}-${theme}.png`, { ...COMPARE, mask: masks(page) });
    }
  }
});
