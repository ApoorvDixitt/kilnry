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
import { auditEvents, spendLedger } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';
import { assertCostConfirmation, reserveBudget } from '../budget/enforcer.js';
import { estimate as priceEstimate } from '../registry/estimator.js';
import { loadRegistry } from '../registry/store.js';
import type { CanonicalRequest, Estimate } from '../types.js';
import { lookupHandle } from './store.js';
import { bindVoice, recordDesignedVoice } from './voices.js';

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
export async function priceDesign(db: DatabaseState, provider: DesignProvider): Promise<Estimate> {
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
  return priceEstimate({ model, snapshot, request });
}

export interface DesignInput {
  name: string;
  provider: DesignProvider;
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
}

export interface DesignResult {
  voice_ulid: string;
  provider: DesignProvider;
  voice_id: string;
  bound_to?: string;
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

  // Price → confirm → reserve before any provider request (F-VOI-03, F-PRV-05).
  const designEstimate = await priceDesign(services.db, input.provider);
  assertCostConfirmation(designEstimate, input.confirmed_cost_usd);
  await reserveBudget(services.db.db, {
    estimate_usd: designEstimate.estimate_usd,
    provider: input.provider,
    folder: 'inbox',
    now: now(),
  });
  const chargedUsd = designEstimate.authoritative_usd ?? designEstimate.estimate_usd;

  const voiceId = await designWithProvider(fetchImpl, input.provider, key, {
    prompt: input.description,
    previewText: input.preview_text,
  });

  const voiceUlid = ulid();
  await recordDesignedVoice(services.db, {
    id: voiceUlid,
    provider: input.provider,
    voice_id: voiceId,
    name: input.name,
    consent_confirmed_at: now(),
    cost_usd: chargedUsd,
    ...(input.language ? { language: input.language } : {}),
  });
  // One spend-ledger row and one audit event, keyed by the voice ulid so a
  // design is charged at most once (F-PRV-05, TRD-15).
  await services.db.db.insert(spendLedger).values({
    id: voiceUlid,
    providerId: input.provider,
    modelId: DESIGN_PRICING[input.provider],
    folder: 'inbox',
    kind: 'voice_clone',
    estimateUsd: designEstimate.estimate_usd.toFixed(6),
    actualUsd: chargedUsd.toFixed(6),
    currencyNote: 'voice design',
    occurredAt: now(),
  });
  await services.db.db.insert(auditEvents).values({
    id: ulid(),
    actor: 'user',
    action: 'voice.design',
    target: input.name,
    meta: { provider: input.provider, estimate_usd: designEstimate.estimate_usd, actual_usd: chargedUsd },
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

// Send the description to the provider and return the new voice id. MiniMax:
// POST /v1/voice_design { prompt, preview_text } → { voice_id, trial_audio,
// base_resp.status_code } (platform.minimax.io/docs/api-reference/
// voice-design-design; status_code 0 is success, 1026 is a moderation reject).
// fal: fal-ai/minimax/voice-design returns { voice_id } (fal.ai/models/
// fal-ai/minimax/voice-design/api).
async function designWithProvider(
  fetchImpl: typeof fetch,
  provider: DesignProvider,
  key: string,
  input: { prompt: string; previewText: string },
): Promise<string> {
  if (provider === 'minimax') {
    const designed = (await postJson(fetchImpl, 'https://api.minimax.io/v1/voice_design', key, {
      prompt: input.prompt,
      preview_text: input.previewText,
    })) as { voice_id?: string; base_resp?: { status_code?: number } };
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
    return designed.voice_id;
  }
  const created = (await postJson(fetchImpl, 'https://queue.fal.run/fal-ai/minimax/voice-design', key, {
    prompt: input.prompt,
    preview_text: input.previewText,
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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers.Authorization = url.includes('fal.run') ? `Key ${key}` : `Bearer ${key}`;
  const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok)
    throw new KilnryError('PROVIDER_ERROR', `The provider returned ${response.status}.`, {
      retryable: response.status >= 500,
    });
  return response.json();
}
