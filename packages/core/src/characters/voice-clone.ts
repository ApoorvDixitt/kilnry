// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Voice cloning (F-VOI-02, TRD-14 §11) and binding (F-CHR-08). Cloning a voice
// sends a short sample to a provider and gets back a reusable voice id; it is
// gated by consent — a real person's voice cannot be cloned or bound to a real
// person Character without a recorded consent — and by an acknowledged price.
// The provider consent sentence is shown verbatim in the drawer; this module
// stores the clone and, when asked, binds it to a Character version.

import type { DatabaseState } from '@kilnry/db';
import { auditEvents } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';
import { assertCostConfirmation, holdSpend, releaseHold, settleHold } from '../budget/enforcer.js';
import { estimate as priceEstimate } from '../registry/estimator.js';
import { loadRegistry } from '../registry/store.js';
import type { CanonicalRequest, Estimate } from '../types.js';
import { assertConsentForTraining } from './consent.js';
import { lookupHandle } from './store.js';
import { bindVoice, recordClonedVoice } from './voices.js';
import { FalQueueTimeout, submitAndPollFalQueue } from './fal-queue.js';

// The clone options a user can pick (PRD-08 §B2). 'kling' is Kling's own voice
// creation reached through fal (fal-ai/kling-video/create-voice) and is the only
// kind of voice Kling 3.0 speech accepts; 'fal' is MiniMax's clone hosted on fal.
export type CloneProvider = 'minimax' | 'elevenlabs' | 'kling' | 'fal';

export interface CloneProviderCard {
  provider: CloneProvider;
  label: string;
  cost_usd: number;
  min_seconds: number;
  max_seconds: number;
}

// Each option's one-time price and sample-length limits, from the provider
// pages (PRD-08 §B2). Kling create-voice: $0.007 per generation, 5–30 s
// (fal.ai/models/fal-ai/kling-video/create-voice, read 2026-10-05). MiniMax via
// fal: $1.50, 10 s–3 min (fal-ai/minimax/voice-clone).
export const CLONE_PROVIDERS: Record<CloneProvider, CloneProviderCard> = {
  minimax: { provider: 'minimax', label: 'MiniMax', cost_usd: 1.5, min_seconds: 10, max_seconds: 300 },
  elevenlabs: {
    provider: 'elevenlabs',
    label: 'ElevenLabs IVC',
    cost_usd: 0,
    min_seconds: 10,
    max_seconds: 120,
  },
  kling: { provider: 'kling', label: 'Kling (via fal)', cost_usd: 0.007, min_seconds: 5, max_seconds: 30 },
  fal: { provider: 'fal', label: 'MiniMax (via fal)', cost_usd: 1.5, min_seconds: 10, max_seconds: 180 },
};

export const MIN_SAMPLE_SECONDS = 10;
export const MAX_SAMPLE_SECONDS = 180;

// The registry row whose price rule prices each clone option (TRD-07 §5), and
// the provider whose key pays for it and whose ledger row it writes.
const CLONE_PRICING: Record<
  CloneProvider,
  { registry_provider: 'minimax' | 'elevenlabs' | 'fal'; model_id: string }
> = {
  minimax: { registry_provider: 'minimax', model_id: 'voice_clone' },
  elevenlabs: { registry_provider: 'elevenlabs', model_id: 'ivc' },
  kling: { registry_provider: 'fal', model_id: 'fal-ai/kling-video/create-voice' },
  fal: { registry_provider: 'fal', model_id: 'fal-ai/minimax/voice-clone' },
};

// The provider the created voice belongs to: the one whose models can use it
// (TRD-14 §2 audio row). A Kling-created voice is 'kling' whichever host made it.
export function clonedVoiceProvider(provider: CloneProvider): string {
  return provider;
}

// Price a clone from the registry so the confirmed figure is the figure the
// registry holds (F-VOI-02, F-PRV-05).
export async function priceClone(db: DatabaseState, provider: CloneProvider): Promise<Estimate> {
  const { registry_provider: registryProvider, model_id: modelId } = CLONE_PRICING[provider];
  const registry = await loadRegistry(db);
  const model = registry.models.find(
    (candidate) => candidate.provider === registryProvider && candidate.model_id === modelId,
  );
  const snapshot = model ? registry.snapshots.get(`${registryProvider}:${modelId}`) : undefined;
  if (!model || !snapshot) {
    throw new KilnryError(
      'NO_PROVIDER',
      `No price is registered for ${provider} voice cloning; refresh provider prices and try again.`,
    );
  }
  const request: CanonicalRequest = {
    kind: 'audio',
    capability: 'voice_clone',
    prompt: `clone ${provider}`,
    params: {},
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  };
  return priceEstimate({ model, snapshot, request });
}

export interface CloneInput {
  name: string;
  provider: CloneProvider;
  sample_url: string;
  sample_seconds: number;
  consent_confirmed: boolean;
  confirmed_cost_usd: number;
  bind_to?: string;
  sample_asset_id?: string;
  preview_asset_id?: string;
}

// The provider whose key pays for a clone option (a Kling voice is paid for by
// fal's key); keyFor receives this, never the option itself.
export type ClonePayingProvider = 'minimax' | 'elevenlabs' | 'fal';

export interface CloneServices {
  db: DatabaseState;
  keyFor: (provider: ClonePayingProvider) => Promise<string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
  // Test-only poll tuning so a timeout can be exercised without a 2-minute wait.
  falPoll?: { budgetMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
}

export interface CloneResult {
  voice_ulid: string;
  provider: CloneProvider;
  voice_id: string;
  bound_to?: string;
}

// Whether the sample is long enough to clone (PRD-08 §B2 acceptance 1). Each
// option has its own bounds; Kling takes 5–30 s where the others need 10 s.
export function sampleLongEnough(seconds: number, provider: CloneProvider = 'minimax'): boolean {
  return seconds >= CLONE_PROVIDERS[provider].min_seconds;
}

// Clone a voice with a provider and, optionally, bind it to a Character version.
// Consent must be ticked and, when binding to a real person, recorded on the
// Character (the hard invariant, §9).
export async function cloneVoice(services: CloneServices, input: CloneInput): Promise<CloneResult> {
  const fetchImpl = services.fetch ?? fetch;
  const now = services.now ?? (() => new Date());
  if (!input.consent_confirmed) {
    throw new KilnryError('CONFIRMATION_REQUIRED', 'Confirm consent before cloning a voice.', {
      details: { reason: 'consent_required' },
    });
  }
  const card = CLONE_PROVIDERS[input.provider];
  if (!sampleLongEnough(input.sample_seconds, input.provider)) {
    throw new KilnryError(
      'INVALID_INPUT',
      `The sample is too short. ${card.label} needs at least ${card.min_seconds} seconds of clean speech.`,
    );
  }
  if (input.sample_seconds > card.max_seconds) {
    throw new KilnryError(
      'INVALID_INPUT',
      `The sample is too long. ${card.label} takes at most ${card.max_seconds} seconds.`,
    );
  }
  const paying = CLONE_PRICING[input.provider].registry_provider;

  // Binding to a real-person Character asserts the Character's own consent gate.
  let bindTarget: { characterId: string; version: number } | undefined;
  if (input.bind_to) {
    const head = await lookupHandle(services.db, input.bind_to);
    if (!head) throw new KilnryError('NOT_FOUND', `@${input.bind_to} is not a Character.`);
    if (head.is_real_person) await assertConsentForTraining(services.db, head.id);
    bindTarget = { characterId: head.id, version: head.current_version };
  }

  const key = await services.keyFor(paying);
  if (!key) throw new KilnryError('NO_PROVIDER', `${paying} has no connected key.`);

  // Price the clone from the registry, refuse it unless the confirmed figure
  // matches the priced one, and hold the estimate against the budget caps
  // before any provider request (F-VOI-02, F-PRV-04, PRD-14 "reserve"): the
  // cap check and the pending ledger row are one locked transaction, so two
  // concurrent clones against a cap with room for one admit exactly one. A free
  // clone (ElevenLabs instant voice cloning) still records one ledger row at $0.
  const cloneEstimate = await priceClone(services.db, input.provider);
  assertCostConfirmation(cloneEstimate, input.confirmed_cost_usd);
  const chargedUsd = cloneEstimate.authoritative_usd ?? cloneEstimate.estimate_usd;
  // The ledger row is keyed by the voice's own id so a clone is charged at most
  // once; it has no job id because cloning does not go through the job queue.
  const voiceUlid = ulid();
  const hold = await holdSpend(services.db, {
    ledger_id: voiceUlid,
    estimate_usd: cloneEstimate.estimate_usd,
    provider: paying,
    model_id: CLONE_PRICING[input.provider].model_id,
    kind: 'voice_clone',
    folder: 'inbox',
    now: now(),
  });

  let cloned: { voiceId: string; previewAudioUrl?: string; requestId?: string };
  try {
    cloned = await cloneWithProvider(
      fetchImpl,
      input.provider,
      key,
      { name: input.name, sampleUrl: input.sample_url },
      services.falPoll,
    );
  } catch (error) {
    // A fal queue timeout: fal has accepted and may bill, so the hold stays as
    // the charge at the estimate with the request id rather than vanishing, and
    // a TIMEOUT names the request (default; adjustable).
    if (error instanceof FalQueueTimeout) {
      await settleHold(services.db, hold, {
        actual_usd: chargedUsd,
        note: `ambiguous: fal request ${error.request_id}`,
      });
      throw new KilnryError('TIMEOUT', `fal voice clone did not finish (request ${error.request_id}).`, {
        provider: 'fal',
        retryable: true,
      });
    }
    // The provider refused or failed before charging: release the hold.
    await releaseHold(services.db, hold);
    throw error;
  }
  const voiceId = cloned.voiceId;

  await recordClonedVoice(services.db, {
    id: voiceUlid,
    provider: clonedVoiceProvider(input.provider),
    voice_id: voiceId,
    name: input.name,
    consent_confirmed_at: now(),
    cost_usd: chargedUsd,
    ...(input.sample_asset_id ? { sample_asset_id: input.sample_asset_id } : {}),
    ...(input.preview_asset_id ? { preview_asset_id: input.preview_asset_id } : {}),
  });
  // The hold becomes the clone's ledger row; one audit event beside it
  // (F-PRV-05, TRD-15).
  await settleHold(services.db, hold, { actual_usd: chargedUsd, note: 'voice clone' });
  await services.db.db.insert(auditEvents).values({
    id: ulid(),
    actor: 'user',
    action: 'voice.clone',
    target: input.name,
    meta: {
      provider: input.provider,
      paid_by: paying,
      estimate_usd: cloneEstimate.estimate_usd,
      actual_usd: chargedUsd,
      ...(cloned.requestId ? { fal_request_id: cloned.requestId } : {}),
    },
  });

  if (bindTarget) {
    await bindVoice(services.db, bindTarget.characterId, bindTarget.version, voiceUlid);
  }

  return {
    voice_ulid: voiceUlid,
    provider: input.provider,
    voice_id: voiceId,
    ...(input.bind_to ? { bound_to: input.bind_to.replace(/^@/, '') } : {}),
  };
}

// Send the sample to the provider and return the new voice id (TRD-14 §11).
async function cloneWithProvider(
  fetchImpl: typeof fetch,
  provider: CloneProvider,
  key: string,
  input: { name: string; sampleUrl: string },
  falPoll?: { budgetMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<{ voiceId: string; previewAudioUrl?: string; requestId?: string }> {
  if (provider === 'minimax') {
    // Upload the sample, then create the clone keyed to a Kilnry-stable id.
    const uploaded = (await postJson(fetchImpl, 'https://api.minimax.io/v1/files/upload', key, {
      purpose: 'voice_clone',
      file_url: input.sampleUrl,
    })) as { file?: { file_id?: string }; file_id?: string };
    const fileId = uploaded.file?.file_id ?? uploaded.file_id;
    if (!fileId) throw new KilnryError('PROVIDER_ERROR', 'MiniMax did not return a file id.');
    const voiceId = `kilnry_${ulid().slice(0, 8).toLowerCase()}`;
    const cloned = (await postJson(fetchImpl, 'https://api.minimax.io/v1/voice_clone', key, {
      file_id: fileId,
      voice_id: voiceId,
      model: 'speech-2.8-hd',
    })) as { base_resp?: { status_code?: number } };
    const code = cloned.base_resp?.status_code ?? 0;
    if (code === 1026)
      throw new KilnryError('MODERATION_REJECTED', 'MiniMax rejected the voice sample.', {
        provider: 'minimax',
        retryable: false,
      });
    if (code !== 0)
      throw new KilnryError('PROVIDER_ERROR', `MiniMax voice clone failed (status ${code}).`, {
        provider: 'minimax',
        retryable: true,
      });
    return { voiceId };
  }
  if (provider === 'elevenlabs') {
    const added = (await postJson(fetchImpl, 'https://api.elevenlabs.io/v1/voices/add', key, {
      name: input.name,
      file_url: input.sampleUrl,
    })) as { voice_id?: string; detail?: { status?: string } };
    if (added.detail?.status === 'detected_unusual_activity')
      throw new KilnryError(
        'PROVIDER_ERROR',
        'ElevenLabs blocked cloning on this account tier. Upgrade the plan or use MiniMax.',
        { provider: 'elevenlabs', retryable: false },
      );
    if (!added.voice_id) throw new KilnryError('PROVIDER_ERROR', 'ElevenLabs did not return a voice id.');
    return { voiceId: added.voice_id };
  }
  if (provider === 'kling') {
    // Kling's own voice creation on fal, a QUEUE endpoint: submit { voice_url }
    // (5–30 s, one clean voice) → poll status → GET response { voice_id }
    // (schema KlingVideoCreateVoiceInput/Output, fal.ai/models/fal-ai/kling-video/
    // create-voice/api, read 2026-10-05). The id is what Kling 3.0's voice_ids[]
    // takes (PRD-08 §B2 "For Kling video speech only").
    const { output, request_id } = await submitAndPollFalQueue(
      fetchImpl,
      'fal-ai/kling-video/create-voice',
      key,
      { voice_url: input.sampleUrl },
      falPoll ?? {},
    );
    const voiceId = typeof output.voice_id === 'string' ? output.voice_id : undefined;
    if (!voiceId)
      throw new KilnryError('PROVIDER_ERROR', 'fal Kling create-voice returned no voice_id.', {
        provider: 'fal',
        retryable: true,
      });
    return { voiceId, requestId: request_id };
  }
  // fal (MiniMax): fal-ai/minimax/voice-clone is a QUEUE endpoint. Submit
  // { audio_url } → poll status → GET response, whose output is
  // { custom_voice_id, audio } (schema MinimaxVoiceCloneOutput at
  // fal.ai/models/fal-ai/minimax/voice-clone/api; required custom_voice_id).
  const { output, request_id } = await submitAndPollFalQueue(
    fetchImpl,
    'fal-ai/minimax/voice-clone',
    key,
    { audio_url: input.sampleUrl },
    falPoll ?? {},
  );
  const voiceId = typeof output.custom_voice_id === 'string' ? output.custom_voice_id : undefined;
  if (!voiceId)
    throw new KilnryError('PROVIDER_ERROR', 'fal voice clone returned no custom_voice_id.', {
      provider: 'fal',
      retryable: true,
    });
  const audio = output.audio as { url?: string } | undefined;
  return { voiceId, requestId: request_id, ...(audio?.url ? { previewAudioUrl: audio.url } : {}) };
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  key: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const authorization = url.includes('elevenlabs') ? undefined : `Bearer ${key}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authorization) headers.Authorization = authorization;
  if (url.includes('elevenlabs')) headers['xi-api-key'] = key;
  if (url.includes('fal.run')) headers.Authorization = `Key ${key}`;
  const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok)
    throw new KilnryError('PROVIDER_ERROR', `The provider returned ${response.status}.`, {
      retryable: response.status >= 500,
    });
  return response.json();
}
