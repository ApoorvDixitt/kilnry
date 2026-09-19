// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ParamChips, clampCount, snapParams, type ComposerParams, type ParamsSchema } from './param-chips';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const videoSchema: ParamsSchema = {
  properties: {
    aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
    resolution: { type: 'string', enum: ['720p', '1080p'] },
    duration_s: { type: 'number', enum: [4, 6, 8] },
    audio: { type: 'boolean' },
  },
};

const imageSchema: ParamsSchema = {
  properties: {
    aspect_ratio: { type: 'string', enum: ['1:1', '4:3'] },
    resolution: { type: 'string', enum: ['1K', '2K'] },
  },
};

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(props: Parameters<typeof ParamChips>[0]): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<ParamChips {...props} />);
  });
  return host;
}

describe('clampCount', () => {
  it('keeps count between one and four', () => {
    expect(clampCount(0)).toBe(1);
    expect(clampCount(9)).toBe(4);
    expect(clampCount(2.6)).toBe(3);
    expect(clampCount(Number.NaN)).toBe(1);
  });
});

describe('snapParams', () => {
  it('keeps values the model lists and records no adjustment', () => {
    const result = snapParams(videoSchema, {
      aspect_ratio: '9:16',
      resolution: '1080p',
      duration_s: 6,
      count: 2,
      audio: true,
    });
    expect(result.adjustments).toHaveLength(0);
    expect(result.params).toMatchObject({ aspect_ratio: '9:16', duration_s: 6, count: 2, audio: true });
  });

  it('snaps a duration to the nearest enum value and records the change', () => {
    const result = snapParams(videoSchema, { duration_s: 5, count: 1 });
    expect(result.params.duration_s).toBe(6);
    expect(result.adjustments).toEqual([expect.objectContaining({ field: 'duration_s', from: 5, to: 6 })]);
  });

  it('falls back to the first offered aspect and resolution when the request is unsupported', () => {
    const result = snapParams(videoSchema, {
      aspect_ratio: '21:9',
      resolution: '4K',
      count: 1,
    });
    expect(result.params.aspect_ratio).toBe('16:9');
    expect(result.params.resolution).toBe('720p');
    expect(result.adjustments.map((a) => a.field).sort()).toEqual(['aspect_ratio', 'resolution']);
  });

  it('snaps a range duration to its step and bounds', () => {
    const rangeSchema: ParamsSchema = {
      properties: { duration_s: { type: 'number', minimum: 2, maximum: 30, multipleOf: 2 } },
    };
    expect(snapParams(rangeSchema, { duration_s: 7, count: 1 }).params.duration_s).toBe(8);
    expect(snapParams(rangeSchema, { duration_s: 40, count: 1 }).params.duration_s).toBe(30);
  });

  it('drops parameters the model does not support', () => {
    const result = snapParams(imageSchema, { duration_s: 5, audio: true, count: 1 });
    expect(result.params.duration_s).toBeUndefined();
    expect(result.params.audio).toBeUndefined();
  });
});

describe('ParamChips', () => {
  it('shows only the chips the model supports', async () => {
    const params: ComposerParams = { count: 1 };
    const host = await render({ schema: imageSchema, params, onChange: () => {} });
    const labels = [...host.querySelectorAll('.param-chip-label')].map((el) => el.textContent);
    expect(labels).toContain('Aspect');
    expect(labels).toContain('Resolution');
    expect(labels).toContain('Count');
    expect(labels).not.toContain('Duration');
    expect(host.querySelector('.param-chip-toggle')).toBeNull();
  });

  it('shows the audio toggle and duration chip for a video model', async () => {
    const params: ComposerParams = { count: 1, duration_s: 6, audio: false };
    const host = await render({ schema: videoSchema, params, onChange: () => {} });
    const labels = [...host.querySelectorAll('.param-chip-label')].map((el) => el.textContent);
    expect(labels).toContain('Duration');
    expect(host.querySelector('.param-chip-toggle')).not.toBeNull();
  });

  it('emits a changed parameter when an option is chosen', async () => {
    const changes: ComposerParams[] = [];
    const params: ComposerParams = { count: 1, duration_s: 4 };
    const host = await render({ schema: videoSchema, params, onChange: (next) => changes.push(next) });
    const durationTrigger = [...host.querySelectorAll('.param-chip-trigger')].find((el) =>
      el.textContent?.includes('Duration'),
    ) as HTMLButtonElement;
    await act(async () => durationTrigger.click());
    const option = [...host.querySelectorAll('.param-chip-options button')].find(
      (el) => el.textContent === '8 s',
    ) as HTMLButtonElement;
    await act(async () => option.click());
    expect(changes.at(-1)).toMatchObject({ duration_s: 8 });
  });
});
