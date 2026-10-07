// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { saveDialogName } from '../components/workflow-run-view-logic';
import { chatModelLabel, modelCell, providerLabel } from './provider-names';
import { capabilityLabel, firstSentence } from './workflow-copy';

// UX-08: provider ids and model ids reached user copy — "openrouter detected",
// "Queued at openrouter", `openai/gpt-5.6-luna` as a Chat model label, and
// model ids in the Jobs table while the picker showed display names.
describe('provider and model names as a user reads them (UX-08)', () => {
  it('spells every provider the way it spells itself', () => {
    expect(providerLabel('openrouter')).toBe('OpenRouter');
    expect(providerLabel('elevenlabs')).toBe('ElevenLabs');
    expect(providerLabel('fal')).toBe('fal');
  });

  it('labels a Chat model by name, provider and price, never the id', () => {
    expect(
      chatModelLabel({
        provider: 'openai',
        model: 'openai/gpt-5.6-luna',
        display_name: 'GPT 5.6 Luna',
        price_label: '$0.20 / $1.20 per M',
      }),
    ).toBe('GPT 5.6 Luna · OpenAI · $0.20 / $1.20 per M');
    // A local Ollama model has no registry row; its own name stands.
    expect(chatModelLabel({ provider: 'ollama', model: 'qwen3:8b', price_label: 'free' })).toBe(
      'qwen3:8b · Ollama · free',
    );
  });

  it('shows the Jobs model by its display name with the id in the tooltip', () => {
    expect(
      modelCell({ modelId: 'black-forest-labs/flux.2-klein-4b', modelName: 'FLUX.2 Klein 4B' } as never),
    ).toEqual({ label: 'FLUX.2 Klein 4B', title: 'black-forest-labs/flux.2-klein-4b' });
    expect(modelCell({ modelId: 'gone/model' })).toEqual({ label: 'gone/model' });
    expect(modelCell({})).toEqual({ label: '—' });
  });
});

// UX-09: the card showed the agent-facing description with its spec citations,
// and capability ids such as `tts`.
describe('workflow card copy (UX-09)', () => {
  it('takes the first sentence of a description without its spec citations', () => {
    expect(
      firstSentence(
        'Take one short source ad and produce N variants (W10, F-WFL-08, PRD-10 §9). Replacement people are Characters.',
      ),
    ).toBe('Take one short source ad and produce N variants.');
  });

  it('spells capabilities out', () => {
    expect(capabilityLabel('tts')).toBe('text-to-speech');
    expect(capabilityLabel('stt')).toBe('speech-to-text');
    expect(capabilityLabel('bg_remove')).toBe('background removal');
    expect(capabilityLabel('something_new')).toBe('something new');
  });
});

// UX-17: the saved card is titled from the dialog's name field, which started
// as the workflow id ("kilnry-thumbnail (saved)").
describe('the Save as Workflow dialog name (UX-17)', () => {
  it('starts from the workflow display name', () => {
    expect(saveDialogName({ workflow_id: 'kilnry-thumbnail', workflow_name: 'Thumbnail' })).toBe(
      'Thumbnail (saved)',
    );
    expect(saveDialogName({ workflow_id: 'kilnry-thumbnail', workflow_name: null })).toBe(
      'kilnry-thumbnail (saved)',
    );
  });
});
