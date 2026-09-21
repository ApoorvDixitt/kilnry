// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// The M5 acceptance scenarios from PRD-21, tagged @m5. They run after AS-01 has
// done the first-run flow so the local account and Library exist. Every provider
// request is served by the strict mock service worker (unhandled requests are
// errors), so no real paid request is ever made. Scenarios drive the interface
// and assert the on-disk result and the user-visible money facts; direct fetch is
// used only for setup. The once-against-a-real-fal-key training run named in
// S-15 is manual-only and documented in docs/STATUS.md, never automated here.

const root = process.cwd();
const dataDir = join(root, '.dev', 'e2e-data');
const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
const FAL_KEY = ['00000000-0000-4000-8000-000000000000', ':', '0'.repeat(32)].join('');
// A JWT-shaped MiniMax key (three dot-separated base64url segments).
const MINIMAX_KEY = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJraWxucnkifQ', '0'.repeat(43)].join('.');
// A Higgsfield key pair (uuid:secret) accepted by the adapter's detector.
const HIGGSFIELD_KEY = [
  ['00000000', '0000', '4000', '8000', '000000000000'].join('-'),
  ':',
  'a'.repeat(24),
].join('');

async function ensureSignedIn(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (/\/login$/.test(page.url())) {
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !/\/login$/.test(url.pathname), { timeout: 30_000 }).catch(() => {}),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ]);
    await page.goto(path);
  }
}

async function csrf(page: Page): Promise<string> {
  return page.evaluate(() =>
    decodeURIComponent(
      document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('kilnry_csrf='))
        ?.slice('kilnry_csrf='.length) ?? '',
    ),
  );
}

async function providerConnected(page: Page, id: string): Promise<boolean> {
  return page.evaluate(async (id) => {
    const response = await fetch('/api/providers');
    if (!response.ok) return false;
    const body = (await response.json()) as { providers: Array<{ id: string; connected: boolean }> };
    return body.providers.some((provider) => provider.id === id && provider.connected);
  }, id);
}

// Connect a provider key through the same route the Settings screen posts to.
// Higgsfield needs the terms-of-use acknowledgement (D-44), threaded here.
async function ensureProvider(page: Page, id: string, key: string, acceptTos = false): Promise<void> {
  await ensureSignedIn(page, '/settings/providers');
  if (await providerConnected(page, id)) return;
  const token = await csrf(page);
  await page.evaluate(
    async ({ token, id, key, acceptTos }) => {
      await fetch(`/api/providers/${id}/key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ key, accept_tos: acceptTos }),
      });
    },
    { token, id, key, acceptTos },
  );
  await expect.poll(() => providerConnected(page, id), { timeout: 15_000 }).toBe(true);
}

async function generateVideoJob(page: Page, prompt: string, model: string): Promise<string> {
  const token = await csrf(page);
  return page.evaluate(
    async ({ token, prompt, model }) => {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({
          kind: 'video',
          prompt,
          model,
          medias: [],
          count: 1,
          params: { duration_s: 6 },
          confirmed_cost_usd: 5,
        }),
      });
      const body = (await response.json()) as { jobs?: Array<{ job_id?: string }>; job_id?: string };
      return body.jobs?.[0]?.job_id ?? body.job_id ?? '';
    },
    { token, prompt, model },
  );
}

async function jobRow(page: Page, jobId: string): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(async (jobId) => {
    const response = await fetch('/api/jobs');
    if (!response.ok) return undefined;
    const body = (await response.json()) as { jobs: Array<Record<string, unknown>> };
    return body.jobs.find((job) => job.id === jobId);
  }, jobId);
}

async function ledgerRows(page: Page, jobId: string): Promise<number> {
  const token = await csrf(page);
  return page.evaluate(
    async ({ token, jobId }) => {
      const response = await fetch('/api/budget/ledger/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({
          from: '2000-01-01T00:00:00.000Z',
          to: '2100-01-01T00:00:00.000Z',
        }),
      });
      if (!response.ok) return -1;
      const body = (await response.json()) as { csv?: string };
      const lines = (body.csv ?? '').split('\n').filter((line) => line.includes(jobId));
      return lines.length;
    },
    { token, jobId },
  );
}
// Generate one image through the engine and return the id of the asset it lands
// in the Library inbox, so a Character can carry real reference bytes for
// training. Uses the composer's estimate/generate path under the fal fixture.
async function generateImageAsset(page: Page, prompt: string): Promise<string> {
  const token = await csrf(page);
  await page.evaluate(
    async ({ token, prompt }) => {
      const estimate = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ kind: 'image', prompt, medias: [], count: 1 }),
      });
      const priced = (await estimate.json()) as { estimate?: { estimate_usd?: number } };
      await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({
          kind: 'image',
          prompt,
          medias: [],
          count: 1,
          confirmed_cost_usd: priced.estimate?.estimate_usd ?? 1,
        }),
      });
    },
    { token, prompt },
  );
  return await page.evaluate(async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await fetch('/api/library/assets?folder=inbox&sort=newest');
      if (response.ok) {
        const body = (await response.json()) as { assets?: Array<{ id: string }> };
        if (body.assets && body.assets.length > 0) return body.assets[0]!.id;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return '';
  });
}

// Create a real-person Character with the given number of anchor references and
// consent unset, so the training consent gate (S-15) starts blocked.
async function createRealPerson(page: Page, handle: string, referenceCount: number): Promise<void> {
  const references: Array<{ asset_id: string; role: string }> = [];
  for (let index = 0; index < referenceCount; index += 1) {
    const assetId = await generateImageAsset(page, `reference photo ${index} of ${handle}`);
    if (assetId) references.push({ asset_id: assetId, role: 'anchor' });
  }
  const token = await csrf(page);
  await page.evaluate(
    async ({ token, handle, references }) => {
      await fetch('/api/characters/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({
          action: 'create',
          kind: 'character',
          handle,
          display_name: handle,
          is_real_person: true,
          references,
        }),
      });
    },
    { token, handle, references },
  );
}

async function setConsent(page: Page, handle: string): Promise<void> {
  const token = await csrf(page);
  await page.evaluate(
    async ({ token, handle }) => {
      await fetch('/api/characters/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({
          action: 'set_consent',
          handle,
          consent: { is_real_person: true, status: 'self' },
        }),
      });
    },
    { token, handle },
  );
}

async function characterView(page: Page, handle: string): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(async (handle) => {
    const response = await fetch(`/api/characters/${encodeURIComponent(handle)}`);
    if (!response.ok) return undefined;
    const body = (await response.json()) as { item?: Record<string, unknown> };
    return body.item;
  }, handle);
}

test.describe.configure({ mode: 'serial' });

test('@m5 S-11 an ambiguous timeout never double-spends and Check status resolves it', async ({ page }) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureProvider(page, 'minimax', MINIMAX_KEY);
  await ensureSignedIn(page, '/jobs');

  // Generate a MiniMax H3 video. The fixture status endpoint hangs past the test
  // poll timeout (KILNRY_TEST_TIMEOUT_S), so the job fails with an ambiguous
  // timeout rather than resubmitting.
  const jobId = await generateVideoJob(page, 'a 6 second cutting chai reel', 'MiniMax-H3');
  expect(jobId).not.toBe('');

  // The row reaches the failed timeout state and shows the no-double-spend copy.
  await expect.poll(async () => (await jobRow(page, jobId))?.status, { timeout: 40_000 }).toBe('failed');
  const failed = await jobRow(page, jobId);
  expect(failed?.errorCode).toBe('TIMEOUT');
  const storedRequestId = failed?.providerRequestId;
  expect(typeof storedRequestId).toBe('string');

  await page.reload();
  await expect(page.locator('.jobs-timeout-note').first()).toContainText(
    "Kilnry hasn't resubmitted, so you won't be charged twice",
  );

  // Retry on a timed-out row does not resubmit blindly: it warns that a fresh
  // request may bill twice and offers to check the provider first (S-11).
  await page.getByRole('button', { name: 'Retry', exact: true }).first().click();
  await expect(page.locator('.jobs-retry-dialog')).toContainText(
    'Retry will submit a new request and may bill twice if the first one completes. Check minimax first?',
  );

  // Choosing Check from the dialog re-polls the stored provider request id. By
  // now the fixture reports the finished video, so the job completes on its
  // original estimate — and the stored request id is unchanged, proving there
  // was no second submit.
  await page.getByRole('button', { name: 'Check minimax first' }).click();
  await expect.poll(async () => (await jobRow(page, jobId))?.status, { timeout: 40_000 }).toBe('completed');
  const done = await jobRow(page, jobId);
  expect(done?.providerRequestId).toBe(storedRequestId);
  // Exactly one ledger row for this job — the money the user sees, charged once.
  await expect.poll(() => ledgerRows(page, jobId), { timeout: 10_000 }).toBe(1);
});

test('@m5 S-15 character training stays behind the consent gate', async ({ page }) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureProvider(page, 'higgsfield', HIGGSFIELD_KEY, true);
  // A real person with references but no consent recorded yet.
  await createRealPerson(page, 'ines', 4);
  await page.goto('/characters/ines');
  await page.getByRole('tab', { name: 'Identities' }).click();

  // Before consent, every Train button is disabled and says why.
  const falButton = page.locator('.character-trainer-card').filter({ hasText: 'fal' }).getByRole('button');
  await expect(falButton).toBeDisabled();
  await expect(falButton).toHaveAttribute('title', 'Set consent for this real person first.');

  // Record consent, then the fal dialog shows the estimate and fal's terms.
  await setConsent(page, 'ines');
  await page.reload();
  await page.getByRole('tab', { name: 'Identities' }).click();
  await page.locator('.character-trainer-card').filter({ hasText: 'fal' }).getByRole('button').click();
  await expect(page.locator('.character-train-dialog')).toContainText('≈ $2.00 · 1,000 steps · about 20 min');
  await expect(page.locator('.character-train-terms')).toContainText('low-rank adaptation');
  await page.locator('.character-train-dialog').getByRole('button', { name: 'Confirm' }).click();

  // On completion a trained identity is ready with a local weights file, and the
  // Character shows a trained badge.
  await expect
    .poll(
      async () => {
        const view = await characterView(page, 'ines');
        const identities = (view?.trained_identities as Array<{ status?: string }>) ?? [];
        return identities.some((identity) => identity.status === 'ready');
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  await page.reload();
  await page.getByRole('tab', { name: 'Identities' }).click();
  await expect(page.locator('.character-trained-badge')).toBeVisible();

  // The weights landed on disk under the identities folder with a real file.
  const identitiesDir = join(dataDir, 'identities');
  expect(existsSync(identitiesDir)).toBe(true);
  const loraFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.safetensors')) loraFiles.push(full);
    }
  };
  walk(identitiesDir);
  expect(loraFiles.length).toBeGreaterThanOrEqual(1);

  // The Higgsfield trainer first asks for the extra real-person confirmation.
  await page.locator('.character-trainer-card').filter({ hasText: 'Higgsfield' }).getByRole('button').click();
  await expect(page.locator('.character-train-terms')).toContainText(
    "This sends a real person's likeness to Higgsfield, which may train on it. Continue?",
  );
  await expect(page.locator('.character-train-estimate')).toContainText('$2.50');
});
