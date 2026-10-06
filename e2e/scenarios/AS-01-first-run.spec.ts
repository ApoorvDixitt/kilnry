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
  const hostPort = '127.0.0.1:3123';
  const token = readFileSync(join(dataDir, 'first-run.token'), 'utf8').trim();

  const rejectedHost = await request.get('/api/health', { headers: { Host: 'attacker.example' } });
  expect(rejectedHost.status()).toBe(421);
  expect(rejectedHost.headers()['x-request-id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  const rejectedOrigin = await request.post('/api/estimate', {
    headers: { Host: hostPort, Origin: 'https://attacker.example' },
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

  // Continue creates the local account server-side — a password hash and the
  // first database writes — before the next step renders. On a loaded runner
  // that round-trip runs past Playwright's five-second default, which is the
  // real cause of the m5 shard's setup flake, not a fault in the flow. Wait for
  // the step the account creation gates rather than a shorter implicit timer.
  await expect(page.getByRole('heading', { name: 'Where should your work live?' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel('Library folder').fill(library);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Add one key to generate for real' })).toBeVisible({
    timeout: 30_000,
  });
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
  // PRD-04:163's own wording (F-55).
  await page.getByRole('button', { name: 'Try the demo (free Pollinations key)' }).click();
  await expect(page.getByText('Free Pollinations image demo')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Pollinations free keys' })).toHaveAttribute(
    'href',
    'https://enter.pollinations.ai/keys',
  );
  const providerKey = ['sk-or-v1-', '0'.repeat(64)].join('');
  await page.getByLabel('Provider key').fill(providerKey);
  // The provider's own spelling, not the lower-case id (DES-01 §6, F-55).
  await expect(page.getByText('OpenRouter detected', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Test and save key' }).click();
  await expect(page.getByText(/Connected · \d+ ms/)).toBeVisible({ timeout: 30_000 });
  // D-63: with the master key in the OS keychain there is no recovery-kit card
  // in onboarding at all — the kit is a Settings › Security flow behind the
  // password — and Continue is available as soon as the key is saved.
  await expect(page.locator('.onboarding-recovery')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  // F-14: a reload keeps the step usable, because the saved key is read from the
  // server rather than held in component state.
  await page.reload();
  await expect(page.getByText('openrouter is already connected', { exact: false })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
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
  // PRD-04:200 (F-50, UX-02): the final card carries the theme choice, and Open
  // Kilnry lands on Create with the provider-matched example prompt already in
  // the composer, in the matching mode — one click from the first Generate.
  await expect(page.locator('.ready-theme input[type="radio"]')).toHaveCount(3);
  await expect(page.locator('.ready-theme input[value="system"]')).toBeChecked();
  await page.locator('.ready-theme input[value="dark"]').check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.ready-theme input[value="system"]').check();
  await page.getByRole('button', { name: 'Open Kilnry' }).click();
  await expect(page).toHaveURL(/\/create\?/);
  await expect(page.getByRole('textbox', { name: 'Describe what you want to make…' })).toHaveValue(
    'A slow dolly-in on a chai glass on a marble counter, steam rising, morning light',
  );
  await expect(page.getByRole('tab', { name: 'Video' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Create', exact: true })).toBeVisible();
  // A fresh install has the $10.00 daily cap PRD-14 promises, and the top-bar
  // meter shows today's spend against it (F-08, F-17).
  await expect(page.locator('.budget-meter .budget-meter-text')).toHaveText('Today $0.00 / $10.00', {
    timeout: 15_000,
  });

  expect(existsSync(join(library, '.kilnry', 'library.json'))).toBe(true);
  expect(existsSync(join(library, 'inbox'))).toBe(true);
  expect(existsSync(join(library, 'Trash'))).toBe(true);
  expect(existsSync(join(dataDir, 'first-run.token'))).toBe(false);

  // The scripted start is a video prompt; this check goes on to make the first
  // image, so it switches mode the way the user would.
  await page.getByRole('tab', { name: 'Image' }).click();
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
        // The acknowledgement is one checkbox now (D-63); anything else is a
        // rejected body.
        body: JSON.stringify({ action: 'acknowledge', stored: false }),
      })
    ).status;
  });
  expect(invalidRecoveryStatus).toBe(400);
  await page.getByLabel('Current password', { exact: true }).fill('Kilnry-local-test-42!');
  await page.getByRole('button', { name: 'View recovery kit' }).click();
  await expect(page.locator('.recovery-card code')).toContainText('kilnry1');
  // One checkbox, then Done (D-63): Done waits for the box to be ticked, and
  // ticking it is the whole acknowledgement.
  await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled();
  await page.locator('.recovery-stored input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Done' }).click();
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
  // D-73a: the harness's own price-age threshold. Every shard prices from the
  // bundled registry seed against the server's real clock — the clock is never
  // pinned in end-to-end, because a pinned now() would split the ledger's
  // created_at from the cap windows — so 30 days after `seeded_at` every priced
  // scenario would refuse with `stale_price` and CI would go red with no code
  // change. The acceptance workspace treats prices as fresh for ten years; the
  // stale path has its own scenario (S-m3 price-age), which sets it to 1.
  await page.getByTestId('price-max-age').fill('3650');
  await page.getByRole('button', { name: 'Save price age' }).click();
  await expect(page.locator('.inline-feedback')).toContainText('3650');
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
  await privatePage.goto(`http://${hostPort}/create`);
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
