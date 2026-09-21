// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import {
  buildPreset,
  canSave,
  candidatesFor,
  mentionsIn,
  nextName,
  presetIdFor,
  scaffoldPrompt,
  slotNameFor,
  slugify,
  uniqueNames,
  type SaveDraft,
} from './save-as-preset-logic';

const composer = {
  prompt: '@maya holds the serum on wet slate, hard rim light',
  medias: [{ role: 'product', asset_id: 'asset-serum' }],
};

function draft(overrides: Partial<SaveDraft> = {}): SaveDraft {
  return {
    name: 'Wet slate hero',
    category: 'product_shot',
    description: 'Product on wet slate with a hard rim light.',
    kind: 'image_edit',
    prompt: '{{ product_image }} on wet slate with {{ maya }}',
    model: 'fal-ai/nano-banana-pro/edit',
    params: { aspect_ratio: '1:1' },
    count: 1,
    candidates: candidatesFor(composer),
    ...overrides,
  };
}

describe('saving the composer as a preset (F-CRE-12)', () => {
  it('finds every mention in the prompt once', () => {
    expect(mentionsIn('@maya and @ravi and @maya again')).toEqual(['maya', 'ravi']);
    expect(mentionsIn('no mentions here')).toEqual([]);
  });

  it('offers each attachment and each mention as a candidate slot', () => {
    const candidates = candidatesFor(composer);
    expect(candidates.map((candidate) => [candidate.source, candidate.name])).toEqual([
      ['attachment', 'product_image'],
      ['mention', 'maya'],
    ]);
    // An attachment is required by default; a mention is not.
    expect(candidates[0]?.required).toBe(true);
    expect(candidates[1]?.required).toBe(false);
  });

  it('names slots with letters and underscores only', () => {
    expect(slotNameFor({ source: 'attachment', role: 'start_frame', value: 'a' })).toBe('start_frame_image');
    expect(slotNameFor({ source: 'mention', value: 'maya-2' })).toBe('maya');
    expect(slotNameFor({ source: 'mention', value: '123' })).toBe('input');
    for (const candidate of candidatesFor(composer)) {
      expect(candidate.name).toMatch(/^[a-z_]+$/);
    }
  });

  it('makes colliding slot names unique', () => {
    const clashing = uniqueNames([
      { source: 'mention', value: 'a', chosen: true, required: false, name: 'person' },
      { source: 'mention', value: 'b', chosen: true, required: false, name: 'person' },
      { source: 'mention', value: 'c', chosen: false, required: false, name: 'person' },
    ]);
    expect(clashing.map((candidate) => candidate.name)).toEqual(['person', 'person_2', 'person']);
  });

  it('replaces a chosen mention in the scaffold and leaves an unchosen one alone', () => {
    const candidates = candidatesFor(composer);
    expect(scaffoldPrompt(composer.prompt, candidates)).toBe(
      '{{ maya }} holds the serum on wet slate, hard rim light',
    );
    const untouched = candidates.map((candidate) =>
      candidate.source === 'mention' ? { ...candidate, chosen: false } : candidate,
    );
    expect(scaffoldPrompt(composer.prompt, untouched)).toBe(composer.prompt);
  });

  it('builds an identifier from the author, the category and the name', () => {
    expect(slugify('Wet slate hero!')).toBe('wet-slate-hero');
    expect(presetIdFor('Priya', 'product_shot', 'Wet slate hero')).toBe('priya.product_shot.wet-slate-hero');
  });

  it('offers the next free name when one is taken', () => {
    expect(nextName('Ice cube hover')).toBe('Ice cube hover 2');
    expect(nextName('Ice cube hover 2')).toBe('Ice cube hover 3');
  });

  it('blocks Save on a missing name, an over-long description or a duplicate slot name', () => {
    expect(canSave(draft())).toBe(true);
    expect(canSave(draft({ name: '   ' }))).toBe(false);
    expect(canSave(draft({ name: 'x'.repeat(61) }))).toBe(false);
    expect(canSave(draft({ description: 'x'.repeat(201) }))).toBe(false);
    expect(canSave(draft({ prompt: '  ' }))).toBe(false);
    expect(canSave(draft({ category: 'not_a_tab' }))).toBe(false);
    expect(
      canSave(
        draft({
          candidates: [
            { source: 'mention', value: 'a', chosen: true, required: false, name: 'same' },
            { source: 'mention', value: 'b', chosen: true, required: false, name: 'same' },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      canSave(
        draft({
          candidates: [{ source: 'mention', value: 'a', chosen: true, required: false, name: 'Bad Name' }],
        }),
      ),
    ).toBe(false);
  });

  it('writes an attachment as a bound media slot and a mention as a character slot', () => {
    const preset = buildPreset(draft(), 'priya') as {
      id: string;
      slots: Array<{ name: string; type: string; roles?: string[]; kinds?: string[] }>;
      medias: Array<{ role: string; from_slot: string }>;
      capability: string;
      model: { id: string; locked: boolean };
      license: string;
      author: string;
    };
    expect(preset.id).toBe('priya.product_shot.wet-slate-hero');
    expect(preset.slots).toEqual([
      {
        name: 'product_image',
        type: 'media',
        label: 'product image',
        required: true,
        roles: ['product'],
        accept: ['image'],
      },
      { name: 'maya', type: 'character', label: 'maya', required: false, kinds: ['character'] },
    ]);
    expect(preset.medias).toEqual([{ role: 'product', from_slot: 'product_image' }]);
    expect(preset.capability).toBe('image_edit');
    expect(preset.model.locked).toBe(true);
    expect(preset.license).toBe('CC0-1.0');
    expect(preset.author).toBe('priya');
  });

  it('keeps the original model as a hint when Auto is chosen', () => {
    const preset = buildPreset(
      draft({ model: 'auto', model_hint: 'fal-ai/nano-banana-pro/edit' }),
      'priya',
    ) as { model: { id: string; locked: boolean }; model_hint?: string };
    expect(preset.model.id).toBe('auto');
    expect(preset.model.locked).toBe(false);
    expect(preset.model_hint).toBe('fal-ai/nano-banana-pro/edit');
  });

  it('attaches the chosen result as the card preview', () => {
    const preset = buildPreset(draft({ example_asset_id: 'asset-out' }), 'priya') as {
      examples?: Array<{ asset_url: string }>;
    };
    expect(preset.examples?.[0]?.asset_url).toBe('/api/media/asset-out');
  });

  it('leaves out an unticked candidate entirely', () => {
    const preset = buildPreset(
      draft({ candidates: candidatesFor(composer).map((entry) => ({ ...entry, chosen: false })) }),
      'priya',
    ) as { slots: unknown[]; medias: unknown[] };
    expect(preset.slots).toEqual([]);
    expect(preset.medias).toEqual([]);
  });
});
