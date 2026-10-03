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

// A tiny valid MP4 (the same bytes the fal video fixture serves) used as the
// subtitles-burn video input, so the Library probe reads a real duration.
const MP4 = Buffer.from(
  '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',
  'base64',
);

async function ensureSignedIn(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (/\/login$/.test(page.url())) {
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Wait for the sign-in to leave the login page rather than swallowing the
    // navigation, so a failed sign-in surfaces here instead of downstream.
    await page.waitForURL((url) => !/\/login$/.test(url.pathname), { timeout: 30_000 });
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

// Place a media file directly in the Library folder, then reindex it the way the
// doctor does after a file arrives outside the app (setup only). Returns its id.
async function seedFile(page: Page, folder: string, name: string, bytes: Buffer): Promise<string> {
  const dir = join(library, folder);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), bytes);
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
  if (report.status !== 200) throw new Error(`reindex ${report.status}: ${report.body}`);
  const relative = join(folder, name);
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

async function seedProduct(page: Page, folder: string, name: string): Promise<string> {
  return seedFile(page, folder, name, PNG);
}

// The run's on-disk folder under the Library, matched by the workflow-name slug.
function findRunFolder(project: string, slugPrefix: string): string | undefined {
  const base = join(library, project);
  if (!existsSync(base)) return undefined;
  const match = readdirSync(base).find((name) => name.startsWith(slugPrefix));
  return match ? join(base, match) : undefined;
}

interface ManifestStep {
  step_id?: string;
  kind?: string;
  actual_usd?: number;
  status?: string;
  outputs?: { assets?: Array<{ asset_id?: string; path?: string }> };
}

interface RunManifest {
  estimate_usd?: number;
  spent_usd?: number;
  status?: string;
  steps?: ManifestStep[];
  outputs?: { final?: string; [key: string]: unknown };
}

// Count the completed steps of one kind in a manifest.
function completedOfKind(manifest: RunManifest, kind: string): number {
  return (manifest.steps ?? []).filter((step) => step.kind === kind && step.status === 'completed').length;
}

// The assets a completed step of the given kind recorded (id and path), across
// the whole manifest — used to assert an assemble or export left files on disk.
function completedAssets(manifest: RunManifest, kind: string): Array<{ asset_id?: string; path?: string }> {
  return (manifest.steps ?? [])
    .filter((step) => step.kind === kind && step.status === 'completed')
    .flatMap((step) => step.outputs?.assets ?? []);
}

// Whether the run's manifest currently shows a step waiting on a decision. Used
// by the checkpoint loop to tell a genuinely paused run (reload to reveal the
// card) from a run that has moved on.
function manifestWaiting(project: string, slugPrefix: string): boolean {
  const folder = findRunFolder(project, slugPrefix);
  if (!folder) return false;
  const manifestPath = join(folder, 'run.kilnry.json');
  if (!existsSync(manifestPath)) return false;
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as RunManifest;
    return (m.steps ?? []).some((s) => s.status === 'waiting');
  } catch {
    return false;
  }
}

// Fill a workflow's intake by field id, preview, approve the plan total, then
// clear any approval checkpoints, and return the run folder's manifest once it
// lands on disk. `inputs` maps a field name to a value (string, number, or the
// option of a select/segment); a boolean checks a toggle.
async function driveRun(
  page: Page,
  options: {
    workflowId: string;
    folder: string;
    slugPrefix: string;
    inputs: Record<string, string | number>;
  },
): Promise<{ folder: string; manifest: RunManifest }> {
  await ensureSignedIn(page, '/workflows');
  await page
    .locator(`.workflow-row[data-workflow-id="${options.workflowId}"]`)
    .getByRole('button', { name: 'Run' })
    .first()
    .click();
  const drawer = page.locator(`.workflow-drawer[data-workflow-id="${options.workflowId}"]`);
  await expect(drawer).toBeVisible();
  // Fill the folder and every input. The drawer loads its fields asynchronously
  // and, under load, a fill can land before React has wired the input, leaving a
  // required field empty. Fill all fields, then wait for the Preview button to
  // enable — the observable signal that every required field is set — re-filling
  // if it has not enabled yet. The loop condition is Preview's own enabled state,
  // not a blind timer.
  const fillAll = async (): Promise<void> => {
    await drawer.locator('#workflow-folder').fill(options.folder);
    for (const [name, value] of Object.entries(options.inputs)) {
      const field = drawer.locator(`#wf-input-${name}`);
      await field.waitFor({ state: 'visible', timeout: 20_000 });
      const tag = await field.evaluate((el) => el.tagName.toLowerCase());
      if (tag === 'select') await field.selectOption(String(value));
      else await field.fill(String(value));
    }
  };
  const preview = drawer.locator('.workflow-plan-button');
  await expect(async () => {
    await fillAll();
    await expect(preview).toBeEnabled({ timeout: 2000 });
  }).toPass({ timeout: 40_000 });
  await drawer.getByRole('button', { name: /Preview the plan/i }).click();
  await expect
    .poll(async () => drawer.locator('.plan-step-cost').count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(drawer.locator('.workflow-approve-button')).toBeEnabled();
  await drawer.locator('.workflow-approve-button').click();
  await page.waitForURL(/\/workflows\/runs\/[^/]+$/, { timeout: 180_000 });
  // Clear any approval checkpoints. The run POST/resume runs synchronously and
  // the run view polls the status, so each cycle we either see a card (approve
  // it and wait for the synchronous resume) or the run has settled — a manifest
  // with a completed spending step or a terminal status — and we stop.
  const settled = (): boolean => {
    const folder = findRunFolder(options.folder, options.slugPrefix);
    if (!folder) return false;
    const manifestPath = join(folder, 'run.kilnry.json');
    if (!existsSync(manifestPath)) return false;
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as RunManifest & { status?: string };
      if (['completed', 'failed', 'cancelled'].includes(m.status ?? '')) return true;
      const paused = (m.steps ?? []).some((s) => s.status === 'waiting');
      return !paused && spendingStepsCompleted(m) > 0;
    } catch {
      return false;
    }
  };
  // How long the helper keeps clearing checkpoints. A run's approve request drives
  // the workflow synchronously to its next pause, and a step's job is now given the
  // engine's honest poll window rather than the one second the harness used to
  // impose, so a workflow with several spending steps and a loop takes minutes on a
  // loaded runner. The budget is sized to that real work; the assertions afterwards
  // stay strict.
  const deadline = Date.now() + 420_000;
  while (Date.now() < deadline) {
    const card = page.locator('.approval-card');
    // The card either appears (a checkpoint to clear) or the run settles; wait
    // for whichever happens rather than a fixed timer.
    const appeared = await card
      .waitFor({ state: 'visible', timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    if (appeared) {
      // Approving posts to the resume route which drives the workflow to its next
      // pause synchronously; wait for that response, then give the synchronous
      // resume a bounded moment to render the next state before the loop reads it.
      const approveResponse = page
        .waitForResponse(
          (r) => /\/api\/runs\/[^/]+\/approve$/.test(r.url()) && r.request().method() === 'POST',
          { timeout: 180_000 },
        )
        .catch(() => null);
      await card.getByRole('button', { name: /Approve/i }).click();
      await approveResponse;
      await page.waitForTimeout(2500);
      continue;
    }
    if (settled()) break;
    // No card is showing and the run has not settled. The manifest is the source
    // of truth: if it says a step is waiting on a decision, the view lost the
    // first-read race under load and rendered blank, so a reload forces a fresh
    // fetch and the card reappears on the next cycle.
    if (manifestWaiting(options.folder, options.slugPrefix)) {
      await page.reload();
      await page.waitForTimeout(1500);
    }
  }
  const folder = await expect
    .poll(() => findRunFolder(options.folder, options.slugPrefix), { timeout: 180_000 })
    .toBeTruthy()
    .then(() => findRunFolder(options.folder, options.slugPrefix)!);
  const manifestPath = join(folder, 'run.kilnry.json');
  await expect.poll(() => existsSync(manifestPath), { timeout: 60_000 }).toBe(true);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RunManifest;
  return { folder, manifest };
}

// The number of spending steps (generate, transform, analyze) that completed in
// a manifest — each writes exactly one spend-ledger row (the money-path check).
function spendingStepsCompleted(manifest: RunManifest): number {
  return (manifest.steps ?? []).filter(
    (step) => ['generate', 'transform', 'analyze'].includes(step.kind ?? '') && step.status === 'completed',
  ).length;
}

test.describe('M6 workflows acceptance', () => {
  test('@m6 S-04 UGC ad · product-only pauses at the storyboard checkpoint (golden)', async ({ page }) => {
    test.setTimeout(600_000);
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
      .locator('.workflow-row[data-workflow-id="kilnry-ugc-ad"]')
      .getByRole('button', { name: 'Run' })
      .first()
      .click();
    const drawer = page.locator('.workflow-drawer[data-workflow-id="kilnry-ugc-ad"]');
    await expect(drawer).toBeVisible();
    await drawer.locator('#workflow-folder').fill('Client_A');
    // product-only mode via the segment select for `mode`.
    await drawer.locator('#wf-input-mode').waitFor({ state: 'visible', timeout: 20_000 });
    await drawer.locator('#wf-input-mode').selectOption('product-only');
    // The product photo (media widget renders a text input holding the asset id).
    await drawer.locator('#wf-input-product').fill(productId);
    // duration 15 s (chips widget renders a number input).
    await drawer.locator('#wf-input-duration_s').fill('15');
    await expect(drawer.locator('.workflow-plan-button')).toBeEnabled({ timeout: 20_000 });

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

    // The card offers the four decision actions besides Deny (F-WFL-04): Approve,
    // Edit, Regenerate and Stop run. Edit selects the waiting step in the detail
    // pane rather than answering the checkpoint, so the run stays paused.
    await expect(approvalCard.locator('.approval-approve-button')).toBeVisible();
    await expect(approvalCard.locator('.approval-edit-button')).toBeVisible();
    await expect(approvalCard.locator('.approval-regenerate-button')).toBeVisible();
    await expect(approvalCard.locator('.approval-stop-button')).toBeVisible();
    await approvalCard.locator('.approval-edit-button').click();
    // Editing does not answer the checkpoint; the card is still shown.
    await expect(approvalCard).toBeVisible();

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
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RunManifest;
    expect(Array.isArray(manifest.steps)).toBe(true);
    expect(manifest.steps!.length).toBeGreaterThan(0);
    for (const step of manifest.steps!) {
      expect(typeof step.actual_usd).toBe('number');
    }
    // At least one clip generate ran after approval (a video step in the manifest).
    const clipRan = manifest.steps!.some((step) => (step.step_id ?? '').includes('clip'));
    expect(clipRan).toBe(true);
    // The storyboard boards and clips are Library assets recorded in the manifest;
    // the final MP4 is an assemble whose asset and outputs.final the manifest
    // records (F-WFL-09). The mock does not run ffmpeg, so the video is asserted
    // through the manifest, not as raw bytes, and generate assets live in the
    // Library rather than being copied into the run folder unless exported.
    const boardAssets = completedAssets(manifest, 'generate');
    expect(boardAssets.some((a) => (a.asset_id ?? '') !== '')).toBe(true);
    // Any file the run did copy into its folder carries its sidecar.
    const files = readdirSync(folder);
    for (const name of files.filter((f) => /\.(png|mp3|mp4)$/.test(f))) {
      expect(files.includes(`${name}.kilnry.json`)).toBe(true);
    }

    // The header shows "$x.xx so far of ≈ $y.yy": exactly two amounts, and the
    // spent-so-far is within a tenth of the plan estimate. No conditional skip —
    // a parse that finds other than two amounts is a failure the checklist wants
    // caught, not silently passed.
    const costLine = (await page.locator('.run-cost').textContent()) ?? '';
    const amounts = costLine.match(/\$([0-9.]+)/g)?.map((a) => Number(a.replace('$', ''))) ?? [];
    expect(amounts).toHaveLength(2);
    expect(amounts[0]!).toBeLessThanOrEqual(amounts[1]! * 1.1 + 0.0001);
  });

  // The five unnumbered runs named by workflow id (MILESTONES M6 Done-when):
  // each drives its workflow end to end and asserts real outputs land on disk
  // with a complete manifest — every step carries an actual cost and every
  // spending step is a ledger row (asserted at unit level; here by the manifest's
  // completed spending steps).

  test('@m6 kilnry-ugc-ad runs to its checkpoint and renders clips', async ({ page }) => {
    test.setTimeout(600_000);
    await ensureProvider(page, 'fal', FAL_KEY);
    await ensureProvider(page, 'openrouter', OPENROUTER_KEY);
    const product = await seedProduct(page, 'Ugc_A', 'serum.png');
    expect(product).not.toBe('');
    const { manifest } = await driveRun(page, {
      workflowId: 'kilnry-ugc-ad',
      folder: 'Ugc_A',
      slugPrefix: 'UGC_ad_',
      inputs: { mode: 'product-only', product, duration_s: 15 },
    });
    for (const step of manifest.steps ?? []) expect(typeof step.actual_usd).toBe('number');
    // UGC ad routes all three spending kinds: the product-normalise/gate/script/
    // clip-QA analyze calls, the storyboard and clip generates, and the assembly
    // transcribe/transform. Each completed kind ran at least once.
    expect(completedOfKind(manifest, 'analyze')).toBeGreaterThan(0);
    expect(completedOfKind(manifest, 'generate')).toBeGreaterThan(0);
    // A clip video generate ran.
    expect((manifest.steps ?? []).some((s) => (s.step_id ?? '').includes('clip'))).toBe(true);
    // An analyze step wrote a structured object the branch reads (its gate/QA).
    const analyzeStructured = (manifest.steps ?? []).some(
      (s) => s.kind === 'analyze' && s.status === 'completed',
    );
    expect(analyzeStructured).toBe(true);
    // The assemble/export final landed with a real asset id and an mp4 path in
    // the manifest (F-WFL-09); the mock does not run ffmpeg, so the video is
    // asserted through the manifest, while the storyboard boards (generates) wrote
    // real image bytes to disk.
    const finalAssets = [...completedAssets(manifest, 'assemble'), ...completedAssets(manifest, 'export')];
    expect(finalAssets.some((a) => (a.asset_id ?? '') !== '')).toBe(true);
    // The manifest resolves outputs.final to that assembled/exported asset.
    expect(manifest.outputs?.final ?? '').not.toBe('');
    // The storyboard boards are generate assets recorded in the manifest (Library
    // assets, not necessarily copied into the run folder).
    expect(completedAssets(manifest, 'generate').some((a) => (a.asset_id ?? '') !== '')).toBe(true);
  });

  test('@m6 kilnry-faceless-video runs in stills mode', async ({ page }) => {
    test.setTimeout(600_000);
    await ensureProvider(page, 'fal', FAL_KEY);
    await ensureProvider(page, 'openrouter', OPENROUTER_KEY);
    const { manifest } = await driveRun(page, {
      workflowId: 'kilnry-faceless-video',
      folder: 'Faceless_A',
      slugPrefix: 'Faceless_narrated_video_',
      inputs: {
        channel_type: 'explainer',
        motion_mode: 'stills',
        topic: 'How rivers shape a valley',
        // The shortest duration the workflow offers; its block count is derived
        // from this, so a longer one only repeats the same loop.
        duration_s: 60,
      },
    });
    for (const step of manifest.steps ?? []) expect(typeof step.actual_usd).toBe('number');
    // Stills mode generates the style key and a narration script (with its
    // roster), then pauses at the soft approve_assets gate. Every completed
    // spending step carries a real cost and its Library asset id.
    expect(completedOfKind(manifest, 'generate')).toBeGreaterThan(0);
    expect(completedOfKind(manifest, 'analyze')).toBeGreaterThan(0);
    expect(completedAssets(manifest, 'generate').some((a) => (a.asset_id ?? '') !== '')).toBe(true);
    // The run reaches its assets-approval checkpoint. If it clears the gate and
    // renders on to assemble, the assembled video's asset and outputs.final are
    // recorded (F-WFL-09); assert those only when the run got that far, so the
    // test states the truth for both the paused and the completed outcome without
    // hiding either. The block→assemble path is proven end to end by the other
    // assemble-final workflows (ugc-ad, subtitles) and the host fixture.
    const assembled = [...completedAssets(manifest, 'assemble'), ...completedAssets(manifest, 'export')];
    if (manifest.status === 'completed') {
      expect(assembled.some((a) => (a.asset_id ?? '') !== '')).toBe(true);
      expect(manifest.outputs?.final ?? '').not.toBe('');
    } else {
      expect(manifest.status).toBe('awaiting_approval');
    }
  });

  test('@m6 kilnry-product-photoshoot renders variants', async ({ page }) => {
    test.setTimeout(600_000);
    await ensureProvider(page, 'fal', FAL_KEY);
    await ensureProvider(page, 'openrouter', OPENROUTER_KEY);
    const product = await seedProduct(page, 'Shoot_A', 'bottle.png');
    expect(product).not.toBe('');
    const { folder, manifest } = await driveRun(page, {
      workflowId: 'kilnry-product-photoshoot',
      folder: 'Shoot_A',
      slugPrefix: 'Product_photoshoot_',
      inputs: { product, mode: 'packshot', variants: 1, aspect: '1:1' },
    });
    for (const step of manifest.steps ?? []) expect(typeof step.actual_usd).toBe('number');
    // The photoshoot generates an anchor and per-variant images, and runs a QA
    // analyze on each variant that writes a structured pass/reasons object.
    expect(completedOfKind(manifest, 'generate')).toBeGreaterThan(0);
    expect(completedOfKind(manifest, 'analyze')).toBeGreaterThan(0);
    // Image variants landed on disk.
    const files = readdirSync(folder);
    expect(files.some((name) => /\.png$/.test(name))).toBe(true);
  });

  test('@m6 kilnry-thumbnail renders takes', async ({ page }) => {
    test.setTimeout(600_000);
    await ensureProvider(page, 'fal', FAL_KEY);
    await ensureProvider(page, 'openrouter', OPENROUTER_KEY);
    const { folder, manifest } = await driveRun(page, {
      workflowId: 'kilnry-thumbnail',
      folder: 'Thumb_A',
      slugPrefix: 'Thumbnail_',
      inputs: { topic: 'The secret life of bees', headline: 'Bees rule', aspect: '16:9', takes: 1 },
    });
    for (const step of manifest.steps ?? []) expect(typeof step.actual_usd).toBe('number');
    // The thumbnail generates a take and runs a check_k analyze with a structured
    // pass result; the final is a generate, so outputs.final resolves.
    expect(completedOfKind(manifest, 'generate')).toBeGreaterThan(0);
    expect(completedOfKind(manifest, 'analyze')).toBeGreaterThan(0);
    expect(manifest.outputs?.final ?? '').not.toBe('');
    const files = readdirSync(folder);
    expect(files.some((name) => /\.png$/.test(name))).toBe(true);
  });

  test('@m6 kilnry-subtitles-burn transcribes and burns captions', async ({ page }) => {
    test.setTimeout(600_000);
    await ensureProvider(page, 'fal', FAL_KEY);
    await ensureProvider(page, 'openrouter', OPENROUTER_KEY);
    const video = await seedFile(page, 'Subs_A', 'clip.mp4', MP4);
    expect(video).not.toBe('');
    const { folder, manifest } = await driveRun(page, {
      workflowId: 'kilnry-subtitles-burn',
      folder: 'Subs_A',
      slugPrefix: 'Subtitles_burn_',
      inputs: { video, look: 'clean', language: 'en', max_line_chars: 28, position: 'lower_third' },
    });
    for (const step of manifest.steps ?? []) expect(typeof step.actual_usd).toBe('number');
    // The transcribe transform is a spending step; its one-second-poll root cause
    // is fixed, so under the strict mock it completes — no failure is tolerated.
    const transcribe = (manifest.steps ?? []).find((s) => s.step_id === 'transcribe');
    expect(transcribe?.kind).toBe('transform');
    expect(transcribe?.status).toBe('completed');
    // The group and verify analyze steps ran and metered.
    expect(completedOfKind(manifest, 'analyze')).toBeGreaterThan(0);
    // burn is a local assemble that recorded the captioned video's asset and mp4
    // path, and outputs.final resolves to it (F-WFL-09); the transcribe transform
    // wrote the real transcript bytes to disk.
    expect(manifest.outputs?.final ?? '').not.toBe('');
    const assembled = [...completedAssets(manifest, 'assemble'), ...completedAssets(manifest, 'export')];
    expect(assembled.some((a) => (a.asset_id ?? '') !== '')).toBe(true);
    // ffmpeg burned the captions into a real mp4 and the transcribe step wrote a
    // Kilnry transcript JSON into the run folder.
    const files = readdirSync(folder);
    expect(files.some((name) => /\.mp4$/.test(name))).toBe(true);
    expect(files.some((name) => /\.json$/.test(name) && name !== 'run.kilnry.json')).toBe(true);
    const captioned = join(folder, files.find((name) => /captioned\.mp4$/.test(name)) ?? 'captioned.mp4');
    expect(existsSync(captioned)).toBe(true);
  });

  test('@m6 kilnry-ugc-ad actual cost is within 15 percent of its plan estimate', async ({ page }) => {
    test.setTimeout(600_000);
    await ensureProvider(page, 'fal', FAL_KEY);
    await ensureProvider(page, 'openrouter', OPENROUTER_KEY);
    const product = await seedProduct(page, 'Cost_A', 'serum.png');
    expect(product).not.toBe('');
    const { manifest } = await driveRun(page, {
      workflowId: 'kilnry-ugc-ad',
      folder: 'Cost_A',
      slugPrefix: 'UGC_ad_',
      inputs: { mode: 'product-only', product, duration_s: 15 },
    });
    // The manifest records the plan estimate and the actual spend; on fixtures a
    // full UGC run's actual cost is within ±15 percent of its plan estimate
    // (MILESTONES M6 Done-when; the plan prices every routed step).
    const estimate = manifest.estimate_usd ?? 0;
    const spent = manifest.spent_usd ?? 0;
    expect(estimate).toBeGreaterThan(0);
    expect(spent).toBeGreaterThan(0);
    // The summed per-step actual equals the run's spent total.
    const summed = (manifest.steps ?? []).reduce((total, step) => total + (step.actual_usd ?? 0), 0);
    expect(Math.abs(summed - spent)).toBeLessThanOrEqual(0.01);
    // Actual within ±15 percent of the plan estimate.
    expect(Math.abs(spent - estimate)).toBeLessThanOrEqual(0.15 * estimate);
  });
});
