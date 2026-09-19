// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('@smoke @m3 S-01 AS-01 first run creates a protected local account and Library', async ({
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
  expect(rejectedHost.headers()['x-request-id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  const rejectedOrigin = await request.post('/api/estimate', {
    headers: { Host: '127.0.0.1:3123', Origin: 'https://attacker.example' },
    data: { kind: 'image', prompt: 'blocked cross-origin request', model: 'auto' },
  });
  expect(rejectedOrigin.status()).toBe(403);

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
    const requestBody = JSON.stringify({ kind: 'image', prompt: 'zero egress check', model: 'auto' });
    const missingCsrf = await fetch('/api/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });
    const csrf = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('kilnry_csrf='))
      ?.slice('kilnry_csrf='.length);
    const response = await fetch('/api/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': decodeURIComponent(csrf ?? '') },
      body: requestBody,
    });
    return { missing_csrf: missingCsrf.status, no_provider: response.status };
  });
  expect(noProviderStatus).toEqual({ missing_csrf: 403, no_provider: 424 });
  await page.getByRole('button', { name: 'Try the demo with a free Pollinations key' }).click();
  await expect(page.getByText('Free Pollinations image demo')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Pollinations free keys' })).toHaveAttribute(
    'href',
    'https://enter.pollinations.ai/keys',
  );
  const providerKey = ['sk-or-v1-', '0'.repeat(64)].join('');
  await page.getByLabel('Provider key').fill(providerKey);
  await expect(page.getByText('openrouter detected', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Test and save key' }).click();
  await expect(page.getByText(/Connected · \d+ ms/)).toBeVisible();
  const onboardingKit =
    (await page.locator('.onboarding-recovery code').textContent())?.replace(/[\s-]/g, '') ?? '';
  const onboardingGroups = onboardingKit.slice('kilnry1'.length).match(/.{1,4}/g) ?? [];
  const onboardingConfirmation = page.locator('.onboarding-recovery .recovery-proof-fields label');
  for (let index = 0; index < (await onboardingConfirmation.count()); index += 1) {
    const label = onboardingConfirmation.nth(index);
    const group = Number(/group (\d+)/i.exec((await label.textContent()) ?? '')?.[1]);
    await label.locator('input').fill(onboardingGroups[group - 1] ?? '');
  }
  await page.getByRole('button', { name: "I've stored it safely" }).click();
  await expect(page.locator('.onboarding-recovery')).toHaveCount(0);
  const providerTestStatuses = await page.evaluate(async () => {
    const csrf = decodeURIComponent(
      document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('kilnry_csrf='))
        ?.slice('kilnry_csrf='.length) ?? '',
    );
    const statuses: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      statuses.push(
        (
          await fetch('/api/providers/openrouter/test', {
            method: 'POST',
            headers: { 'X-Kilnry-CSRF': csrf },
          })
        ).status,
      );
    }
    return statuses;
  });
  expect(providerTestStatuses.slice(0, 20).every((status) => status === 200)).toBe(true);
  expect(providerTestStatuses[20]).toBe(429);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your studio is ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Kilnry' }).click();
  await expect(page).toHaveURL('/create');
  await expect(page.getByRole('heading', { name: 'Create', exact: true })).toBeVisible();

  expect(existsSync(join(library, '.kilnry', 'library.json'))).toBe(true);
  expect(existsSync(join(library, 'inbox'))).toBe(true);
  expect(existsSync(join(library, 'Trash'))).toBe(true);
  expect(existsSync(join(dataDir, 'first-run.token'))).toBe(false);

  await page
    .getByRole('textbox', { name: 'Describe what you want to make…' })
    .fill('a small ceramic kiln arch on warm handmade paper, soft studio light');
  await expect(page.locator('.cost-strip .cost-strip-figure')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText(/^Saved · \$/)).toBeVisible({ timeout: 15_000 });
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
  expect(await page.evaluate(async () => (await fetch('/api/preview/not-an-id')).status)).toBe(400);

  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  await page.screenshot({ path: join(root, 'test-results', 'm1-create-light.png'), fullPage: true });
  await page.goto('/settings/security');
  await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'LAN access' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Signed-in sessions' })).toBeVisible();
  await expect(page.getByText('This browser')).toBeVisible();
  const invalidRecoveryStatus = await page.evaluate(async () => {
    const csrf = decodeURIComponent(
      document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('kilnry_csrf='))
        ?.slice('kilnry_csrf='.length) ?? '',
    );
    return (
      await fetch('/api/security/key-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': csrf },
        body: JSON.stringify({
          action: 'acknowledge',
          challenge_token: 'invalid-recovery-challenge',
          answers: [
            { group: 1, value: 'aaaa' },
            { group: 2, value: 'bbbb' },
          ],
        }),
      })
    ).status;
  });
  expect(invalidRecoveryStatus).toBe(400);
  await page.getByLabel('Current password', { exact: true }).fill('Kilnry-local-test-42!');
  await page.getByRole('button', { name: 'View recovery kit' }).click();
  await expect(page.locator('.recovery-card code')).toContainText('kilnry1');
  const recoveryKit = (await page.locator('.recovery-card code').textContent())?.replace(/[\s-]/g, '') ?? '';
  const recoveryGroups = recoveryKit.slice('kilnry1'.length).match(/.{1,4}/g) ?? [];
  const confirmationLabels = page.locator('.recovery-confirm label');
  for (let index = 0; index < (await confirmationLabels.count()); index += 1) {
    const label = confirmationLabels.nth(index);
    const group = Number(/group (\d+)/i.exec((await label.textContent()) ?? '')?.[1]);
    await label.locator('input').fill(recoveryGroups[group - 1] ?? '');
  }
  await page.getByRole('button', { name: "I've stored it safely" }).click();
  await expect(page.locator('.recovery-card code')).toHaveCount(0);
  await page.screenshot({ path: join(root, 'test-results', 'm2-security-light.png'), fullPage: true });
  await page.goto('/settings/providers');
  await expect(page.getByRole('heading', { name: 'Providers', exact: true })).toBeVisible();
  const openRouterCard = page.locator('.provider-card').filter({ hasText: 'OpenRouter' });
  await expect(openRouterCard).toContainText('Connected');
  await openRouterCard.getByLabel('Monthly cap (USD)').fill('25');
  await openRouterCard.getByLabel('Concurrency').fill('2');
  await openRouterCard.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByText(/Provider limits saved/)).toBeVisible();
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
  await page.goto('/settings/security');
  await expect(page.getByText('This browser')).toBeVisible();
  await expect(page.getByText(/master key source: (?!not initialized)/)).toBeVisible();
  await page.screenshot({ path: join(root, 'test-results', 'm2-security-dark.png'), fullPage: true });
  await page.goto('/settings/providers');
  await page.getByLabel('Add or replace a provider key').fill(`sk_${'p'.repeat(32)}`);
  await page.getByLabel('Provider', { exact: true }).selectOption('pollinations');
  await page.getByRole('button', { name: 'Test and save' }).click();
  const pollinationsCard = page.locator('.provider-card').filter({ hasText: 'Pollinations' });
  await expect(pollinationsCard).toContainText('Connected');
  await openRouterCard.getByRole('button', { name: 'Remove' }).click();
  await expect(openRouterCard).toContainText('Not connected');
  await page.goto('/create');
  await expect(page.getByRole('heading', { name: 'Create', exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Describe what you want to make…' })
    .fill('a paper crane on a windowsill at dawn');
  await expect(page.locator('.cost-strip .cost-strip-figure')).toContainText('$0.00', {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText(/^Saved · \$/)).toBeVisible({ timeout: 15_000 });
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

  await page.goto('/settings/appearance');
  await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /Compact/ }).check();
  await page.getByRole('radio', { name: /Always reduce/ }).check();
  await page.getByRole('radio', { name: /Light/ }).check();
  await expect(page.getByRole('status')).toContainText('Appearance saved.');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(page.getByRole('radio', { name: /Compact/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Always reduce/ })).toBeChecked();
  expect(JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8'))).toMatchObject({
    theme: 'light',
    density: 'compact',
    reduced_motion: 'reduce',
  });
});
