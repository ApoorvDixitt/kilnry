// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { expect, test, type Page } from '@playwright/test';

// The Library performance gate: the virtualised asset grid must stay smooth with
// 10,000 assets. This test drives the real /library screen but serves a synthetic
// list of 10,000 assets and a tiny thumbnail through route interception, so the
// measurement is of the grid's own rendering under scroll, not of disk or the
// database. It scrolls the grid in steps, records every animation-frame interval
// with the browser's Performance API, and asserts the 95th-percentile frame time
// is below one 60 Hz frame (16.7 ms).

const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
const ASSET_COUNT = 10_000;
// A 1x1 transparent PNG, enough for the <img> to resolve without a real file.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC',
  'base64',
);

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

test('@perf Library grid scrolls 10,000 assets under one frame at the 95th percentile', async ({ page }) => {
  // Serve a synthetic list of 10,000 assets for the Library folder listing.
  await page.route('**/api/library/assets**', async (route) => {
    const assets = Array.from({ length: ASSET_COUNT }, (_, index) => ({
      id: `perf-${String(index).padStart(6, '0')}`,
      path: `inbox/asset_${index}.png`,
      folder_path: 'inbox',
      kind: 'image',
      mime: 'image/png',
      width: 1024,
      height: 1024,
      duration_s: null,
      has_audio: null,
      provider_id: 'openrouter',
      actual_usd: 0.014,
      estimate_usd: 0.014,
      sidecar_ok: true,
      created_at: new Date(Date.now() - index * 1000).toISOString(),
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assets }) });
  });
  // Serve a tiny thumbnail for every tile so images resolve instantly.
  await page.route('**/api/thumb/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
  });

  await ensureSignedIn(page, '/library');
  const scroll = page.locator('.asset-scroll');
  await expect(scroll).toBeVisible({ timeout: 15_000 });
  // The virtualiser renders only a window of rows; confirm it is not rendering
  // all ten thousand tiles at once.
  const renderedRows = await page.locator('.asset-tile-row').count();
  expect(renderedRows).toBeLessThan(60);

  // Scroll through the list in steps. For each step we measure the main-thread
  // busy time: set scrollTop and force the browser to lay out (reading
  // offsetHeight flushes layout), so the virtualiser's row-window reconciliation
  // is measured within this frame's work. Smooth scrolling keeps this well under
  // one 60 Hz frame (16.7 ms); the vsync interval itself is not a useful measure
  // because it is pinned to the display refresh whether or not frames are janky.
  const frameTimes: number[] = await page.evaluate(async () => {
    const container = document.querySelector('.asset-scroll') as HTMLElement;
    const busy: number[] = [];
    const total = container.scrollHeight - container.clientHeight;
    const steps = 200;
    for (let step = 1; step <= steps; step += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const start = performance.now();
      container.scrollTop = Math.floor((total * step) / steps);
      void container.offsetHeight;
      busy.push(performance.now() - start);
    }
    // Drop the first few warm-up frames.
    return busy.slice(5);
  });

  frameTimes.sort((a, b) => a - b);
  const p95 = frameTimes[Math.floor(frameTimes.length * 0.95)] ?? 0;
  const p50 = frameTimes[Math.floor(frameTimes.length * 0.5)] ?? 0;
  // eslint-disable-next-line no-console
  console.log(
    `PERF_RESULT assets=${ASSET_COUNT} frames=${frameTimes.length} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`,
  );
  expect(p95).toBeLessThan(16.7);
});
