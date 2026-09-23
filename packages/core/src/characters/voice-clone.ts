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
import { auditEvents, spendLedger } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';
import { assertCostConfirmation, reserveBudget } from '../budget/enforcer.js';
import { estimate as priceEstimate } from '../registry/estimator.js';
import { loadRegistry } from '../registry/store.js';
import type { CanonicalRequest, Estimate } from '../types.js';
import { assertConsentForTraining } from './consent.js';
import { lookupHandle } from './store.js';
import { bindVoice, recordClonedVoice } from './voices.js';

export type CloneProvider = 'minimax' | 'elevenlabs' | 'fal';

export interface CloneProviderCard {
  provider: CloneProvider;
  label: string;
  cost_usd: number;
  min_seconds: number;
  max_seconds: number;
}

// The clone providers, their one-time price and their sample-length limits
// (PRD-08 §B2). Kling is reached through fal's create-voice endpoint.
export const CLONE_PROVIDERS: Record<CloneProvider, CloneProviderCard> = {
  minimax: { provider: 'minimax', label: 'MiniMax', cost_usd: 1.5, min_seconds: 10, max_seconds: 300 },
  elevenlabs: {
    provider: 'elevenlabs',
    label: 'ElevenLabs IVC',
    cost_usd: 0,
    min_seconds: 10,
    max_seconds: 120,
  },
  fal: { provider: 'fal', label: 'Kling (via fal)', cost_usd: 0, min_seconds: 5, max_seconds: 30 },
};

export const MIN_SAMPLE_SECONDS = 10;
export const MAX_SAMPLE_SECONDS = 180;

// The registry model whose price rule prices each clone provider (TRD-07 §5):
// MiniMax bills a flat $1.50 per clone, ElevenLabs instant voice cloning is free
// on a plan, and the fal (Kling) path is priced from fal's clone endpoint.
const CLONE_PRICING: Record<CloneProvider, string> = {
  minimax: 'voice_clone',
  elevenlabs: 'ivc',
  fal: 'fal-ai/minimax/voice-clone',
};

// Price a clone from the registry so the confirmed figure is the figure the
// registry holds (F-VOI-02, F-PRV-05).
export async function priceClone(db: DatabaseState, provider: CloneProvider): Promise<Estimate> {
  const modelId = CLONE_PRICING[provider];
  const registry = await loadRegistry(db);
  const model = registry.models.find(
    (candidate) => candidate.provider === provider && candidate.model_id === modelId,
  );
  const snapshot = model ? registry.snapshots.get(`${provider}:${modelId}`) : undefined;
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

export interface CloneServices {
  db: DatabaseState;
  keyFor: (provider: CloneProvider) => Promise<string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface CloneResult {
  voice_ulid: string;
  provider: CloneProvider;
  voice_id: string;
  bound_to?: string;
}

// Whether the sample is long enough to clone (PRD-08 §B2 acceptance 1).
export function sampleLongEnough(seconds: number): boolean {
  return seconds >= MIN_SAMPLE_SECONDS;
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
  if (!sampleLongEnough(input.sample_seconds)) {
    throw new KilnryError(
      'INVALID_INPUT',
      `The sample is too short. Providers need at least ${MIN_SAMPLE_SECONDS} seconds of clean speech.`,
    );
  }

  // Binding to a real-person Character asserts the Character's own consent gate.
  let bindTarget: { characterId: string; version: number } | undefined;
  if (input.bind_to) {
    const head = await lookupHandle(services.db, input.bind_to);
    if (!head) throw new KilnryError('NOT_FOUND', `@${input.bind_to} is not a Character.`);
    if (head.is_real_person) await assertConsentForTraining(services.db, head.id);
    bindTarget = { characterId: head.id, version: head.current_version };
  }

  const key = await services.keyFor(input.provider);
  if (!key) throw new KilnryError('NO_PROVIDER', `${input.provider} has no connected key.`);

  // Price the clone from the registry, refuse it unless the confirmed figure
  // matches the priced one, and reserve the estimate against the budget caps
  // before any provider request (F-VOI-02, F-PRV-05). A free clone (ElevenLabs
  // instant voice cloning) passes confirmation and reservation and still records
  // one ledger row at $0.
  const cloneEstimate = await priceClone(services.db, input.provider);
  assertCostConfirmation(cloneEstimate, input.confirmed_cost_usd);
  await reserveBudget(services.db.db, {
    estimate_usd: cloneEstimate.estimate_usd,
    provider: input.provider,
    folder: 'inbox',
    now: now(),
  });
  const chargedUsd = cloneEstimate.authoritative_usd ?? cloneEstimate.estimate_usd;

  const voiceId = await cloneWithProvider(fetchImpl, input.provider, key, {
    name: input.name,
    sampleUrl: input.sample_url,
  });

  const voiceUlid = ulid();
  await recordClonedVoice(services.db, {
    id: voiceUlid,
    provider: input.provider,
    voice_id: voiceId,
    name: input.name,
    consent_confirmed_at: now(),
    cost_usd: chargedUsd,
    ...(input.sample_asset_id ? { sample_asset_id: input.sample_asset_id } : {}),
    ...(input.preview_asset_id ? { preview_asset_id: input.preview_asset_id } : {}),
  });
  // One spend-ledger row and one audit event for the clone (F-PRV-05, TRD-15).
  // The row has no job id because cloning does not go through the job queue; it
  // is keyed by the voice's own id so a clone is charged at most once.
  await services.db.db.insert(spendLedger).values({
    id: voiceUlid,
    providerId: input.provider,
    modelId: CLONE_PRICING[input.provider],
    folder: 'inbox',
    kind: 'voice_clone',
    estimateUsd: cloneEstimate.estimate_usd.toFixed(6),
    actualUsd: chargedUsd.toFixed(6),
    currencyNote: 'voice clone',
    occurredAt: now(),
  });
  await services.db.db.insert(auditEvents).values({
    id: ulid(),
    actor: 'user',
    action: 'voice.clone',
    target: input.name,
    meta: { provider: input.provider, estimate_usd: cloneEstimate.estimate_usd, actual_usd: chargedUsd },
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
): Promise<string> {
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
    return voiceId;
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
    return added.voice_id;
  }
  // Kling via fal create-voice.
  const created = (await postJson(fetchImpl, 'https://queue.fal.run/fal-ai/kling-video/create-voice', key, {
    voice_url: input.sampleUrl,
  })) as { voice_id?: string };
  if (!created.voice_id) throw new KilnryError('PROVIDER_ERROR', 'fal did not return a voice id.');
  return created.voice_id;
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
