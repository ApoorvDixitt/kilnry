// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('@smoke AS-01 first run creates a protected local account and Library', async ({
  browser,
  page,
  request,
}) => {
  const root = process.cwd();
  const dataDir = join(root, '.dev', 'e2e-data');
  const library = join(root, '.dev', 'e2e-library');
  const token = readFileSync(join(dataDir, 'first-run.token'), 'utf8').trim();

  const rejectedHost = await request.get('/api/health', { headers: { Host: 'attacker.example' } });
  expect(rejectedHost.status()).toBe(421);

  await page.goto(`/welcome?t=${token}`);
  await expect(page).toHaveURL('/welcome');
  await expect(page.getByRole('heading', { name: 'Create your local account' })).toBeVisible();
  const welcomeAccessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(welcomeAccessibility.violations).toEqual([]);
  await page.getByLabel('Email').fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Kilnry-local-test-42!');
  await page.getByLabel('Confirm password').fill('Kilnry-local-test-42!');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Where should your work live?' })).toBeVisible();
  await page.getByLabel('Library folder').fill(library);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your studio is ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Kilnry' }).click();
  await expect(page).toHaveURL('/create');
  await expect(page.getByRole('heading', { name: 'Create', exact: true })).toBeVisible();

  expect(existsSync(join(library, '.kilnry', 'library.json'))).toBe(true);
  expect(existsSync(join(library, 'inbox'))).toBe(true);
  expect(existsSync(join(library, 'Trash'))).toBe(true);
  expect(existsSync(join(dataDir, 'first-run.token'))).toBe(false);

  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  await page.screenshot({ path: join(root, 'test-results', 'm1-create-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(() =>
      page.getByRole('link', { name: 'Library' }).evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(238, 242, 240)');
  await page.screenshot({ path: join(root, 'test-results', 'm1-create-dark.png'), fullPage: true });

  const privateContext = await browser.newContext();
  const privatePage = await privateContext.newPage();
  await privatePage.goto('http://127.0.0.1:3123/create');
  await expect(privatePage).toHaveURL(/\/login$/);
  await privatePage.getByLabel('Email').fill('owner@example.test');
  await privatePage.getByLabel('Password').fill('Kilnry-local-test-42!');
  await privatePage.getByRole('button', { name: 'Sign in' }).click();
  await expect(privatePage).toHaveURL(/\/create$/);
  await privateContext.close();
});
