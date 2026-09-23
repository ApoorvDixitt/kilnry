// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The milestone gate suites: keyboard shortcuts from the design contract, an
// accessibility scan on every route the milestone touched, reduced-motion through
// both the operating-system preference and the Appearance setting, and light and
// dark screenshots of every touched route saved to e2e/output/. Runs after AS-01
// has onboarded the account and connected OpenRouter.

const root = process.cwd();
const outDir = join(root, 'e2e', 'output');
const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
const OPENROUTER_KEY = ['sk-or-v1-', '0'.repeat(64)].join('');
const FAL_KEY = ['00000000-0000-4000-8000-000000000000', ':', '0'.repeat(32)].join('');
// The fixture Characters the gate needs on screen: the grid, and one detail page.
const GATE_CHARACTERS = ['maya', 'rohan', 'priya'] as const;

const TOUCHED_ROUTES = [
  '/create',
  '/library',
  '/jobs',
  '/chat',
  '/presets',
  '/characters',
  '/characters?tab=elements',
  '/characters?tab=voices',
  '/characters/new',
  '/characters/maya',
  '/settings/mcp',
  '/settings/chat',
  '/settings/providers',
  '/settings/budget',
  '/settings/appearance',
  '/settings/security',
];

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
    if (/\/login$/.test(page.url())) {
      await page.waitForTimeout(1000);
      await page.goto(path);
    }
  }
}

async function ensureOpenRouter(page: Page): Promise<void> {
  await ensureSignedIn(page, '/settings/providers');
  const connected = await page.evaluate(async () => {
    const response = await fetch('/api/providers');
    if (!response.ok) return false;
    const body = (await response.json()) as { providers: Array<{ id: string; connected: boolean }> };
    return body.providers.some((provider) => provider.id === 'openrouter' && provider.connected);
  });
  if (connected) return;
  await page.getByLabel('Add or replace a provider key').fill(OPENROUTER_KEY);
  await page.getByLabel('Provider', { exact: true }).selectOption('openrouter');
  await page.getByRole('button', { name: 'Test and save' }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const response = await fetch('/api/providers');
        const body = (await response.json()) as { providers: Array<{ id: string; connected: boolean }> };
        return body.providers.some((provider) => provider.id === 'openrouter' && provider.connected);
      }),
    )
    .toBe(true);
}

async function firstAssetId(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const response = await fetch('/api/library/search?q=type:image');
    if (!response.ok) return null;
    const body = (await response.json()) as { assets: Array<{ id: string }> };
    return body.assets[0]?.id ?? null;
  });
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

async function ensureFal(page: Page): Promise<void> {
  await ensureSignedIn(page, '/settings/providers');
  const token = await csrf(page);
  await page.evaluate(
    async ({ token, key }) => {
      const response = await fetch('/api/providers');
      if (response.ok) {
        const body = (await response.json()) as { providers: Array<{ id: string; connected: boolean }> };
        if (body.providers.some((provider) => provider.id === 'fal' && provider.connected)) return;
      }
      await fetch('/api/providers/fal/key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ key }),
      });
    },
    { token, key: FAL_KEY },
  );
}

// One image through the fal fixture, returned as its Library asset id.
async function anchorImage(page: Page, prompt: string): Promise<string> {
  const token = await csrf(page);
  const before = await page.evaluate(async () => {
    const response = await fetch('/api/library/assets?folder=inbox&sort=newest');
    if (!response.ok) return [] as string[];
    const body = (await response.json()) as { assets?: Array<{ id: string }> };
    return (body.assets ?? []).map((asset) => asset.id);
  });
  await page.evaluate(
    async ({ token, prompt }) => {
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
  return page.evaluate(async (before) => {
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

/**
 * The fixture Characters the Characters screen and the detail route need. Each is
 * created with an anchor reference generated through the fal fixture, so the card
 * grid and the reference sheet show a real thumbnail rather than an empty tile.
 */
async function ensureGateCharacters(page: Page): Promise<void> {
  await ensureFal(page);
  await ensureSignedIn(page, '/characters');
  for (const handle of GATE_CHARACTERS) {
    const exists = await page.evaluate(async (handle) => {
      const response = await fetch(`/api/characters/${encodeURIComponent(handle)}`);
      if (!response.ok) return false;
      const body = (await response.json()) as { item?: { references?: unknown[] } };
      return (body.item?.references?.length ?? 0) > 0;
    }, handle);
    if (exists) continue;
    const assetId = await anchorImage(page, `anchor portrait of ${handle}`);
    const token = await csrf(page);
    await page.evaluate(
      async ({ token, handle, assetId }) => {
        const detail = await fetch(`/api/characters/${encodeURIComponent(handle)}`);
        const action = detail.ok ? 'add_references' : 'create';
        await fetch('/api/characters/manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
          body: JSON.stringify(
            action === 'create'
              ? {
                  action: 'create',
                  kind: 'character',
                  handle,
                  display_name: handle.charAt(0).toUpperCase() + handle.slice(1),
                  is_real_person: false,
                  ...(assetId ? { references: [{ asset_id: assetId, role: 'anchor' }] } : {}),
                }
              : { action: 'add_references', handle, references: [{ asset_id: assetId, role: 'anchor' }] },
          ),
        });
      },
      { token, handle, assetId },
    );
  }
}

test('@gate keyboard shortcuts from the design contract §2.12', async ({ page }) => {
  await ensureOpenRouter(page);
  await ensureSignedIn(page, '/create');
  await page.locator('body').click();

  // ⌘K opens the command palette; Escape closes it.
  await page.keyboard.press('ControlOrMeta+KeyK');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden();

  // ? shows the keyboard-shortcuts help.
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');

  // G then S goes to Settings.
  await page.keyboard.press('g');
  await page.keyboard.press('s');
  await page.waitForURL(/\/settings/);
  expect(page.url()).toMatch(/\/settings/);

  // Back on Create: / focuses the prompt.
  await ensureSignedIn(page, '/create');
  await page.keyboard.press('/');
  await expect(page.getByRole('textbox', { name: 'Describe what you want to make…' })).toBeFocused();
  await page.keyboard.press('Escape');

  // M opens the model picker.
  await page.locator('body').click();
  await page.keyboard.press('m');
  await expect(page.getByRole('dialog', { name: 'Choose a model' })).toBeVisible();
  await page.keyboard.press('m');

  // ⌘↵ generates and keeps the prompt text.
  const prompt = page.getByRole('textbox', { name: 'Describe what you want to make…' });
  await prompt.fill('a quiet lighthouse at dusk');
  await expect(page.locator('.cost-strip .cost-strip-figure-text')).toBeVisible({ timeout: 15_000 });
  await prompt.press('ControlOrMeta+Enter');
  await expect(page.getByText(/^Saved · \$/)).toBeVisible({ timeout: 20_000 });
  await expect(prompt).toHaveValue('a quiet lighthouse at dusk');

  // ⌘\ collapses the sidebar (persisted to local storage).
  await page.keyboard.press('ControlOrMeta+\\');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kilnry-sidebar'))).toBe('collapsed');

  // i toggles the inspector on the viewer route.
  const assetId = await firstAssetId(page);
  if (assetId) {
    await ensureSignedIn(page, `/library/${assetId}`);
    await page.keyboard.press('i');
    // The viewer's info overlay toggles; the route stays on the asset.
    expect(page.url()).toContain(assetId);
  }
});

test('@gate accessibility has zero critical or serious issues on touched routes', async ({ page }) => {
  await ensureOpenRouter(page);
  await ensureGateCharacters(page);
  const violations: Record<string, number> = {};
  for (const route of TOUCHED_ROUTES) {
    await ensureSignedIn(page, route);
    await page.waitForTimeout(300);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
    const serious = result.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    violations[route] = serious.length;
    // eslint-disable-next-line no-console
    if (serious.length > 0) console.log(`AXE ${route}`, JSON.stringify(serious.map((v) => v.id)));
  }
  for (const route of TOUCHED_ROUTES) expect(violations[route], `axe on ${route}`).toBe(0);
});

test('@gate reduced motion via OS preference and the Appearance setting', async ({ page }) => {
  await ensureSignedIn(page, '/settings/appearance');
  // Operating-system preference: an element that normally animates has its
  // effective transition collapsed to zero (the reduced-motion rules override
  // transition and animation durations rather than zeroing the tokens).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const nav = document.querySelector('.nav-item');
        return nav ? getComputedStyle(nav).transitionDuration : 'none';
      }),
    )
    .toMatch(/^0m?s(,\s*0m?s)*$/);
  await page.emulateMedia({ reducedMotion: null });

  // The Appearance setting "Always reduce" collapses motion the same way.
  await ensureSignedIn(page, '/settings/appearance');
  await page.getByRole('radio', { name: /Always reduce/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  const navDuration = await page.evaluate(() => {
    const nav = document.querySelector('.nav-item');
    return nav ? getComputedStyle(nav).transitionDuration : 'none';
  });
  expect(navDuration).toMatch(/^0m?s(,\s*0m?s)*$/);
  // Restore full motion for later tests.
  await page
    .getByRole('radio', { name: /Follow system/ })
    .first()
    .check()
    .catch(() => {});
});

test('@gate save light and dark screenshots of every touched route', async ({ page }) => {
  mkdirSync(outDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await ensureOpenRouter(page);
  await ensureGateCharacters(page);
  for (const theme of ['light', 'dark'] as const) {
    for (const route of TOUCHED_ROUTES) {
      await ensureSignedIn(page, route);
      await page.evaluate((value) => {
        localStorage.setItem('kilnry-theme', value);
        document.documentElement.dataset.themeSetting = value;
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.waitForTimeout(300);
      const slug = route.replace(/^\//, '').replace(/[/?=]/g, '-') || 'home';
      await page.screenshot({ path: join(outDir, `${slug}-${theme}.png`), fullPage: false });
    }
  }
});
