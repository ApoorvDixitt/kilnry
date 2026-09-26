// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The M6 acceptance scenarios from PRD-21, tagged @m6. They run after AS-01 has
// done the first-run flow so the local account and Library exist, and under the
// strict mock service worker so no real paid request is ever made. Scenarios
// drive the Workflows interface and assert the money facts the plan shows, the
// checkpoint pause, and the files and manifest that land on disk. Direct fetch is
// used only for setup (a seeded product image and provider keys).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const root = process.cwd();
const library = join(root, '.dev', 'e2e-library');
const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
// Constructed, well-shaped keys the adapters' detectors accept; never real.
const FAL_KEY = ['00000000-0000-4000-8000-000000000000', ':', '0'.repeat(32)].join('');
const OPENROUTER_KEY = ['sk-or-v1-', '0'.repeat(64)].join('');

// A well-formed PNG (the same bytes the fal image fixture serves) used as the
// seeded product photo, so the Library probe indexes it cleanly.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAACXBIWXMAAAsTAAALEwEAmpwYAAAFLUlEQVR4nO2b224bVRSGfc3hjQovwFXhNShCQtxw016DuCwSgdKqCT1ElCCaVhUC6iatnbSpjVfaom3XceyMMxjl4HmChdZISChqZJrM9p7xfBdLshI5s2etL3uvw78rSSyKSWl9UAm9AEwAAAiEHQAIhCMACIQcAAiEJBAIhCoACIQyEAiEPgAQCI0gIBA6gUAgtIKBQJgFAIEwDAICYRoIBMI4GAgEPQAQCIIQIBAUQUAgSMKAQNAEFhWCa49u6JmLH+ob58+mdubiOb1RW2QYVAb7+NbnWvnsvVfaJ0tfMAya9f/8yjHB/9du1m56ez6y8DgsALbtTwLgna8+AoBZtTfPn50IwFsX3geAkzr4MHqqo/Z9HT67o/3GD9qtL+jLR1e0s3JJ2w/mUrPP9jP7Xb9xS4fP7urf7Wr63TwA8PaFDwDgdZy616tp1PpZt+rz6qpfn8q26vMatW6nf9PPEXBuIgDvcgRMduR42NDd5/e0W7t66qC7Y6xbm0+fMR42MwPASr1JACzW/ZWDhU8CD4cNHW7eSbdxX4F3R8yeNdy8mz47i3ewUu+44H+69KVX/xUagL/cb9pZnV7g3StA2H3xiyZx69TvYqWeZfuWE5jZtu/zP7/QABz0H2tv/VqwwLsj1lu/nq4ptF9KAcCoU9X2yrfBg+6OmK1p5O4H988MA9BKM/vQgXYTzCqGLI4EAPiPE8ZxK63PQwfX/U+ztY53iwFBpQjB336yGDyo7jVte2OxEBDkHoBB48fgwXSn2AnyfhzkGoAinPlugkVyOxe+LBwA1r8PHTyXkY3c78H9WSgArKZur+av1HMnNHuXg0E++wS5BCBPTR6Xkdk7hfZrIQCI//w1eLCcJ7PWdWj/5hoAG66E7O07z9ZZ/S7TSeLMAWBTvdBBcp7NxCah/ZxLAGyeP82RbrBdYOVSrnaB3ABgQovQwXFTst0X94L7O3cAZCHfKop1a/PB/Z0rAExvFzoobsq2v10P7vfcADALLV9X0BZxpUzbvyVgO80lHbWrut9f1/Hwj9TsswlNBs2lqSWi3bWF4H7PBQCmvfft7PaDbzSS5bTSmLSecdTUaHM5/Y7fdc3pYZSNqLTQAPge+nQeXj7RebvXq+nLh5e9rm3UCS8hCw6A3djxGfyDnY0Tr+1wZ8MrBHloCgUHwJfUy7bwLDLtvV7N23EweGqCkZIDsLW24MW5duZntcZoc9nLGrfWvgcAu5Tpp92aXYI1jppeqgN796TsO4APx+40f8p8nYNm9tpEm3wmZQegXZ3L3LFW52e9zlGnmvk6LbdIyg5A1k4183FNa7+/7mWtof0/kwD4GLeOh00AKAoARYI1YQcojlNdgdZa6iOAtQoAlB3WhB0AABKOAHaAhByAIyAhCSQHSKgCSAITykCqgIQ+AGVgQiOIPkBCJ5BGEK3gmE4gs4CYVjDDoJhZANPAmGEQ4+CYaSB6gJhxMIKQGD0AiqAYQQiSsBhFEJrAGEkYotAYTSBK2xhRaOmVtg5VcLmVtq5Aa0UWDgCKLJwdQJGFcwQosnByAEUWThKoyMKpAhRZOGWgIgunD6DIwmkEaS5k4ZiUuxOICQAAgbADAIFwBACBkAMAgZAEAoFQBQCBUAYCgdAHAAKhEQQEQicQCIRWMBAIswAgEIZBQCBMA4FAGAcDgaAHAAJBEAIEgiIICARJGBAImkAgEEShQCCogoFAkIUDgXAvAAiEiyFAINwMAgLhahgQCHcDgUC4HAoEwu1gIJDUB/8AdbkgI99wwUMAAAAASUVORK5CYII=',
  'base64',
);

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
  const token = await csrf(page);
  await page.evaluate(
    async ({ token, id, key }) => {
      await fetch(`/api/providers/${id}/key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ key, accept_tos: false }),
      });
    },
    { token, id, key },
  );
  await expect.poll(() => providerConnected(page, id), { timeout: 15_000 }).toBe(true);
}

// Place the product photo directly in the Library folder, then reindex it the
// way the doctor does after a file arrives outside the app (setup only).
async function seedProduct(page: Page, folder: string, name: string): Promise<string> {
  const dir = join(library, folder);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), PNG);
  const token = await csrf(page);
  const report = await page.evaluate(
    async ({ token, folder }) => {
      const response = await fetch('/api/library/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ folder }),
      });
      return { status: response.status, body: await response.text() };
    },
    { token, folder },
  );
  // Surface a failed reindex loudly rather than timing out later on an empty id.
  if (report.status !== 200) throw new Error(`reindex ${report.status}: ${report.body}`);
  const relative = join(folder, name);
  // Reindex indexes bare files into their folder; poll until the row appears.
  await expect
    .poll(
      async () =>
        page.evaluate(async (rel) => {
          const top = rel.split('/')[0]!;
          const response = await fetch(
            `/api/library/assets?folder=${encodeURIComponent(top)}&subfolders=1&sort=newest`,
          );
          if (!response.ok) return '';
          const body = (await response.json()) as { assets?: Array<{ id: string; path: string }> };
          return body.assets?.find((asset) => asset.path === rel)?.id ?? '';
        }, relative),
      { timeout: 20_000 },
    )
    .not.toBe('');
  return page.evaluate(async (rel) => {
    const top = rel.split('/')[0]!;
    const response = await fetch(
      `/api/library/assets?folder=${encodeURIComponent(top)}&subfolders=1&sort=newest`,
    );
    if (!response.ok) return '';
    const body = (await response.json()) as { assets?: Array<{ id: string; path: string }> };
    return body.assets?.find((asset) => asset.path === rel)?.id ?? '';
  }, relative);
}

// The run's on-disk folder under the Library, matched by the workflow-name slug.
function findRunFolder(project: string, slugPrefix: string): string | undefined {
  const base = join(library, project);
  if (!existsSync(base)) return undefined;
  const match = readdirSync(base).find((name) => name.startsWith(slugPrefix));
  return match ? join(base, match) : undefined;
}

test.describe('M6 workflows acceptance', () => {
  test('@m6 S-04 UGC ad · product-only pauses at the storyboard checkpoint (golden)', async ({ page }) => {
    test.setTimeout(240_000);
    // Given an onboarded install with fal and OpenRouter fixtures and a product
    // image at Client_A/serum.png.
    await ensureProvider(page, 'fal', FAL_KEY);
    await ensureProvider(page, 'openrouter', OPENROUTER_KEY);
    const productId = await seedProduct(page, 'Client_A', 'serum.png');
    expect(productId).not.toBe('');

    // When the user opens Workflows and runs the UGC ad, fills the intake
    // (product = serum.png, duration 15 s, folder Client_A, product-only) and
    // reviews the Plan.
    await ensureSignedIn(page, '/workflows');
    await page
      .locator('.workflow-row', { hasText: 'UGC ad' })
      .getByRole('button', { name: 'Run' })
      .first()
      .click();
    const drawer = page.locator('.workflow-drawer[data-workflow-id="kilnry-ugc-ad"]');
    await expect(drawer).toBeVisible();
    await drawer.locator('#workflow-folder').fill('Client_A');
    // product-only mode via the segment select for `mode`.
    await drawer.locator('#wf-input-mode').selectOption('product-only');
    // The product photo (media widget renders a text input holding the asset id).
    await drawer.locator('#wf-input-product').fill(productId);
    // duration 15 s (chips widget renders a number input).
    await drawer.locator('#wf-input-duration_s').fill('15');

    // The Plan shows per-step model and cost and a total equal to the sum.
    await drawer.getByRole('button', { name: /Preview the plan/i }).click();
    const stepCosts = drawer.locator('.plan-step-cost');
    await expect.poll(async () => stepCosts.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    const totalText = (await drawer.locator('.workflow-plan-total-amount').textContent()) ?? '';
    const total = Number(totalText.replace(/[^0-9.]/g, ''));
    // The Plan total equals the sum of the per-step costs (S-04's money check),
    // within the rounding of the two-decimal per-step figures the checklist shows.
    const stepCostTexts = await stepCosts.allTextContents();
    const sum = stepCostTexts
      .map((text) => Number(text.replace(/[^0-9.]/g, '')))
      .filter((n) => Number.isFinite(n))
      .reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(Math.abs(total - sum)).toBeLessThanOrEqual(0.1);
    // At least one step names a model chip.
    expect(await drawer.locator('.plan-step-model').count()).toBeGreaterThan(0);

    // Approve (total) starts the run. The run POST drives the workflow to the
    // storyboard checkpoint synchronously, so allow it time under the mock.
    await expect(drawer.locator('.workflow-approve-button')).toBeEnabled();
    await drawer.locator('.workflow-approve-button').click();
    await page.waitForURL(/\/workflows\/runs\/[^/]+$/, { timeout: 150_000 });

    // The run reaches the storyboard checkpoint: the header reads Waiting and the
    // ApprovalCard is at the top of the run view.
    const approvalCard = page.locator('.approval-card');
    await expect(approvalCard).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.run-status-pill')).toHaveText('Waiting');

    // No clip has rendered before approval: every clip generate step is still
    // queued or pending (the wireframe's hollow-dot glyph), never completed. The
    // "no kind=video job" invariant is asserted at unit level; here we assert the
    // interface shows nothing rendered yet past the checkpoint.
    const clipRowsDone = page.locator('.run-step-row[data-status="completed"] .run-step-name', {
      hasText: /Clip/i,
    });
    expect(await clipRowsDone.count()).toBe(0);

    // On the ApprovalCard click Approve; the resume renders the clips and writes
    // the run folder and manifest as it progresses.
    await approvalCard.getByRole('button', { name: /Approve/i }).click();

    // The run folder and manifest appear on disk once clips have rendered past
    // the checkpoint. Poll the folder rather than a live status, since the resume
    // runs server-side and a soft quality-check checkpoint may pause it again.
    const folder = await expect
      .poll(() => findRunFolder('Client_A', 'UGC_ad_'), { timeout: 180_000 })
      .toBeTruthy()
      .then(() => findRunFolder('Client_A', 'UGC_ad_')!);
    const manifestPath = join(folder, 'run.kilnry.json');
    await expect.poll(() => existsSync(manifestPath), { timeout: 60_000 }).toBe(true);

    // The manifest lists the steps run with their actual cost, and clip video
    // steps have now run (they exist in the manifest after approval).
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      steps?: Array<{ step_id?: string; kind?: string; actual_usd?: number; status?: string }>;
    };
    expect(Array.isArray(manifest.steps)).toBe(true);
    expect(manifest.steps!.length).toBeGreaterThan(0);
    for (const step of manifest.steps!) {
      expect(typeof step.actual_usd).toBe('number');
    }
    // At least one clip generate ran after approval (a video step in the manifest).
    const clipRan = manifest.steps!.some((step) => (step.step_id ?? '').includes('clip'));
    expect(clipRan).toBe(true);

    // The header shows "$x.xx so far of ≈ $y.yy" with x ≤ y × 1.1.
    const costLine = (await page.locator('.run-cost').textContent()) ?? '';
    const amounts = costLine.match(/\$([0-9.]+)/g)?.map((a) => Number(a.replace('$', ''))) ?? [];
    if (amounts.length === 2) {
      expect(amounts[0]!).toBeLessThanOrEqual(amounts[1]! * 1.1 + 0.0001);
    }
  });
});
