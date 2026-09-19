// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

  await expect(page.getByRole('heading', { name: 'Add one key to generate for real' })).toBeVisible();
  const noProviderStatus = await page.evaluate(async () => {
    const response = await fetch('/api/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'image', prompt: 'zero egress check', model: 'auto' }),
    });
    return response.status;
  });
  expect(noProviderStatus).toBe(424);
  const providerKey = ['sk-or-v1-', '0'.repeat(64)].join('');
  await page.getByLabel('Provider key').fill(providerKey);
  await expect(page.getByText('openrouter detected', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Test and save key' }).click();
  await expect(page.getByText(/Connected · \d+ ms/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your studio is ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Kilnry' }).click();
  await expect(page).toHaveURL('/create');
  await expect(page.getByRole('heading', { name: 'Create', exact: true })).toBeVisible();

  expect(existsSync(join(library, '.kilnry', 'library.json'))).toBe(true);
  expect(existsSync(join(library, 'inbox'))).toBe(true);
  expect(existsSync(join(library, 'Trash'))).toBe(true);
  expect(existsSync(join(dataDir, 'first-run.token'))).toBe(false);

  await page.getByRole('button', { name: 'Auto · estimate route' }).click();
  await expect(page.getByText(/^≈ \$0\.\d{4}$/)).toBeVisible();
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText('Saved to the Library')).toBeVisible({ timeout: 15_000 });
  const files = readdirSync(join(library, 'inbox'));
  const image = files.find((file) => file.endsWith('.png'));
  expect(image).toBeDefined();
  expect(files).toContain(`${image}.kilnry.json`);
  const sidecar = JSON.parse(readFileSync(join(library, 'inbox', `${image}.kilnry.json`), 'utf8')) as {
    asset_id?: string;
    generation?: { provider?: string; actual_usd?: number };
    schema_version?: number;
  };
  expect(sidecar).toMatchObject({
    schema_version: 1,
    generation: { provider: 'openrouter', actual_usd: 0.014 },
  });
  const rangeStatus = await page.evaluate(async (assetId) => {
    const response = await fetch(`/api/media/${assetId}`, {
      headers: { Range: 'bytes=0-15' },
    });
    return {
      status: response.status,
      range: response.headers.get('content-range'),
      length: (await response.arrayBuffer()).byteLength,
    };
  }, sidecar.asset_id);
  expect(rangeStatus).toMatchObject({ status: 206, length: 16 });
  expect(rangeStatus.range).toMatch(/^bytes 0-15\//);

  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  await page.screenshot({ path: join(root, 'test-results', 'm1-create-light.png'), fullPage: true });
  await page.goto('/settings/security');
  await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible();
  await page.getByLabel('Current password').fill('Kilnry-local-test-42!');
  await page.getByRole('button', { name: 'View recovery kit' }).click();
  await expect(page.locator('.recovery-card code')).toContainText('kilnry1');
  await page.getByRole('button', { name: "I've stored it safely" }).click();
  await page.goto('/settings/providers');
  await expect(page.getByRole('heading', { name: 'Providers', exact: true })).toBeVisible();
  const openRouterCard = page.locator('.provider-card').filter({ hasText: 'OpenRouter' });
  await expect(openRouterCard).toContainText('Connected');
  await openRouterCard.getByRole('button', { name: 'Refresh prices' }).click();
  await expect(page.getByText(/Prices refreshed · \d+ models/)).toBeVisible();
  await expect(openRouterCard.getByRole('button', { name: 'Refresh prices' })).toBeEnabled();
  await page.locator('.route-stage').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: join(root, 'test-results', 'm2-providers-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(() =>
      page.getByRole('link', { name: 'Library' }).evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(238, 242, 240)');
  await page.screenshot({ path: join(root, 'test-results', 'm2-providers-dark.png'), fullPage: true });
  await page.goto('/create');
  await expect(page.getByRole('heading', { name: 'The M2 engine is ready' })).toBeVisible();
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
