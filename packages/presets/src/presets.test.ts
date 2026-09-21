// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { renderParams, renderPreset, renderPrompt } from './render.js';
import { PresetJsonSchema, type PresetJson } from './schema.js';
import { placeholders, validatePreset, validatePresetFile } from './validate.js';

// The ice-cube product shot from TRD-12 §12.1, as a fixture.
const productShot = {
  schema_version: 1,
  id: 'ice-cube-product-shot',
  name: 'Ice-cube hover',
  version: '1.0.0',
  description: 'Product suspended in a clear ice cube on a wet slate slab. Needs one product image.',
  category: 'product_shot',
  kind: 'image_edit',
  capability: 'image_edit',
  model: {
    id: 'auto',
    locked: false,
    alternates: ['fal-ai/nano-banana-pro/edit'],
    constraints: { quality: 'standard', refs_count: 1 },
  },
  prompt:
    'Product photograph: the product in image 1, frozen inside a crystal-clear ice cube. {{ extra }} No text.',
  negative_prompt: 'warped label, extra products, text, hands',
  params: { aspect_ratio: '{{ aspect }}', resolution: '2K' },
  slots: [
    {
      name: 'product',
      type: 'media',
      label: 'Product image',
      required: true,
      roles: ['product'],
      accept: ['image'],
    },
    { name: 'aspect', type: 'enum', label: 'Aspect', options: ['1:1', '4:5', '9:16'], default: '1:1' },
    { name: 'extra', type: 'text', label: 'Extra direction', default: '' },
  ],
  medias: [{ role: 'product', from_slot: 'product' }],
  count: 1,
  indicative_cost_usd: 0.04,
  needs: ['fal'],
  tags: ['packshot'],
  license: 'CC0-1.0',
  author: 'kilnry',
};

function parse(value: unknown = productShot): PresetJson {
  return PresetJsonSchema.parse(value);
}

describe('preset schema (F-PRE-03, TRD-12 §12)', () => {
  it('accepts the worked example and fills in the defaults', () => {
    const preset = parse();
    expect(preset.id).toBe('ice-cube-product-shot');
    expect(preset.count).toBe(1);
    expect(preset.model.locked).toBe(false);
    expect(preset.license).toBe('CC0-1.0');
  });

  it('keeps an unknown top-level key so a newer preset survives a round trip', () => {
    const preset = parse({ ...productShot, future_field: { note: 'kept' } }) as PresetJson & {
      future_field?: unknown;
    };
    expect(preset.future_field).toEqual({ note: 'kept' });
  });

  it('refuses a category outside the catalogue tabs', () => {
    expect(PresetJsonSchema.safeParse({ ...productShot, category: 'sculpture' }).success).toBe(false);
  });

  it('refuses a slot name that is not a plain identifier', () => {
    const bad = { ...productShot, slots: [{ name: 'Product Image', type: 'text', label: 'x' }] };
    expect(PresetJsonSchema.safeParse(bad).success).toBe(false);
  });
});

describe('preset validation (F-PRE-03)', () => {
  it('passes a sound preset with no errors', () => {
    const { preset, issues } = validatePreset({ value: productShot, fileName: 'ice-cube-product-shot' });
    expect(preset).toBeDefined();
    expect(issues.filter((issue) => issue.level === 'error')).toEqual([]);
  });

  it('names a placeholder that has no slot', () => {
    const bad = { ...productShot, prompt: 'A shot of {{ product }} on {{ surface }}.' };
    const { preset, issues } = validatePreset({ value: bad });
    expect(preset).toBeUndefined();
    expect(issues[0]?.message).toBe('The placeholder {{ surface }} does not name a declared slot.');
  });

  it('checks placeholders inside the parameters too', () => {
    const bad = { ...productShot, params: { aspect_ratio: '{{ nope }}' } };
    const { issues } = validatePreset({ value: bad });
    expect(issues.some((issue) => issue.message.includes('{{ nope }}'))).toBe(true);
  });

  it('requires the id to match the file name', () => {
    const { issues } = validatePreset({ value: productShot, fileName: 'something-else' });
    expect(issues[0]?.message).toContain('does not match the file name');
  });

  it('refuses a media binding that points at a text slot', () => {
    const bad = { ...productShot, medias: [{ role: 'product', from_slot: 'extra' }] };
    const { issues } = validatePreset({ value: bad });
    expect(issues[0]?.message).toContain('which is a text slot');
  });

  it('refuses a media binding to a slot that does not exist', () => {
    const bad = { ...productShot, medias: [{ role: 'product', from_slot: 'ghost' }] };
    const { issues } = validatePreset({ value: bad });
    expect(issues[0]?.message).toContain('not declared');
  });

  it('refuses a choice with no options or a default outside them', () => {
    const noOptions = {
      ...productShot,
      slots: [{ name: 'aspect', type: 'enum', label: 'Aspect' }],
      prompt: 'x',
      params: {},
      medias: [],
    };
    expect(validatePreset({ value: noOptions }).issues[0]?.message).toContain('no options');

    const badDefault = {
      ...productShot,
      slots: [{ name: 'aspect', type: 'enum', label: 'Aspect', options: ['1:1'], default: '16:9' }],
      prompt: 'x',
      params: {},
      medias: [],
    };
    expect(validatePreset({ value: badDefault }).issues[0]?.message).toContain('not one of its options');
  });

  it('refuses a prompt that hard-codes a provider token', () => {
    const bad = { ...productShot, prompt: 'Use @Element1 for the product.' };
    const { issues } = validatePreset({ value: bad });
    expect(issues[0]?.message).toContain('provider token');
  });

  it('refuses a file larger than the limit', () => {
    const { issues } = validatePreset({ value: productShot, bytes: 100 * 1024 });
    expect(issues.some((issue) => issue.message.includes('larger than 64 KB'))).toBe(true);
  });

  it('warns rather than fails when no key can reach the preset', () => {
    const { preset, issues } = validatePreset({ value: productShot, connected: ['openrouter'] });
    expect(preset).toBeDefined();
    expect(issues).toEqual([{ level: 'warning', rule: 'P8', message: 'This preset needs a key for fal.' }]);
  });

  it('reports unreadable JSON as one clear error', () => {
    const { issues } = validatePresetFile('{ not json', 'x');
    expect(issues[0]?.level).toBe('error');
    expect(issues[0]?.message).toContain('not valid JSON');
  });

  it('finds every placeholder including the conditional form', () => {
    expect(placeholders('A {{ a }} and {{#if b}}maybe {{ b }}{{/if}}')).toEqual(['a', 'b']);
  });
});

describe('preset rendering (F-PRE-03)', () => {
  it('fills the slots the user chose and tidies what was left empty', () => {
    const rendered = renderPreset(parse(), { product: '01JASSET', aspect: '4:5', extra: '' });
    expect(rendered.prompt).toBe(
      'Product photograph: the product in image 1, frozen inside a crystal-clear ice cube. No text.',
    );
    expect(rendered.params).toEqual({ aspect_ratio: '4:5', resolution: '2K' });
    expect(rendered.medias).toEqual([{ role: 'product', ref: '01JASSET' }]);
    expect(rendered.missing).toEqual([]);
  });

  it('keeps a parameter the slot type gave it rather than turning it into text', () => {
    const preset = parse({
      ...productShot,
      params: { duration_s: '{{ duration_s }}', audio: false },
      slots: [{ name: 'duration_s', type: 'number', label: 'Duration', default: 5 }],
      prompt: 'x',
      medias: [],
    });
    expect(renderParams(preset, { duration_s: 6 })).toEqual({ duration_s: 6, audio: false });
    expect(renderParams(preset, {})).toEqual({ duration_s: 5, audio: false });
  });

  it('renders a character slot as its handle so the resolver decides the likeness', () => {
    const preset = parse({
      ...productShot,
      prompt: '{{ creator }} speaks to camera and says "{{ hook }}".',
      params: {},
      medias: [],
      slots: [
        { name: 'creator', type: 'character', label: 'Creator', required: true },
        { name: 'hook', type: 'text', label: 'Hook', required: true },
      ],
    });
    const rendered = renderPreset(preset, { creator: 'maya', hook: 'Stop boiling chai.' });
    expect(rendered.prompt).toBe('@maya speaks to camera and says "Stop boiling chai.".');
    expect(rendered.characters).toEqual(['maya']);
  });

  it('accepts a handle the user already wrote with its sign', () => {
    const preset = parse({
      ...productShot,
      prompt: '{{ creator }} waves.',
      params: {},
      medias: [],
      slots: [{ name: 'creator', type: 'character', label: 'Creator' }],
    });
    expect(renderPreset(preset, { creator: '@maya' }).prompt).toBe('@maya waves.');
  });

  it('drops a conditional block when its slot is empty', () => {
    const preset = parse({
      ...productShot,
      prompt: 'A shot.{{#if note}} Also: {{ note }}.{{/if}}',
      params: {},
      medias: [],
      slots: [{ name: 'note', type: 'text', label: 'Note', default: '' }],
    });
    expect(renderPrompt(preset.prompt, preset, {}).trim()).toBe('A shot.');
    expect(renderPrompt(preset.prompt, preset, { note: 'mint leaves' })).toBe('A shot. Also: mint leaves.');
  });

  it('reports a required slot the user left empty instead of sending a gap', () => {
    const rendered = renderPreset(parse(), { aspect: '1:1' });
    expect(rendered.missing).toEqual(['product']);
    expect(rendered.medias).toEqual([]);
  });

  it('leaves a parameter out when its slot has no value at all', () => {
    const preset = parse({
      ...productShot,
      params: { seed: '{{ seed }}' },
      slots: [{ name: 'seed', type: 'number', label: 'Seed' }],
      prompt: 'x',
      medias: [],
    });
    expect(renderParams(preset, {})).toEqual({});
  });
});
