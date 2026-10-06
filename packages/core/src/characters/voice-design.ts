// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Voice design (F-VOI-03, PRD-08 §B3). Design a reusable synthetic voice from a
// text description — no sample, no real speaker, so no consent gate — through
// MiniMax Voice Design ($3 per voice) or fal's fal-ai/minimax/voice-design. The
// money path mirrors voice-clone.ts exactly: price from the registry, confirm,
// reserve, one spend-ledger row and one audit event. The designed voice is a
// voices row with clone_kind 'design', bindable like a clone.

import type { DatabaseState } from '@kilnry/db';
import { auditEvents } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { priceMaxAgeDays } from '../registry/price-age.js';
import { ulid } from '../ids.js';
import {
  assertCostConfirmation,
  assertFreshPrice,
  holdSpend,
  releaseHold,
  settleHold,
} from '../budget/enforcer.js';
import { estimate as priceEstimate } from '../registry/estimator.js';
import { loadRegistry } from '../registry/store.js';
import type { CanonicalRequest, Estimate } from '../types.js';
import { lookupHandle } from './store.js';
import { bindVoice, recordDesignedVoice } from './voices.js';
import { FalQueueTimeout, submitAndPollFalQueue } from './fal-queue.js';

export type DesignProvider = 'minimax' | 'fal';

export const MAX_DESCRIPTION_CHARS = 300;

// The registry model that prices each design provider (TRD-07 §5): MiniMax bills
// a flat $3 per designed voice, the fal path through fal-ai/minimax/voice-design.
const DESIGN_PRICING: Record<DesignProvider, string> = {
  minimax: 'voice_design',
  fal: 'fal-ai/minimax/voice-design',
};

export interface DesignProviderCard {
  provider: DesignProvider;
  label: string;
  cost_usd: number;
}

export const DESIGN_PROVIDERS: Record<DesignProvider, DesignProviderCard> = {
  minimax: { provider: 'minimax', label: 'MiniMax Voice Design', cost_usd: 3 },
  fal: { provider: 'fal', label: 'MiniMax Voice Design (via fal)', cost_usd: 3 },
};

// Price a design from the registry so the confirmed figure is the registry's
// (F-VOI-03 acceptance 1: the price is shown before submit).
export async function priceDesign(
  db: DatabaseState,
  provider: DesignProvider,
  now: Date = new Date(),
): Promise<Estimate> {
  const modelId = DESIGN_PRICING[provider];
  const registry = await loadRegistry(db);
  const model = registry.models.find(
    (candidate) => candidate.provider === provider && candidate.model_id === modelId,
  );
  const snapshot = model ? registry.snapshots.get(`${provider}:${modelId}`) : undefined;
  if (!model || !snapshot) {
    throw new KilnryError(
      'NO_PROVIDER',
      `No price is registered for ${provider} voice design; refresh provider prices and try again.`,
    );
  }
  const request: CanonicalRequest = {
    kind: 'audio',
    capability: 'voice_clone',
    prompt: `design ${provider}`,
    params: {},
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  };
  return priceEstimate({ model, snapshot, request, now, price_max_age_days: await priceMaxAgeDays(db) });
}

export interface DesignInput {
  name: string;
  provider: DesignProvider;
  // Pay from a price snapshot older than 30 days anyway (F-21).
  allow_stale_price?: boolean;
  description: string;
  preview_text: string;
  language?: string;
  gender?: string;
  confirmed_cost_usd: number;
  bind_to?: string;
}

export interface DesignServices {
  db: DatabaseState;
  keyFor: (provider: DesignProvider) => Promise<string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
  // Save the provider's preview audio as an asset and return its id, so a paid
  // design is audible the way clones are (item 7). Optional: when absent, the
  // preview url is still returned to the caller but not stored as an asset.
  storePreview?: (input: { url: string; name: string }) => Promise<string | undefined>;
  // Test-only poll tuning so a timeout can be exercised without a 2-minute wait.
  falPoll?: { budgetMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
}

export interface DesignResult {
  voice_ulid: string;
  provider: DesignProvider;
  voice_id: string;
  bound_to?: string;
  preview_audio_url?: string;
}

// Design a voice from a text description and, optionally, bind it to a Character
// version. No consent gate (synthetic voice), but the price must be confirmed
// and reserved before any provider request, exactly like a clone.
export async function designVoice(services: DesignServices, input: DesignInput): Promise<DesignResult> {
  const fetchImpl = services.fetch ?? fetch;
  const now = services.now ?? (() => new Date());
  const description = input.description.trim();
  if (description === '') {
    throw new KilnryError('INVALID_INPUT', 'Describe the voice you want to design.');
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    throw new KilnryError(
      'INVALID_INPUT',
      `The description is too long; keep it under ${MAX_DESCRIPTION_CHARS} characters.`,
    );
  }

  let bindTarget: { characterId: string; version: number } | undefined;
  if (input.bind_to) {
    const head = await lookupHandle(services.db, input.bind_to);
    if (!head) throw new KilnryError('NOT_FOUND', `@${input.bind_to} is not a Character.`);
    bindTarget = { characterId: head.id, version: head.current_version };
  }

  const key = await services.keyFor(input.provider);
  if (!key) throw new KilnryError('NO_PROVIDER', `${input.provider} has no connected key.`);

  // Price → confirm → hold before any provider request (F-VOI-03, F-PRV-04,
  // PRD-14 "reserve"): the cap check and a pending ledger row at the estimate are
  // one locked transaction, keyed by the voice's own id so a design is charged at
  // most once.
  const designEstimate = await priceDesign(services.db, input.provider, services.now?.() ?? new Date());
  assertFreshPrice(designEstimate, input.allow_stale_price, await priceMaxAgeDays(services.db));
  assertCostConfirmation(designEstimate, input.confirmed_cost_usd);
  const chargedUsd = designEstimate.authoritative_usd ?? designEstimate.estimate_usd;
  const voiceUlid = ulid();
  const hold = await holdSpend(services.db, {
    ledger_id: voiceUlid,
    estimate_usd: designEstimate.estimate_usd,
    provider: input.provider,
    model_id: DESIGN_PRICING[input.provider],
    kind: 'voice_clone',
    folder: 'inbox',
    now: now(),
  });

  // Fold the language and gender hints (PRD-08 §B3) into the description the
  // provider reads; both MiniMax and fal design a voice from a single prompt.
  const described = [
    input.description,
    input.gender ? `Gender: ${input.gender}.` : '',
    input.language ? `Language: ${input.language}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  let designed: { voiceId: string; previewAudioUrl?: string; requestId?: string };
  try {
    designed = await designWithProvider(
      fetchImpl,
      input.provider,
      key,
      { prompt: described, previewText: input.preview_text },
      services.falPoll,
    );
  } catch (error) {
    // A fal queue timeout: fal has accepted and will bill, so the hold stays as
    // the charge at the estimate with the request id rather than vanishing, and
    // a TIMEOUT the caller can show names the request (default; adjustable).
    if (error instanceof FalQueueTimeout) {
      await settleHold(services.db, hold, {
        actual_usd: chargedUsd,
        note: `ambiguous: fal request ${error.request_id}`,
      });
      throw new KilnryError('TIMEOUT', `fal voice design did not finish (request ${error.request_id}).`, {
        provider: 'fal',
        retryable: true,
      });
    }
    // The provider refused or failed before charging: release the hold.
    await releaseHold(services.db, hold);
    throw error;
  }
  const voiceId = designed.voiceId;

  // Store the preview audio as an asset when a sink is provided, so it plays in
  // the voices list like a clone's preview (item 7).
  const previewAssetId = designed.previewAudioUrl
    ? await services
        .storePreview?.({ url: designed.previewAudioUrl, name: input.name })
        .catch(() => undefined)
    : undefined;

  await recordDesignedVoice(services.db, {
    id: voiceUlid,
    provider: input.provider,
    voice_id: voiceId,
    name: input.name,
    consent_confirmed_at: now(),
    cost_usd: chargedUsd,
    ...(input.language ? { language: input.language } : {}),
    ...(previewAssetId ? { preview_asset_id: previewAssetId } : {}),
  });
  // The hold becomes the design's ledger row; one audit event beside it
  // (F-PRV-05, TRD-15). The fal request id is in the audit meta so a spend can
  // be traced back to fal.
  await settleHold(services.db, hold, { actual_usd: chargedUsd, note: 'voice design' });
  await services.db.db.insert(auditEvents).values({
    id: ulid(),
    actor: 'user',
    action: 'voice.design',
    target: input.name,
    meta: {
      provider: input.provider,
      estimate_usd: designEstimate.estimate_usd,
      actual_usd: chargedUsd,
      ...(designed.requestId ? { fal_request_id: designed.requestId } : {}),
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
    ...(designed.previewAudioUrl ? { preview_audio_url: designed.previewAudioUrl } : {}),
  };
}

// Send the description to the provider and return the new voice id, the preview
// audio (so a paid design is audible), and the fal request id when relevant.
// MiniMax: POST /v1/voice_design { prompt, preview_text } → { voice_id,
// trial_audio, base_resp.status_code } (platform.minimax.io/docs/api-reference/
// voice-design-design; status_code 0 is success, 1026 is a moderation reject).
// fal: fal-ai/minimax/voice-design is a QUEUE endpoint — submit → poll status →
// GET response — whose output is { custom_voice_id, audio } (schema:
// MinimaxVoiceDesignOutput at fal.ai/api/openapi/queue/openapi.json?endpoint_id=
// fal-ai/minimax/voice-design; required custom_voice_id, audio).
async function designWithProvider(
  fetchImpl: typeof fetch,
  provider: DesignProvider,
  key: string,
  input: { prompt: string; previewText: string },
  falPoll?: { budgetMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<{ voiceId: string; previewAudioUrl?: string; requestId?: string }> {
  if (provider === 'minimax') {
    const designed = (await postJson(fetchImpl, 'https://api.minimax.io/v1/voice_design', key, {
      prompt: input.prompt,
      preview_text: input.previewText,
    })) as { voice_id?: string; trial_audio?: string; base_resp?: { status_code?: number } };
    const code = designed.base_resp?.status_code ?? 0;
    if (code === 1026)
      throw new KilnryError('MODERATION_REJECTED', 'MiniMax rejected the voice description.', {
        provider: 'minimax',
        retryable: false,
      });
    if (code !== 0 || !designed.voice_id)
      throw new KilnryError('PROVIDER_ERROR', `MiniMax voice design failed (status ${code}).`, {
        provider: 'minimax',
        retryable: true,
      });
    // Keep the trial audio MiniMax returns as the voice's preview so a user who
    // paid $3 can hear it (item 7); it is a URL or a base64 data string.
    return {
      voiceId: designed.voice_id,
      ...(designed.trial_audio ? { previewAudioUrl: designed.trial_audio } : {}),
    };
  }
  const { output, request_id } = await submitAndPollFalQueue(
    fetchImpl,
    'fal-ai/minimax/voice-design',
    key,
    { prompt: input.prompt, preview_text: input.previewText },
    falPoll ?? {},
  );
  const voiceId = typeof output.custom_voice_id === 'string' ? output.custom_voice_id : undefined;
  if (!voiceId)
    throw new KilnryError('PROVIDER_ERROR', 'fal voice design returned no custom_voice_id.', {
      provider: 'fal',
      retryable: true,
    });
  const audio = output.audio as { url?: string } | undefined;
  return {
    voiceId,
    requestId: request_id,
    ...(audio?.url ? { previewAudioUrl: audio.url } : {}),
  };
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  key: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers.Authorization = url.includes('fal.run') ? `Key ${key}` : `Bearer ${key}`;
  const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok)
    throw new KilnryError('PROVIDER_ERROR', `The provider returned ${response.status}.`, {
      retryable: response.status >= 500,
    });
  return response.json();
}
