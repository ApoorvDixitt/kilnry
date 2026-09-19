// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { distinctPng } from './distinct-pngs';

// The M3 acceptance scenarios from PRD-21, tagged @m3 and numbered by topic (not
// by milestone). They run after AS-01 (which is also tagged @m3 and is scenario
// S-01) has completed the first-run flow, so the local account exists and the
// Library is initialised. Every provider request is served by the mock service
// worker started in the end-to-end server with unhandled requests treated as
// errors, so no real paid request is ever made. The scenarios drive the
// interface — clicking, typing, pressing Generate — and assert the on-disk
// result (the media file and its sidecar) and what the user sees on screen.
// Direct fetch calls are used only for setup and teardown (sign-in, caps).

const root = process.cwd();
const library = join(root, '.dev', 'e2e-library');
function libraryDir(): string {
  return library;
}
const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
const OPENROUTER_KEY = ['sk-or-v1-', '0'.repeat(64)].join('');
const FAL_KEY = ['00000000-0000-4000-8000-000000000000', ':', '0'.repeat(32)].join('');

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

// Connect a provider through the real Providers screen when it is not already
// connected. The mock service worker answers the key test, so a fake key saves.
async function ensureProvider(page: Page, id: string, key: string): Promise<void> {
  await ensureSignedIn(page, '/settings/providers');
  if (await providerConnected(page, id)) return;
  await page.getByLabel('Add or replace a provider key').fill(key);
  await page.getByLabel('Provider', { exact: true }).selectOption(id);
  await page.getByRole('button', { name: 'Test and save' }).click();
  await expect.poll(() => providerConnected(page, id), { timeout: 15_000 }).toBe(true);
}

// Connect only the given provider and remove the others, so the composer's Auto
// route resolves deterministically to that provider for a scenario. Removing a
// key is teardown-style setup done through the key route.
async function ensureOnlyProvider(page: Page, keep: string, key: string): Promise<void> {
  await ensureProvider(page, keep, key);
  const token = await csrf(page);
  for (const id of ['openrouter', 'fal', 'pollinations']) {
    if (id === keep) continue;
    if (!(await providerConnected(page, id))) continue;
    await page.evaluate(
      async ({ id, token }) => {
        await fetch(`/api/providers/${id}/key`, {
          method: 'DELETE',
          headers: { 'X-Kilnry-CSRF': token },
        });
      },
      { id, token },
    );
  }
  await expect.poll(() => providerConnected(page, keep), { timeout: 10_000 }).toBe(true);
  for (const id of ['openrouter', 'fal', 'pollinations']) {
    if (id === keep) continue;
    await expect.poll(() => providerConnected(page, id), { timeout: 10_000 }).toBe(false);
  }
}

async function setDailyCap(page: Page, cap: number | null, behavior: 'block' | 'ask'): Promise<void> {
  const token = await csrf(page);
  const status = await page.evaluate(
    async ({ token, cap, behavior }) =>
      (
        await fetch('/api/budget', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
          body: JSON.stringify({ scope: 'daily', cap_usd: cap, behavior }),
        })
      ).status,
    { token, cap, behavior },
  );
  expect(status).toBe(200);
}

// Choose a specific model in the composer picker by its visible name.
async function pickModel(page: Page, name: string | RegExp): Promise<void> {
  await page.locator('.model-chip').click();
  await page.getByRole('option', { name }).first().click();
}

function inboxFiles(extension: string): string[] {
  return readdirSync(join(libraryDir(), 'inbox')).filter((file) => file.endsWith(extension));
}

// The newest media file of a kind in the inbox, by modification time, so a test
// reads the file it just generated rather than an earlier one.
function newestInboxFile(extension: string): string | undefined {
  const dir = join(libraryDir(), 'inbox');
  return readdirSync(dir)
    .filter((file) => file.endsWith(extension))
    .map((file) => ({ file, mtime: statSync(join(dir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .at(0)?.file;
}

test('@m3 S-02 demo tier with a free Pollinations key', async ({ page }) => {
  await ensureOnlyProvider(page, 'pollinations', `sk_${'p'.repeat(32)}`);
  await ensureSignedIn(page, '/create');
  // The demo model carries a visible Demo badge in the picker.
  await page.locator('.model-chip').click();
  await expect(page.locator('.model-row-demo').first()).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await page
    .getByRole('textbox', { name: 'Describe what you want to make…' })
    .fill('a friendly paper robot waving hello');
  // Pollinations is the only connected provider, so the free demo model is used.
  await expect(page.locator('.cost-strip .cost-strip-figure-text')).toContainText('$0.00', {
    timeout: 15_000,
  });
  const before = inboxFiles('.png').length;
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText(/^Saved · \$0\.00/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.result-tile-demo').first()).toBeVisible();
  await expect.poll(() => inboxFiles('.png').length, { timeout: 10_000 }).toBeGreaterThan(before);
  const png = newestInboxFile('.png') as string;
  const sidecar = JSON.parse(readFileSync(join(libraryDir(), 'inbox', `${png}.kilnry.json`), 'utf8')) as {
    generation?: { provider?: string; actual_usd?: number };
    tags?: string[];
  };
  expect(sidecar.generation?.provider).toBe('pollinations');
  expect(sidecar.generation?.actual_usd).toBe(0);
  expect(sidecar.tags).toContain('demo');
});

test('@m3 S-07 budget cap with Block stops the generation', async ({ page }) => {
  await ensureProvider(page, 'openrouter', OPENROUTER_KEY);
  await ensureSignedIn(page, '/create');
  await setDailyCap(page, 0.001, 'block');
  await page.goto('/create');
  await pickModel(page, /Auto/);
  await page
    .getByRole('textbox', { name: 'Describe what you want to make…' })
    .fill('a tiny brass bell on felt');
  await expect(page.locator('.cost-strip')).toHaveAttribute('data-status', 'over-budget', {
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Generate' })).toBeDisabled();
  await setDailyCap(page, null, 'block');
});

test('@m3 S-08 budget cap with Ask, then Allow this once', async ({ page }) => {
  await ensureProvider(page, 'openrouter', OPENROUTER_KEY);
  await ensureSignedIn(page, '/create');
  await setDailyCap(page, 0.001, 'ask');
  await page.goto('/create');
  await pickModel(page, /Auto/);
  await page
    .getByRole('textbox', { name: 'Describe what you want to make…' })
    .fill('a copper teapot on linen');
  const approval = page.getByRole('alertdialog', { name: 'Over budget' });
  await expect(approval).toBeVisible({ timeout: 15_000 });
  await expect(approval.getByRole('button', { name: 'Allow this once' })).toBeVisible();
  await expect(approval.getByRole('link', { name: 'Raise cap' })).toBeVisible();
  await expect(approval.getByRole('button', { name: 'Cancel' })).toBeVisible();
  const before = inboxFiles('.png').length;
  await approval.getByRole('button', { name: 'Allow this once' }).click();
  await expect(page.getByText(/^Saved · \$/)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => inboxFiles('.png').length, { timeout: 10_000 }).toBeGreaterThan(before);
  // The one-time override is recorded and visible in the Security audit log.
  await page.goto('/settings/security');
  await expect(page.locator('.audit-table [data-action="budget.override"]').first()).toBeVisible({
    timeout: 15_000,
  });
  await setDailyCap(page, null, 'block');
});

test('@m3 S-09 moderation rejection is free and recoverable', async ({ page }) => {
  await ensureOnlyProvider(page, 'fal', FAL_KEY);
  await ensureSignedIn(page, '/create');
  // fal is the only provider, so an image generation routes to it. A TRIGGER
  // prompt is rejected by the fixture as a content-policy violation, so the job
  // is moderated and not charged.
  await page
    .getByRole('textbox', { name: 'Describe what you want to make…' })
    .fill('a TRIGGER scene the checker rejects');
  await expect(page.locator('.cost-strip .cost-strip-figure-text')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Generate' }).click();
  const moderated = page.locator('.moderated-tile');
  await expect(moderated).toBeVisible({ timeout: 20_000 });
  await expect(moderated).toContainText('Not charged');
  // Recovery is offered on the same tile: Edit prompt restores the text.
  await moderated.getByRole('button', { name: 'Edit prompt' }).click();
  await expect(page.getByRole('textbox', { name: 'Describe what you want to make…' })).toHaveValue(/TRIGGER/);
  // The Jobs table shows the moderated row as free and refunded, under Blocked.
  await page.goto('/jobs');
  await expect(page.locator('.jobs-cost').filter({ hasText: 'refunded' }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('tab', { name: /Blocked/ }).click();
  await expect(page.locator('.jobs-table tbody tr[data-status="moderated"]').first()).toBeVisible();
  // A clean prompt now produces a real, saved result.
  await page.goto('/create');
  const before = inboxFiles('.png').length;
  await page
    .getByRole('textbox', { name: 'Describe what you want to make…' })
    .fill('a calm harbour at dawn, soft light');
  await expect(page.locator('.cost-strip .cost-strip-figure-text')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText(/^Saved · \$/)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => inboxFiles('.png').length, { timeout: 10_000 }).toBeGreaterThan(before);
});

// S-13 runs against the production project (next standalone build), the way a
// user runs Kilnry, where the filesystem watcher emits events. The watcher's
// ignore rule was fixed (F-LIB-04) to run relative to the Library root, so a
// root under a dot-directory such as the harness's .dev path no longer has every
// file ignored. The file is dropped into the watched inbox, indexed with a
// sidecar, then renamed on disk; the Library follows the rename.
test('@m3 S-13 rename and move a file outside Kilnry updates the Library', async ({ page }) => {
  await ensureSignedIn(page, '/library');
  // Seed a real media file into the inbox (watched from startup), let the watcher
  // index it and write a sidecar, then rename it on disk and confirm the Library
  // follows the rename with the sidecar beside it.
  const stamp = Date.now();
  const inbox = join(libraryDir(), 'inbox');
  const original = join(inbox, `clip_${stamp}.png`);
  writeFileSync(original, distinctPng(0));
  // The watcher waits for write-stability (about 2 s) then debounces before
  // indexing, so give the first index time to land and write a sidecar.
  await expect.poll(() => existsSync(`${original}.kilnry.json`), { timeout: 30_000 }).toBe(true);
  const renamed = join(inbox, `hero_${stamp}.png`);
  renameSync(original, renamed);
  // After the rename the watcher indexes the new name and writes its sidecar.
  await expect.poll(() => existsSync(`${renamed}.kilnry.json`), { timeout: 30_000 }).toBe(true);
  // The search API reflects the new filename.
  await expect
    .poll(
      async () =>
        page.evaluate(async (needle) => {
          const response = await fetch(`/api/library/search?q=${needle}`);
          const body = (await response.json()) as { assets: Array<{ path: string }> };
          return body.assets.some((asset) => asset.path.includes(needle));
        }, `hero_${stamp}`),
      { timeout: 15_000 },
    )
    .toBe(true);
  rmSync(renamed, { force: true });
  rmSync(`${renamed}.kilnry.json`, { force: true });
});

test('@m3 S-14 import a folder of legacy renders through the interface', async ({ page }) => {
  await ensureSignedIn(page, '/library');
  // A CI-sized subset of the 200-file scenario: twenty PNGs in a folder under the
  // Library. The Import folder control imports the folder currently selected in
  // the tree, indexing its media in place and writing a sidecar beside each file.
  const name = `Legacy_${Date.now()}`;
  const source = join(libraryDir(), name);
  mkdirSync(source, { recursive: true });
  const IMPORT_COUNT = 20;
  for (let index = 0; index < IMPORT_COUNT; index += 1) {
    writeFileSync(join(source, `legacy_${String(index).padStart(2, '0')}.png`), distinctPng(index));
  }
  await page.reload();
  const folderButton = page.locator('.folder-tree-item', { hasText: name });
  await expect(folderButton).toBeVisible({ timeout: 10_000 });
  await folderButton.click();
  await expect(folderButton).toHaveClass(/is-selected/);
  await page.getByRole('button', { name: 'Import folder' }).click();
  await expect(page.locator('.library-import-status')).toContainText(/Imported \d+ files\./, {
    timeout: 30_000,
  });
  // A sidecar ends up beside each original; the media bytes are unchanged.
  await expect
    .poll(() => readdirSync(source).filter((file) => file.endsWith('.png.kilnry.json')).length, {
      timeout: 30_000,
    })
    .toBe(IMPORT_COUNT);
  rmSync(source, { recursive: true, force: true });
});

test('@m3 S-25 search syntax typed into the Library search box', async ({ page }) => {
  await ensureSignedIn(page, '/library');
  const box = page.getByRole('searchbox', { name: /Search/ });
  await box.fill('type:image since:30d cost>0');
  await box.press('Enter');
  // The grid shows only images; the toolbar reports a result count.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const response = await fetch(
            `/api/library/search?q=${encodeURIComponent('type:image since:30d cost>0')}`,
          );
          const body = (await response.json()) as { assets: Array<{ kind: string }> };
          return body.assets.every((asset) => asset.kind === 'image');
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
});

test('@m3 M3-VID generate a video against the fal video fixture', async ({ page }) => {
  await ensureOnlyProvider(page, 'fal', FAL_KEY);
  await ensureSignedIn(page, '/create');
  // Switch to Video mode; fal is the only provider so Auto routes to its video model.
  await page.getByRole('tab', { name: 'Video' }).click();
  await page
    .getByRole('textbox', { name: 'Describe what you want to make…' })
    .fill('a slow pan across a misty harbour at dawn');
  await expect(page.locator('.cost-strip .cost-strip-figure-text')).toBeVisible({ timeout: 15_000 });
  const before = inboxFiles('.mp4').length;
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText(/^Saved · \$/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => inboxFiles('.mp4').length, { timeout: 15_000 }).toBeGreaterThan(before);
  const mp4 = newestInboxFile('.mp4') as string;
  expect(existsSync(join(libraryDir(), 'inbox', `${mp4}.kilnry.json`))).toBe(true);
});
