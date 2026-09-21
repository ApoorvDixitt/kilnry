// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Camera and motion presets as scaffolds with model hints (F-PRE-06). The point
// of a hint order is that a scaffold still runs on whichever single key the user
// has: these tests take the shipped camera seeds and settle their hints against
// one connected provider at a time.

import { registrySeed } from '@kilnry/core';
import { describe, expect, it } from 'vitest';
import { chooseModel, modelHints, usesCharacterAnchor } from './hints.js';
import { listPresets } from './loader.js';
import { PresetJsonSchema, type PresetJson } from './schema.js';

function providerOf(ref: string): string | undefined {
  for (const model of registrySeed) {
    if (model.model_id === ref || `${model.provider}/${model.model_id}` === ref) return model.provider;
  }
  return undefined;
}

const camera = listPresets()
  .filter((entry) => entry.category === 'camera' && entry.preset !== undefined)
  .map((entry) => entry.preset as PresetJson);

const motion = listPresets()
  .filter((entry) => entry.category === 'motion' && entry.preset !== undefined)
  .map((entry) => entry.preset as PresetJson);

function scaffold(overrides: Partial<PresetJson> = {}): PresetJson {
  return PresetJsonSchema.parse({
    schema_version: 1,
    id: 'kilnry.camera.test',
    name: 'Test',
    version: '1.0.0',
    description: 'A camera scaffold.',
    category: 'camera',
    kind: 'video',
    capability: 'image2video',
    model: {
      id: 'fal-ai/kling-video/v3/standard/image-to-video',
      alternates: ['kwaivgi/kling-v3.0-std'],
    },
    prompt: 'Dolly in toward {{ subject }}.',
    slots: [{ name: 'subject', type: 'text', label: 'Subject', required: true }],
    needs: ['fal', 'openrouter'],
    ...overrides,
  });
}

describe('camera and motion scaffolds keep their model hints (F-PRE-06)', () => {
  it('ships the eight camera scaffolds and five motion scaffolds', () => {
    expect(camera.length).toBe(8);
    expect(motion.length).toBe(5);
  });

  it('gives every camera scaffold a start frame, a written subject and hints', () => {
    for (const preset of camera) {
      expect(preset.capability).toBe('image2video');
      const frame = preset.slots.find(
        (slot) => slot.type === 'media' && (slot.roles ?? []).includes('start_frame'),
      );
      expect(frame?.required, `${preset.id} needs a start frame`).toBe(true);
      expect(preset.slots.some((slot) => slot.name === 'subject' && slot.type === 'text')).toBe(true);
      expect(modelHints(preset).length).toBeGreaterThan(1);
    }
  });

  it.each([...camera, ...motion].map((preset) => [preset.id, preset] as const))(
    'settles the hints of %s on a fal key alone and on an OpenRouter key alone',
    (_id, preset) => {
      for (const provider of ['fal', 'openrouter'] as const) {
        const chosen = chooseModel(preset, { connected: new Set([provider]), providerOf });
        // A scaffold must never fall back to an open choice while it still lists
        // a hint the connected key can serve.
        expect(chosen.reason, `${preset.id} on ${provider}`).not.toBe('auto');
        expect(providerOf(chosen.model)).toBe(provider);
      }
    },
  );

  it('prefers the first hint when its provider is connected', () => {
    const chosen = chooseModel(scaffold(), { connected: new Set(['fal']), providerOf });
    expect(chosen).toEqual({ model: 'fal-ai/kling-video/v3/standard/image-to-video', reason: 'primary' });
  });

  it('falls through to the next hint when the first is out of reach', () => {
    const chosen = chooseModel(scaffold(), { connected: new Set(['openrouter']), providerOf });
    expect(chosen).toEqual({ model: 'kwaivgi/kling-v3.0-std', reason: 'alternate' });
  });

  it('leaves the choice open when no hint can be reached', () => {
    const chosen = chooseModel(scaffold(), { connected: new Set(['google']), providerOf });
    expect(chosen).toEqual({ model: 'auto', reason: 'auto' });
  });

  it('keeps a locked model whatever is connected', () => {
    const locked = scaffold({
      model: { id: 'fal-ai/veo3.1/lite/image-to-video', locked: true, alternates: [] },
    });
    expect(chooseModel(locked, { connected: new Set(['openrouter']), providerOf })).toEqual({
      model: 'fal-ai/veo3.1/lite/image-to-video',
      reason: 'primary',
    });
  });

  it('drops an open choice from the hint list', () => {
    const open = scaffold({
      model: { id: 'auto', locked: false, alternates: ['kwaivgi/kling-v3.0-std'] },
    });
    expect(modelHints(open)).toEqual(['kwaivgi/kling-v3.0-std']);
  });

  it('uses a Character anchor as the first frame only when nothing else supplies one', () => {
    // The shipped camera scaffolds all ask for a still, so none of them does.
    for (const preset of camera) expect(usesCharacterAnchor(preset)).toBe(false);

    const withCharacter = scaffold({
      slots: [
        { name: 'creator', type: 'character', label: 'Creator', required: true },
        { name: 'subject', type: 'text', label: 'Subject', required: true },
      ],
    });
    expect(usesCharacterAnchor(withCharacter)).toBe(true);
  });

  it('does not reach for an anchor when the preset is not image to video', () => {
    const still = scaffold({
      category: 'ugc',
      kind: 'image',
      capability: 'text2image',
      slots: [{ name: 'creator', type: 'character', label: 'Creator', required: true }],
      prompt: 'A portrait of {{ creator }}.',
    });
    expect(usesCharacterAnchor(still)).toBe(false);
  });
});
