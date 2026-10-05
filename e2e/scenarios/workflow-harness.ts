// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Shared Playwright helpers for driving a whole workflow run to completion
// (F-WFL-10, F-WFL-08 Group 5 driven checks). The flow mirrors the proven m6
// driver: open the workflow, fill the intake by field id, preview, approve the
// plan total, clear every approval checkpoint through the UI, then read the run
// folder's manifest once it lands on disk. Waits are on the run's own state, not
// timers; a dropped GET/POST under shard load reports status 0 and is retried.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

const root = process.cwd();
export const library = join(root, '.dev', 'e2e-library');

// A tiny valid MP4 and PNG (the same bytes the fal fixtures serve), seeded as
// workflow inputs so the Library probe reads real media.
export const MP4 = Buffer.from(
  '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',
  'base64',
);

export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAACXBIWXMAAAsTAAALEwEAmpwYAAAFLUlEQVR4nO2b224bVRSGfc3hjQovwFXhNShCQtxw016DuCwSgdKqCT1ElCCaVhUC6iatnbSpjVfaom3XceyMMxjl4HmChdZISChqZJrM9p7xfBdLshI5s2etL3uvw78rSSyKSWl9UAm9AEwAAAiEHQAIhCMACIQcAAiEJBAIhCoACIQyEAiEPgAQCI0gIBA6gUAgtIKBQJgFAIEwDAICYRoIBMI4GAgEPQAQCIIQIBAUQUAgSMKAQNAEFhWCa49u6JmLH+ob58+mdubiOb1RW2QYVAb7+NbnWvnsvVfaJ0tfMAya9f/8yjHB/9du1m56ez6y8DgsALbtTwLgna8+AoBZtTfPn50IwFsX3geAkzr4MHqqo/Z9HT67o/3GD9qtL+jLR1e0s3JJ2w/mUrPP9jP7Xb9xS4fP7urf7Wr63TwA8PaFDwDgdZy616tp1PpZt+rz6qpfn8q26vMatW6nf9PPEXBuIgDvcgRMduR42NDd5/e0W7t66qC7Y6xbm0+fMR42MwPASr1JACzW/ZWDhU8CD4cNHW7eSbdxX4F3R8yeNdy8mz47i3ewUu+44H+69KVX/xUagL/cb9pZnV7g3StA2H3xiyZx69TvYqWeZfuWE5jZtu/zP7/QABz0H2tv/VqwwLsj1lu/nq4ptF9KAcCoU9X2yrfBg+6OmK1p5O4H988MA9BKM/vQgXYTzCqGLI4EAPiPE8ZxK63PQwfX/U+ztY53iwFBpQjB336yGDyo7jVte2OxEBDkHoBB48fgwXSn2AnyfhzkGoAinPlugkVyOxe+LBwA1r8PHTyXkY3c78H9WSgArKZur+av1HMnNHuXg0E++wS5BCBPTR6Xkdk7hfZrIQCI//w1eLCcJ7PWdWj/5hoAG66E7O07z9ZZ/S7TSeLMAWBTvdBBcp7NxCah/ZxLAGyeP82RbrBdYOVSrnaB3ABgQovQwXFTst0X94L7O3cAZCHfKop1a/PB/Z0rAExvFzoobsq2v10P7vfcADALLV9X0BZxpUzbvyVgO80lHbWrut9f1/Hwj9TsswlNBs2lqSWi3bWF4H7PBQCmvfft7PaDbzSS5bTSmLSecdTUaHM5/Y7fdc3pYZSNqLTQAPge+nQeXj7RebvXq+nLh5e9rm3UCS8hCw6A3djxGfyDnY0Tr+1wZ8MrBHloCgUHwJfUy7bwLDLtvV7N23EweGqCkZIDsLW24MW5duZntcZoc9nLGrfWvgcAu5Tpp92aXYI1jppeqgN796TsO4APx+40f8p8nYNm9tpEm3wmZQegXZ3L3LFW52e9zlGnmvk6LbdIyg5A1k4183FNa7+/7mWtof0/kwD4GLeOh00AKAoARYI1YQcojlNdgdZa6iOAtQoAlB3WhB0AABKOAHaAhByAIyAhCSQHSKgCSAITykCqgIQ+AGVgQiOIPkBCJ5BGEK3gmE4gs4CYVjDDoJhZANPAmGEQ4+CYaSB6gJhxMIKQGD0AiqAYQQiSsBhFEJrAGEkYotAYTSBK2xhRaOmVtg5VcLmVtq5Aa0UWDgCKLJwdQJGFcwQosnByAEUWThKoyMKpAhRZOGWgIgunD6DIwmkEaS5k4ZiUuxOICQAAgbADAIFwBACBkAMAgZAEAoFQBQCBUAYCgdAHAAKhEQQEQicQCIRWMBAIswAgEIZBQCBMA4FAGAcDgaAHAAJBEAIEgiIICARJGBAImkAgEEShQCCogoFAkIUDgXAvAAiEiyFAINwMAgLhahgQCHcDgUC4HAoEwu1gIJDUB/8AdbkgI99wwUMAAAAASUVORK5CYII=',
  'base64',
);

export interface ManifestStep {
  step_id?: string;
  kind?: string;
  actual_usd?: number;
  status?: string;
  outputs?: { assets?: Array<{ asset_id?: string; path?: string }> };
}

export interface RunManifest {
  estimate_usd?: number;
  spent_usd?: number;
  status?: string;
  steps?: ManifestStep[];
  outputs?: { final?: string; [key: string]: unknown };
}

interface RunView {
  status: string;
  steps: Array<{ step_id: string; status: string; error?: string | null }>;
}

export function findRunFolder(project: string, slugPrefix: string): string | undefined {
  const base = join(library, project);
  if (!existsSync(base)) return undefined;
  const match = readdirSync(base).find((name) => name.startsWith(slugPrefix));
  return match ? join(base, match) : undefined;
}

export function completedOfKind(manifest: RunManifest, kind: string): number {
  return (manifest.steps ?? []).filter((step) => step.kind === kind && step.status === 'completed').length;
}

// Probe an mp4 in the folder with ffprobe and return its real duration (>0).
export function probeDuration(folder: string, named: string): number {
  const ffprobe = process.env.KILNRY_FFPROBE ?? 'ffprobe';
  expect(existsSync(join(folder, named)), `the run folder has ${named}`).toBe(true);
  const out = execFileSync(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(folder, named)],
    { encoding: 'utf8' },
  ).trim();
  const duration = Number(out);
  expect(Number.isFinite(duration) && duration > 0, `${named} has a real duration (got ${out})`).toBe(true);
  return duration;
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

// Write a looped clip of `seconds` (≥4) from the 1 s MP4 fixture into the
// Library using the e2e ffmpeg, so a workflow that needs a 4–30 s source (Ad
// Multiplier) gets a real, probeable clip. Returns its asset id.
export async function seedLoopedVideo(
  page: Page,
  folder: string,
  name: string,
  seconds: number,
): Promise<string> {
  const ffmpeg = process.env.KILNRY_FFMPEG ?? 'ffmpeg';
  const dir = join(library, folder);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const srcPath = join(dir, `.src-${name}`);
  writeFileSync(srcPath, MP4);
  const outPath = join(dir, name);
  execFileSync(
    ffmpeg,
    ['-y', '-stream_loop', '-1', '-i', srcPath, '-t', String(seconds), '-c', 'copy', outPath],
    { stdio: 'ignore' },
  );
  // Reindex the folder so the clip is a Library asset, then return its id.
  const token = await csrf(page);
  const report = await page.evaluate(
    async ({ token, folder }) => {
      const response = await fetch('/api/library/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ folder }),
      });
      return response.status;
    },
    { token, folder },
  );
  if (report !== 200) throw new Error(`reindex ${report}`);
  const relative = join(folder, name);
  return expect
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
    .not.toBe('')
    .then(() =>
      page.evaluate(async (rel) => {
        const top = rel.split('/')[0]!;
        const response = await fetch(
          `/api/library/assets?folder=${encodeURIComponent(top)}&subfolders=1&sort=newest`,
        );
        const body = (await response.json()) as { assets?: Array<{ id: string; path: string }> };
        return body.assets?.find((asset) => asset.path === rel)?.id ?? '';
      }, relative),
    );
}

// Place a media file directly in the Library folder and reindex it (setup only).
export async function seedLibraryFile(
  page: Page,
  folder: string,
  name: string,
  bytes: Buffer,
): Promise<string> {
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
  return expect
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
    .not.toBe('')
    .then(() =>
      page.evaluate(async (rel) => {
        const top = rel.split('/')[0]!;
        const response = await fetch(
          `/api/library/assets?folder=${encodeURIComponent(top)}&subfolders=1&sort=newest`,
        );
        const body = (await response.json()) as { assets?: Array<{ id: string; path: string }> };
        return body.assets?.find((asset) => asset.path === rel)?.id ?? '';
      }, relative),
    );
}

// Fill a workflow's intake, preview, approve the plan, clear every checkpoint,
// and return the run id and the run folder's manifest once it lands on disk.
export async function driveWorkflowRun(
  page: Page,
  options: {
    workflowId: string;
    folder: string;
    slugPrefix: string;
    inputs: Record<string, string | number>;
  },
): Promise<{ runId: string; folder: string; manifest: RunManifest }> {
  await page.goto('/workflows');
  await page
    .locator(`.workflow-row[data-workflow-id="${options.workflowId}"]`)
    .getByRole('button', { name: 'Run' })
    .first()
    .click();
  const drawer = page.locator(`.workflow-drawer[data-workflow-id="${options.workflowId}"]`);
  await expect(drawer).toBeVisible();
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

  const runId = new URL(page.url()).pathname.split('/').at(-1)!;
  const readRun = async (): Promise<RunView | 'rendering'> => {
    const answer = await page.evaluate(async (id) => {
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(id)}`);
        return { status: response.status, body: await response.text() };
      } catch {
        return { status: 0, body: '' };
      }
    }, runId);
    if (answer.status === 0) return 'rendering';
    if (answer.status !== 200) {
      throw new Error(`GET /api/runs/${runId} answered ${answer.status}: ${answer.body.slice(0, 300)}`);
    }
    return (JSON.parse(answer.body) as { run: RunView }).run;
  };
  const card = page.locator('.approval-card');
  for (;;) {
    await expect
      .poll(
        async () => {
          const view = await readRun();
          return view === 'rendering' ? 'rendering' : view.status;
        },
        { timeout: 420_000, intervals: [2_000] },
      )
      .toMatch(/^(awaiting_approval|completed|failed|cancelled)$/);
    const run = await readRun();
    if (run === 'rendering') continue;
    if (run.status === 'completed') break;
    if (run.status !== 'awaiting_approval') {
      const errors = run.steps
        .filter((step) => step.status === 'failed')
        .map((step) => `${step.step_id}: ${step.error ?? 'failed'}`);
      throw new Error(`The ${options.workflowId} run ended ${run.status}. ${errors.join('; ')}`);
    }
    const waiting = run.steps.find((step) => step.status === 'waiting');
    expect(waiting, 'a run awaiting approval has a waiting step').toBeDefined();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole('button', { name: /Approve/i })).toBeVisible();
    await expect
      .poll(
        async () => {
          const answer = await page.evaluate(async (id) => {
            const token = decodeURIComponent(
              document.cookie
                .split(';')
                .map((part) => part.trim())
                .find((part) => part.startsWith('kilnry_csrf='))
                ?.slice('kilnry_csrf='.length) ?? '',
            );
            try {
              const response = await fetch(`/api/runs/${encodeURIComponent(id)}/approve`, {
                method: 'POST',
                headers: { 'X-Kilnry-CSRF': token },
              });
              return { status: response.status, body: await response.text() };
            } catch {
              return { status: 0, body: '' };
            }
          }, runId);
          if (answer.status === 0 || answer.status === 429) return false;
          if (answer.status !== 200)
            throw new Error(`approve ${answer.status}: ${answer.body.slice(0, 200)}`);
          return true;
        },
        { timeout: 90_000, intervals: [3_000] },
      )
      .toBe(true);
    await expect
      .poll(
        async () => {
          const next = await readRun();
          if (next === 'rendering') return false;
          const same = next.steps.find((step) => step.step_id === waiting!.step_id);
          return same?.status !== 'waiting' || next.status === 'completed' || next.status === 'failed';
        },
        { timeout: 420_000, intervals: [2_000] },
      )
      .toBe(true);
  }
  const folder = findRunFolder(options.folder, options.slugPrefix);
  expect(folder, `the ${options.workflowId} run folder`).toBeTruthy();
  const manifestPath = join(folder!, 'run.kilnry.json');
  await expect
    .poll(
      () =>
        existsSync(manifestPath)
          ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as RunManifest).status
          : undefined,
      { timeout: 180_000, intervals: [2_000] },
    )
    .toBe('completed');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RunManifest;
  return { runId, folder: folder!, manifest };
}
