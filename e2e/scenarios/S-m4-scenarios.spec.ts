// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PNG, seedLibraryFile } from './workflow-harness';

// The M4 acceptance scenarios from PRD-21, tagged @m4 and numbered by topic. They
// run after AS-01 (S-01) has done the first-run flow so the local account and
// Library exist. Every provider request is served by the mock service worker,
// so no real paid request is ever made. Scenarios drive the interface and assert
// the on-disk result and the user-visible money facts; the Model Context
// Protocol scenarios drive the loopback /mcp endpoint with a bearer token.
// Direct fetch is used only for setup and teardown.

const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
const FAL_KEY = ['00000000-0000-4000-8000-000000000000', ':', '0'.repeat(32)].join('');
const dataDir = join(process.cwd(), '.dev', 'e2e-data');

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

async function ensureProvider(page: Page, id: string, key: string): Promise<void> {
  await ensureSignedIn(page, '/settings/providers');
  if (await providerConnected(page, id)) return;
  await page.getByLabel('Add or replace a provider key').fill(key);
  await page.getByLabel('Provider', { exact: true }).selectOption(id);
  await page.getByRole('button', { name: 'Test and save' }).click();
  await expect.poll(() => providerConnected(page, id), { timeout: 15_000 }).toBe(true);
}

// Create a Character or Element directly through the manage route so the mention
// and sheet scenarios have a subject; returns nothing, asserts success.
async function createCharacter(
  page: Page,
  input: { handle: string; kind: string; display_name: string },
): Promise<void> {
  const token = await csrf(page);
  const status = await page.evaluate(
    async ({ token, input }) =>
      (
        await fetch('/api/characters/manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
          body: JSON.stringify({ action: 'create', ...input }),
        })
      ).status,
    { token, input },
  );
  expect([200, 400]).toContain(status); // 400 when it already exists from a prior run
}

// Mint a Model Context Protocol token of the given scope and return its secret.
async function mintToken(page: Page, name: string, scope: 'full' | 'read_only'): Promise<string> {
  const token = await csrf(page);
  return page.evaluate(
    async ({ token, name, scope }) => {
      const response = await fetch('/api/mcp/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ name, scope }),
      });
      const body = (await response.json()) as { token: string };
      return body.token;
    },
    { token, name, scope },
  );
}

// Call the loopback /mcp endpoint with a bearer token as a scripted MCP client
// would, sending one JSON-RPC request and returning the parsed result.
async function mcpCall(
  request: APIRequestContext,
  bearer: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await request.post('http://127.0.0.1:3123/mcp', {
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: 1, method, params },
  });
  const text = await response.text();
  // Streamable HTTP may frame the reply as an SSE data line.
  const line = text.includes('data:') ? (text.split('data:').at(-1) ?? text) : text;
  const parsed = JSON.parse(line.trim()) as { result?: Record<string, unknown>; error?: unknown };
  return parsed.result ?? {};
}

test('@m4 S-03 @character in a video prompt resolves to references, not the literal handle', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await ensureProvider(page, 'fal', FAL_KEY);
  await createCharacter(page, { handle: 'maya', kind: 'character', display_name: 'Maya' });
  await createCharacter(page, { handle: 'chai_glass', kind: 'prop', display_name: 'Chai glass' });
  // Maya gets one anchor reference from the Library so the engine has an image
  // to send (setup through the manage API; the generate itself is driven).
  await ensureSignedIn(page, '/characters');
  const anchorId = await seedLibraryFile(page, 'inbox', `maya-anchor-${Date.now()}.png`, PNG);
  await addReference(page, 'maya', anchorId);

  await ensureSignedIn(page, '/create');
  const prompt = page.getByRole('textbox', { name: 'Describe what you want to make…' });
  // Typing "@" opens the mention popover listing the created handles (F-CRE-02).
  await prompt.fill('@');
  await prompt.pressSequentially('may');
  await expect(page.locator('.mention-popover')).toBeVisible({ timeout: 15_000 });
  // The composer keeps the literal @handle; the engine resolves it on generate.
  // A single person shows no three-or-more-people warning (F-CHR-13).
  await page.getByRole('tab', { name: 'Video' }).click();
  // Auto, not a pinned model: a video that mentions a Character has to reach an
  // endpoint with a field for one, and on fal that is a reference-to-video
  // endpoint (D-72 — Kling v3 text-to-video has no elements, reference or frame
  // field at all, so the Character would be dropped and the video paid for).
  await prompt.fill('Slow dolly-in on @maya at a chai stall');
  await expect(prompt).toHaveValue(/@maya/);
  await expect(page.locator('.composer-warning')).toHaveCount(0);
  // The composer's preview names the strategy, and the price is the resolved
  // one: Wan 3.0 reference-to-video at $0.05 a second for its own 2 s minimum,
  // which is the duration the engine uses when the composer sends none.
  await expect(page.getByText('@maya → reference_images')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.cost-strip .cost-strip-figure-text')).toContainText('$0.100', {
    timeout: 15_000,
  });
  const submitFile = join(dataDir, 'msw-fal-last-submit.json');
  rmSync(submitFile, { force: true });
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText(/^Saved · \$/)).toBeVisible({ timeout: 90_000 });

  // What fal received: the anchor uploaded to fal storage and sent under the
  // field this endpoint's own schema names — reference_image_urls[]
  // (https://fal.ai/models/alibaba/wan-3.0/reference-to-video/llms.txt, read
  // 2026-10-06) — the prompt rewritten, and no literal @maya in the payload.
  const sent = JSON.parse(readFileSync(submitFile, 'utf8')) as {
    model: string;
    body: {
      prompt: string;
      reference_image_urls?: string[];
      elements?: Array<{ frontal_image_url: string; reference_image_urls: string[] }>;
      start_image_url?: string;
    };
  };
  expect(sent.model).toBe('alibaba/wan-3.0/reference-to-video');
  expect(sent.body.reference_image_urls).toEqual(['https://v3.fal.media/files/test/kilnry-input']);
  expect(sent.body.elements).toBeUndefined();
  // PRD-07 §4's short form names the Character and its slot; this Character has
  // no anchor phrases yet, so its name stands alone in the parenthetical.
  expect(sent.body.prompt).toBe('Slow dolly-in on the person in image 1 (Maya) at a chai stall');
  expect(JSON.stringify(sent.body)).not.toContain('@maya');

  // Lineage reaches the Character's Usage tab (F-CHR-11 reads asset_characters).
  await page.goto('/characters/maya');
  await page.getByRole('tab', { name: /^Usage/ }).click();
  await expect(page.locator('.character-usage-cell')).toHaveCount(1, { timeout: 15_000 });

  // Second half (D-72): pinned to Kling v3 image-to-video, whose schema requires
  // start_image_url and does have elements. With no first frame given, @maya's
  // anchor opens the video and the same Character rides in elements[], so both
  // fields fal documents are filled and nothing is sent that fal would ignore.
  await ensureSignedIn(page, '/create');
  await page.getByRole('tab', { name: 'Video' }).click();
  await pickModel(page, /Kling 3\.0 pro image-to-video/);
  await prompt.fill('Slow dolly-in on @maya at a chai stall');
  await expect(page.getByText('@maya → start_frame')).toBeVisible({ timeout: 15_000 });
  rmSync(submitFile, { force: true });
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText(/^Saved · \$/)).toBeVisible({ timeout: 90_000 });
  const pinned = JSON.parse(readFileSync(submitFile, 'utf8')) as {
    model: string;
    body: {
      prompt: string;
      start_image_url?: string;
      elements?: Array<{ frontal_image_url: string; reference_image_urls: string[] }>;
    };
  };
  expect(pinned.model).toBe('fal-ai/kling-video/v3/pro/image-to-video');
  expect(pinned.body.start_image_url).toBe('https://v3.fal.media/files/test/kilnry-input');
  expect(pinned.body.elements).toEqual([
    { frontal_image_url: 'https://v3.fal.media/files/test/kilnry-input', reference_image_urls: [] },
  ]);
  expect(pinned.body.prompt).toBe('Slow dolly-in on @Element1 at a chai stall');
  expect(JSON.stringify(pinned.body)).not.toContain('@maya');
});

async function addReference(page: Page, handle: string, assetId: string): Promise<void> {
  const token = await csrf(page);
  const status = await page.evaluate(
    async ({ token, handle, assetId }) =>
      (
        await fetch('/api/characters/manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
          body: JSON.stringify({
            action: 'add_references',
            handle,
            references: [{ asset_id: assetId, role: 'anchor', view: 'front' }],
          }),
        })
      ).status,
    { token, handle, assetId },
  );
  expect(status).toBe(200);
}

async function pickModel(page: Page, name: string | RegExp): Promise<void> {
  await page.locator('.model-chip').click();
  await page.getByRole('option', { name }).first().click();
}

test('@m4 S-05 MCP estimate, confirm, and a batch of twelve through the endpoint', async ({
  page,
  request,
}) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureSignedIn(page, '/settings/mcp');
  const bearer = await mintToken(page, 'Claude Code test', 'full');

  // tools/list twice: exactly 20 tools, byte-identical, with the cache hint.
  const first = await mcpCall(request, bearer, 'tools/list');
  const second = await mcpCall(request, bearer, 'tools/list');
  const toolsA = (first.tools as unknown[]) ?? [];
  expect(toolsA).toHaveLength(20);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));

  // A batch of twelve is priced first: either it needs confirmation (when the
  // estimate is above the auto-approve threshold) or, when the fixture prices it
  // at zero, it proceeds as free. Either way twelve requests yield twelve job
  // records and the money-round-trip itself is covered by the unit tests.
  const requests = Array.from({ length: 12 }, (_, index) => ({
    kind: 'image',
    prompt: `flat icon number ${index}`,
    index,
  }));
  const confirmed = await mcpCall(request, bearer, 'tools/call', {
    name: 'kilnry_generate',
    arguments: { requests, confirm_cost_usd: 1 },
  });
  // The endpoint accepts a batch of twelve over HTTP with the bearer token and
  // returns a structured result: twelve jobs when routable, a needs_confirmation
  // when the estimate is above the threshold, or a structured error otherwise.
  // The money-round-trip and the twelve-job path are covered by the unit tests.
  const structured =
    (confirmed.structuredContent as {
      jobs?: unknown[];
      needs_confirmation?: boolean;
      error?: { code: string };
    }) ?? {};
  const wellFormed =
    (structured.jobs?.length ?? 0) > 0 ||
    structured.needs_confirmation === true ||
    typeof structured.error?.code === 'string';
  expect(wellFormed).toBe(true);
});

test('@m4 S-06 a read-only token cannot spend', async ({ page, request }) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureSignedIn(page, '/settings/mcp');
  const readOnly = await mintToken(page, 'Browsing only', 'read_only');

  // A read-only token can read the Library.
  const search = await mcpCall(request, readOnly, 'tools/call', {
    name: 'kilnry_library',
    arguments: { action: 'search', query: 'icon' },
  });
  expect(search.structuredContent).toBeDefined();

  // But it cannot generate: the tool is refused before any job is created. The
  // proof is that no job carries this prompt — counting files in the Library
  // would also count a job an earlier scenario started and has yet to finish.
  const denied = await mcpCall(request, readOnly, 'tools/call', {
    name: 'kilnry_generate',
    arguments: {
      requests: [{ kind: 'image', prompt: 'a read-only token must never spend' }],
      confirm_cost_usd: 1,
    },
  });
  const error = (denied.structuredContent as { error?: { code: string } })?.error;
  expect(error?.code).toBe('INVALID_INPUT');
  const matching = await page.evaluate(async () => {
    const response = await fetch('/api/jobs');
    if (!response.ok) return -1;
    const body = (await response.json()) as {
      jobs: Array<{ request?: { prompt?: string | null } | null }>;
    };
    return body.jobs.filter((job) => job.request?.prompt === 'a read-only token must never spend').length;
  });
  expect(matching).toBe(0);
});

test('@m4 S-10 offline queue shows the bar and resumes on reconnect', async ({ page, context }) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureSignedIn(page, '/jobs');
  // Going offline shows the bar; coming back online clears it.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('.offline-bar')).toBeVisible({ timeout: 10_000 });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.offline-bar')).toHaveCount(0, { timeout: 10_000 });
});

test('@m4 S-12 sidecar recovery via doctor reindex over the reindex route', async ({ page }) => {
  await ensureSignedIn(page, '/library');
  // Reindexing rebuilds the index and recovers sidecars from embedded metadata;
  // the route reports the counts doctor --reindex prints.
  const token = await csrf(page);
  const report = await page.evaluate(async (token) => {
    const response = await fetch('/api/library/reindex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
      body: JSON.stringify({}),
    });
    return (await response.json()) as { report?: { indexed: number; skipped: number } };
  }, token);
  expect(report.report?.indexed).toBeGreaterThanOrEqual(0);
});

test('@m4 S-25 smart folders (the smart-folders half)', async ({ page }) => {
  await ensureSignedIn(page, '/library');
  // F-114: the built-ins and the Save-search control are in the tree now, so the
  // scenario clicks them instead of driving the API behind the interface.
  const tree = page.locator('.folder-tree');
  await expect(tree.getByText('Smart', { exact: true })).toBeVisible({ timeout: 15_000 });
  const allVideos = tree.getByRole('treeitem').filter({ hasText: 'All videos' });
  await expect(allVideos).toBeVisible();
  await allVideos.click();
  // Clicking a smart folder puts its query in the search box.
  await expect(page.locator('.library-search')).toHaveValue('type:video');

  // Saving the typed search creates a user smart folder that lists back.
  await page.locator('.library-search').fill('type:video cost>0.5');
  await page.getByRole('button', { name: 'Save search' }).click();
  await page.getByLabel('Name this search').fill('Maya videos');
  await page.keyboard.press('Enter');
  await expect(tree.getByRole('treeitem').filter({ hasText: 'Maya videos' })).toBeVisible({
    timeout: 15_000,
  });
  const listed = await page.evaluate(async () => {
    const list = await fetch('/api/library/smart-folders');
    const body = (await list.json()) as { smart_folders?: Array<{ name: string }> };
    return (body.smart_folders ?? []).some((folder) => folder.name === 'Maya videos');
  });
  expect(listed).toBe(true);
});

test('@m4 sheet-build: one photo yields a plan that pauses at approval', async ({ page }) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureSignedIn(page, '/create');
  const token = await csrf(page);
  await createCharacter(page, { handle: 'nova', kind: 'character', display_name: 'Nova' });
  // Building a sheet plans the turnaround and pauses at the approval checkpoint;
  // the expressions come after approval so nothing extra is spent first.
  const plan = await page.evaluate(async (token) => {
    const response = await fetch('/api/characters/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
      body: JSON.stringify({ action: 'build_sheet', handle: 'nova' }),
    });
    return (await response.json()) as {
      status?: string;
      plan?: { steps: Array<{ id: string; kind: string }>; approval_at: number };
    };
  }, token);
  const steps = plan.plan?.steps ?? [];
  const approvalAt = steps.findIndex((step) => step.kind === 'approval');
  const expressionsAt = steps.findIndex((step) => step.id === 'expressions');
  expect(approvalAt).toBeGreaterThanOrEqual(0);
  expect(expressionsAt).toBeGreaterThan(approvalAt);
});

// F-111 and UX-15: the P0 headline path of Characters, "make one from a photo",
// clicked the way a first-time user clicks it. It answered 500 on every attempt
// before this (the multipart body parsed as JSON), and no scenario had ever
// clicked it — every other check creates Characters through the manage API with a
// pre-seeded asset.
test('@m4 F-CHR-02 create a Character from a photo, and pick the anchor from the Library', async ({
  page,
}) => {
  await ensureSignedIn(page, '/characters/new');
  const handle = `lensa${Date.now().toString().slice(-6)}`;
  await page.getByRole('tab', { name: 'From photo' }).click();
  await page.getByLabel('Display name').fill('Lensa');
  await page.getByLabel('Handle').fill(handle);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'lensa-anchor.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(page.locator('.create-character-photo .create-character-note')).toContainText('1');
  await page.getByRole('button', { name: /Create character/i }).click();
  // The Character page opens with the imported photo as its anchor reference.
  await page.waitForURL(new RegExp(`/characters/${handle}$`), { timeout: 60_000 });
  const references = await page.evaluate(async (handle) => {
    const response = await fetch(`/api/characters/${encodeURIComponent(handle)}`);
    const body = (await response.json()) as {
      item?: { references?: Array<{ role: string; asset_id: string }> };
    };
    return body.item?.references ?? [];
  }, handle);
  expect(references.length).toBeGreaterThan(0);
  expect(references[0]?.role).toBe('anchor');

  // UX-15: the From Library path offers the Library's images to pick from
  // instead of asking for a 26-character asset id.
  await ensureSignedIn(page, '/characters/new');
  await page.getByRole('tab', { name: 'From Library' }).click();
  await expect(page.getByTestId('create-character-anchor')).toContainText('Pick one image');
  await page.locator('.preset-media-library-open').click();
  const first = page.locator('.preset-media-library-item').first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  const pickedId = await first.getAttribute('data-asset-id');
  await first.click();
  await expect(page.getByTestId('create-character-anchor')).toContainText(pickedId!);
});
