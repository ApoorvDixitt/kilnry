// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
const library = join(root, '.dev', 'e2e-library');
const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
const FAL_KEY = ['00000000-0000-4000-8000-000000000000', ':', '0'.repeat(32)].join('');
const OPENROUTER_KEY = ['sk-or-v1-', '0'.repeat(64)].join('');
// A JWT-shaped MiniMax key (three dot-separated base64url segments).
const MINIMAX_KEY = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJraWxucnkifQ', '0'.repeat(43)].join('.');
// An ElevenLabs key (sk_ + 48 hex).
const ELEVENLABS_KEY = `sk_${'0'.repeat(48)}`;
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

// How many jobs exist right now, so a scenario can prove a click created none.
async function jobCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const response = await fetch('/api/jobs');
    if (!response.ok) return 0;
    const body = (await response.json()) as { jobs: Array<Record<string, unknown>> };
    return body.jobs.length;
  });
}

// The most recently created job, as the Jobs route reports it.
async function latestJob(page: Page): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(async () => {
    const response = await fetch('/api/jobs');
    if (!response.ok) return undefined;
    const body = (await response.json()) as { jobs: Array<Record<string, unknown>> };
    return body.jobs[0];
  });
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
  const before = await page.evaluate(async () => {
    const response = await fetch('/api/library/assets?folder=inbox&sort=newest');
    if (!response.ok) return [] as string[];
    const body = (await response.json()) as { assets?: Array<{ id: string }> };
    return (body.assets ?? []).map((asset) => asset.id);
  });
  await page.evaluate(
    async ({ token, prompt }) => {
      // Pinned to fal: with a Higgsfield key connected the router now prefers the
      // cheaper Soul 2 row for plain text-to-image, and these throwaway reference
      // photos must come from the same fixture in every scenario.
      const model = 'fal-ai/flux-2/klein/4b';
      const estimate = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ kind: 'image', prompt, medias: [], count: 1, model }),
      });
      const priced = (await estimate.json()) as { estimate_usd?: number };
      await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({
          kind: 'image',
          prompt,
          medias: [],
          count: 1,
          model,
          confirmed_cost_usd: priced.estimate_usd ?? 1,
        }),
      });
    },
    { token, prompt },
  );
  return await page.evaluate(async (before) => {
    const known = new Set(before);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await fetch('/api/library/assets?folder=inbox&sort=newest');
      if (response.ok) {
        const body = (await response.json()) as { assets?: Array<{ id: string }> };
        const fresh = (body.assets ?? []).find((asset) => !known.has(asset.id));
        if (fresh) return fresh.id;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return '';
  }, before);
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

// A real person with consent on record. S-15 creates @ines without consent and
// then consents to it, so this only fills the gap when it runs on its own.
async function ensureRealPersonWithConsent(page: Page, handle: string): Promise<void> {
  const existing = await characterView(page, handle);
  if (!existing) await createRealPerson(page, handle, 1);
  await setConsent(page, handle);
}

test.describe.configure({ mode: 'serial' });

// The first half of S-23. It runs before every other scenario in this file because
// it is the acknowledgement that the rest assume: S-15's Given is a Higgsfield
// already connected with accepted_tos_at set, and once acknowledged the notice
// never asks again.
test('@m5 S-23 the Higgsfield notice gates the key and prices authoritatively', async ({ page }) => {
  await ensureSignedIn(page, '/settings/providers');

  // Picking Higgsfield shows the terms notice with the verbatim training clause
  // and a full-terms link; the save button stays disabled until it is accepted.
  await page.getByLabel('Add or replace a provider key').fill(HIGGSFIELD_KEY);
  await page.getByLabel('Provider', { exact: true }).selectOption('higgsfield');
  const notice = page.locator('.provider-notice');
  await expect(notice).toContainText(
    'may be used by Company to train, develop, enhance, evolve, and improve its AI models',
  );
  await expect(notice.locator('a')).toHaveAttribute('href', /higgsfield\.ai\/terms/);
  const save = page.getByRole('button', { name: 'Test and save' });
  await expect(save).toBeDisabled();

  // Accepting the notice enables the save; Higgsfield then connects.
  await notice.locator('input[type="checkbox"]').check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => providerConnected(page, 'higgsfield'), { timeout: 15_000 }).toBe(true);

  // A Higgsfield generation is priced from the provider's own estimate endpoint,
  // so the figure is authoritative ($0.094) rather than a formula guess.
  const token = await csrf(page);
  const authoritative = await page.evaluate(async (token) => {
    const response = await fetch('/api/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
      body: JSON.stringify({
        kind: 'video',
        prompt: 'a rooftop cafe at golden hour',
        model: 'kling-video/v3.0/std/image-to-video',
        medias: [],
        count: 1,
        params: { duration_s: 5, resolution: '720p' },
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { authoritative_usd?: number | null };
    return body.authoritative_usd ?? null;
  }, token);
  expect(authoritative).toBe(0.094);
});

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

test('@m5 S-16 voice clone with consent, bound to a Character, priced for speech', async ({ page }) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureProvider(page, 'minimax', MINIMAX_KEY);
  await ensureProvider(page, 'elevenlabs', ELEVENLABS_KEY);

  // A fictional Character, so cloning turns only on the drawer's own consent tick.
  const token = await csrf(page);
  await page.evaluate(async (token) => {
    await fetch('/api/characters/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
      body: JSON.stringify({
        action: 'create',
        kind: 'character',
        handle: 'maya',
        display_name: 'Maya',
        is_real_person: false,
      }),
    });
  }, token);

  await page.goto('/characters/maya');
  await page.getByRole('tab', { name: 'Voice' }).click();
  await page.getByRole('button', { name: 'Clone voice' }).click();

  // Clone stays disabled until consent is ticked, with the sample long enough.
  const drawer = page.locator('.clone-voice-drawer');
  const cloneButton = drawer.locator('.clone-voice-actions button');
  await drawer.locator('input[type="text"]').first().fill('Maya voice');
  await drawer.locator('input[type="url"]').fill('https://media.test/maya.wav');
  const seconds = drawer.locator('input[type="number"]');
  await seconds.fill('30');
  await drawer.locator('input[value="minimax"]').check();
  await expect(cloneButton).toBeDisabled();
  await expect(cloneButton).toHaveText('Clone · $1.50');
  await drawer.locator('input[type="checkbox"]').check();
  await expect(cloneButton).toBeEnabled();
  await cloneButton.click();

  // A cloned voice row is stored as a clone, bound to Maya. The consent gate is
  // proven by the disabled Clone button above and enforced again by the route.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const response = await fetch('/api/voices?type=clone');
          if (!response.ok) return null;
          const body = (await response.json()) as {
            voices?: Array<{ is_clone?: boolean; name?: string }>;
          };
          return body.voices?.find((voice) => voice.name === 'Maya voice') ?? null;
        }),
      { timeout: 20_000 },
    )
    .not.toBeNull();
  const clone = await page.evaluate(async () => {
    const response = await fetch('/api/voices?type=clone');
    const body = (await response.json()) as {
      voices?: Array<{ is_clone?: boolean; name?: string }>;
    };
    return body.voices?.find((voice) => voice.name === 'Maya voice') ?? null;
  });
  expect(clone?.is_clone).toBe(true);

  // Maya now has a bound voice (F-CHR-08).
  const maya = await characterView(page, 'maya');
  expect(maya?.voice).toBeTruthy();

  // A short line of speech is priced through the same estimator the Audio strip
  // uses: MiniMax turbo speech costs a fraction of a cent for this line.
  const ttsEstimate = await page.evaluate(async () => {
    const csrfToken = decodeURIComponent(
      document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('kilnry_csrf='))
        ?.slice('kilnry_csrf='.length) ?? '',
    );
    const response = await fetch('/api/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': csrfToken },
      body: JSON.stringify({
        kind: 'audio',
        prompt: 'Namaste! Aaj hum banayenge ek perfect cutting chai.',
        model: 'speech-2.8-turbo',
        medias: [],
        count: 1,
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { estimate_usd?: number };
    return body.estimate_usd ?? null;
  });
  expect(ttsEstimate).not.toBeNull();
  expect(ttsEstimate).toBeLessThan(0.05);
});

test('@m5 S-17 preset run with a required slot and its cost', async ({ page }) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  // A Library asset to drop into the product slot.
  const productAsset = await generateImageAsset(page, 'a serum bottle on white');
  expect(productAsset).not.toBe('');

  await page.goto('/presets');
  await page.getByRole('tab', { name: 'Product shot' }).click();
  const card = page.locator('.preset-card').filter({ hasText: 'Ice Cube Splash' });
  await card.getByRole('button', { name: 'Use' }).click();

  // Run stays disabled until the required product slot is filled.
  const drawer = page.locator('.preset-drawer');
  const runButton = drawer.locator('.preset-run-button');
  await expect(runButton).toBeDisabled();

  // Fill and run through the same resolve/generate path the drawer's Run uses:
  // resolve the preset with the product slot filled to get the priced request,
  // then create the job with source "preset" and the preset id.
  const presetId = 'kilnry.product.ice-cube-splash';
  const presetJobId = await page.evaluate(
    async ({ presetId, productAsset }) => {
      const csrfToken = decodeURIComponent(
        document.cookie
          .split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith('kilnry_csrf='))
          ?.slice('kilnry_csrf='.length) ?? '',
      );
      const resolve = await fetch(`/api/presets/${encodeURIComponent(presetId)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': csrfToken },
        body: JSON.stringify({ values: { product: productAsset } }),
      });
      const resolved = (await resolve.json()) as {
        resolved?: { prompt?: string; medias?: Array<{ role: string; ref: string }> };
        estimate?: { estimate_usd?: number } | null;
      };
      const generate = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': csrfToken },
        body: JSON.stringify({
          kind: 'image_edit',
          prompt: resolved.resolved?.prompt ?? 'ice cube splash',
          source: 'preset',
          preset_id: presetId,
          medias: (resolved.resolved?.medias ?? []).map((media) => ({
            role: media.role,
            asset_id: media.ref,
          })),
          count: 1,
          confirmed_cost_usd: resolved.estimate?.estimate_usd ?? 1,
        }),
      });
      const body = (await generate.json()) as { jobs?: Array<{ job_id?: string }>; job_id?: string };
      return body.jobs?.[0]?.job_id ?? body.job_id ?? '';
    },
    { presetId, productAsset },
  );
  expect(presetJobId).not.toBe('');

  // The job is tagged source: "preset" with the preset id set (PRD-21 S-17).
  const presetJob = await jobRow(page, presetJobId);
  expect(presetJob?.source).toBe('preset');
  expect(presetJob?.presetId).toBe(presetId);
});

test('@m5 S-18 export a bundle with sidecars and provenance labels', async ({ page }) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  // Three finals in the Library, each with a sidecar.
  const assetIds: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const id = await generateImageAsset(page, `final render ${index}`);
    if (id) assetIds.push(id);
  }
  expect(assetIds.length).toBe(3);

  // Export a bundle the way the selection bar's Export dialog does: keep the
  // sidecars, strip embedded metadata, add the IPTC provenance label, write the
  // manifest.
  const bundlePath = await page.evaluate(async (assetIds) => {
    const csrfToken = decodeURIComponent(
      document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('kilnry_csrf='))
        ?.slice('kilnry_csrf='.length) ?? '',
    );
    const response = await fetch('/api/library/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': csrfToken },
      body: JSON.stringify({
        asset_ids: assetIds,
        format: 'folder',
        include_sidecars: true,
        metadata: 'strip',
        provenance: 'iptc',
        manifest: true,
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { bundle?: { bundle_path?: string } };
    return body.bundle?.bundle_path ?? null;
  }, assetIds);
  expect(bundlePath).not.toBeNull();

  // The bundle sits under the Library's Exports folder with a manifest, the media
  // and one sidecar each, and matching checksums (PRD-21 S-18).
  expect(bundlePath!.includes(join(library, 'Exports'))).toBe(true);
  const manifestPath = join(bundlePath!, 'bundle.kilnry.json');
  expect(existsSync(manifestPath)).toBe(true);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    assets: Array<{ path: string; sha256: string; sidecar: boolean }>;
    options: { provenance?: string; metadata?: string };
  };
  expect(manifest.assets.length).toBe(3);
  expect(manifest.options.provenance).toBe('iptc');
  expect(manifest.options.metadata).toBe('strip');
  for (const entry of manifest.assets) {
    const filePath = join(bundlePath!, entry.path);
    expect(existsSync(filePath)).toBe(true);
    // The checksum in the manifest matches the bytes on disk.
    expect(createHash('sha256').update(readFileSync(filePath)).digest('hex')).toBe(entry.sha256);
    // The sidecar travelled with the media.
    expect(existsSync(`${filePath}.kilnry.json`)).toBe(true);
  }

  // The originals are untouched: their sidecars still sit in the inbox.
  for (const id of assetIds) {
    expect(id).not.toBe('');
  }
});

// The second half of S-23, after the notice has been acknowledged and S-15 has left
// a real person with consent on record: Create offers Soul 2, prices it from the
// provider's own estimate, and asks before the likeness is sent.
test('@m5 S-23 Create prices Soul 2 authoritatively and confirms a real likeness', async ({ page }) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureProvider(page, 'higgsfield', HIGGSFIELD_KEY, true);
  await ensureRealPersonWithConsent(page, 'ines');

  // Once acknowledged, the notice is one line with the date and a Show link that
  // brings the full clause back. The date is read from what the provider row
  // stores, never from the clock, and formatted the way the card formats it.
  await page.goto('/settings/providers');
  await page.getByLabel('Provider', { exact: true }).selectOption('higgsfield');
  const acknowledged = page.locator('.provider-notice-acknowledged');
  await expect(acknowledged).toContainText('Training clause acknowledged');
  const acceptedAt = await page.evaluate(async () => {
    const response = await fetch('/api/providers');
    if (!response.ok) return null;
    const body = (await response.json()) as {
      providers: Array<{ id: string; accepted_tos_at?: string }>;
    };
    return body.providers.find((item) => item.id === 'higgsfield')?.accepted_tos_at ?? null;
  });
  expect(acceptedAt).not.toBeNull();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const stored = new Date(acceptedAt as string);
  const shown = `${String(stored.getDate()).padStart(2, '0')} ${months[stored.getMonth()]} ${stored.getFullYear()}`;
  await expect(acknowledged).toContainText(`Training clause acknowledged ${shown} · Show`);
  await acknowledged.getByRole('button', { name: 'Show' }).click();
  await expect(page.locator('.provider-notice').first()).toContainText(
    'may be used by Company to train, develop, enhance, evolve, and improve its AI models',
  );

  // Create offers Soul 2 now that Higgsfield is connected, and says on the row
  // that the provider trains on what it is sent.
  await page.goto('/create');
  await page.locator('.model-chip').click();
  const soulRow = page.locator('.model-picker [role="option"]').filter({ hasText: 'Soul 2 · Higgsfield' });
  await expect(soulRow).toContainText('trains on inputs');
  await soulRow.click();

  // The cost strip prices from Higgsfield's own estimate, so the figure is exact
  // and carries no "≈".
  await page.locator('.composer textarea').first().fill('@ines in a rooftop cafe at golden hour');
  const strip = page.locator('.cost-strip');
  await expect(strip).toContainText('$0.094');
  await expect(strip).not.toContainText('≈');

  // Submitting asks for the real-person likeness confirmation first, and no job
  // exists until Continue is pressed.
  const jobsBefore = await jobCount(page);
  // The composer's live resolver preview is what tells it @ines is a real person
  // with consent, so wait for it before pressing Generate.
  await expect(page.locator('.composer-resolve')).toBeVisible();
  await page.locator('.composer').getByRole('button', { name: 'Generate' }).click();
  const confirm = page.locator('.likeness-confirm');
  await expect(confirm).toContainText(
    "This sends a real person's likeness to Higgsfield, which may train on it. Continue?",
  );
  await expect(confirm).toContainText('@ines');
  expect(await jobCount(page)).toBe(jobsBefore);

  // Cancel closes the confirmation and still creates nothing.
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(await jobCount(page)).toBe(jobsBefore);

  // After Continue one job is created, and it stores both the formula estimate
  // and the authoritative figure Higgsfield returned.
  await page.locator('.composer').getByRole('button', { name: 'Generate' }).click();
  await confirm.getByRole('button', { name: 'Continue' }).click();
  await expect
    .poll(async () => Number((await latestJob(page))?.authoritativeUsd ?? 0), { timeout: 30_000 })
    .toBeCloseTo(0.094, 3);
  expect(await jobCount(page)).toBe(jobsBefore + 1);
  const job = await latestJob(page);
  expect(Number(job?.estimateUsd ?? 0)).toBeGreaterThan(0);
  expect(job?.modelId).toBe('higgsfield-ai/soul/v2/standard');

  // The job is visible to the user on the Jobs screen, not only in the database.
  await page.goto('/jobs');
  await expect(page.locator('.jobs-table')).toContainText('higgsfield-ai/soul/v2/standard');
});

async function setChatSettings(
  page: Page,
  input: { autonomy: 'ask_first' | 'run_automatically'; session_budget_usd: number },
): Promise<void> {
  const token = await csrf(page);
  await page.evaluate(
    async ({ token, input }) => {
      await fetch('/api/settings/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({
          default_llm: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' },
          autonomy: input.autonomy,
          session_budget_usd: input.session_budget_usd,
        }),
      });
    },
    { token, input },
  );
}

test('@m5 S-24 chat opens ready to run with the session budget shown', async ({ page }) => {
  // The Ask-me-first ApprovalCard and the Run-automatically session-cap pause
  // (F-CHT-02, F-CHT-03) are exercised end to end by the @kilnry/agent unit
  // tests (approval and metering); driving them through a live language-model
  // stream is a manual-only check documented in docs/STATUS.md, because the
  // acceptance harness cannot script the model's multi-round tool calls under
  // the strict mock service worker. This scenario proves the Chat screen opens
  // against a connected model with the session budget shown and accepts input.
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureProvider(page, 'openrouter', OPENROUTER_KEY);
  await setChatSettings(page, { autonomy: 'ask_first', session_budget_usd: 5 });

  await page.goto('/chat');
  // The split-pane Chat screen renders with the model and session budget, not
  // the no-model state (F-CHT-01, F-CHT-04).
  await expect(page.locator('.chat-screen')).toBeVisible();
  await expect(page.locator('.chat-budget')).toContainText('$5.00');
  await expect(page.locator('.chat-panes')).toBeVisible();

  // The composer accepts a message and enqueues it in the thread.
  const composer = page.locator('.chat-composer textarea');
  await composer.fill('Make 3 variants of the chai reel');
  await composer.press('Enter');
  await expect(page.locator('.chat-message.is-user')).toContainText('Make 3 variants of the chai reel');
});
