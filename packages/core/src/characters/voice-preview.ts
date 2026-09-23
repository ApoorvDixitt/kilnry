// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Voice preview and deletion (F-VOI-01). A preview synthesises a short fixed
// sample with a chosen voice; it is priced through the estimator, checked
// against the budget caps and recorded as one spend-ledger row, so even a
// few-cent preview shows up in the budget the user can see. Deletion removes a
// cloned voice and any binding that points at it. The provider call is passed in
// as `synth`, so this module never depends on the provider adapters.

import { and, eq } from 'drizzle-orm';
import { auditEvents, characterVoices, spendLedger, voices, type DatabaseState } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';
import { assertCostConfirmation, reserveBudget } from '../budget/enforcer.js';
import { estimate as priceEstimate } from '../registry/estimator.js';
import { loadRegistry } from '../registry/store.js';
import type { CanonicalRequest, Estimate, ProviderId } from '../types.js';

// The fixed preview sample. It is short, so a preview costs a fraction of a cent.
export const PREVIEW_SAMPLE = 'Hello from Kilnry. This is how this voice sounds.';

// The text-to-speech model each provider previews through, so the preview is
// priced from the same registry row the Audio strip uses (TRD-07 §5). Only
// ElevenLabs previews are wired today; other providers arrive with their own
// synthesis paths.
const PREVIEW_MODEL: Partial<Record<string, string>> = {
  elevenlabs: 'eleven_multilingual_v2',
};

// Price a preview of the given length from the provider's text-to-speech row.
export async function pricePreview(db: DatabaseState, provider: string, text: string): Promise<Estimate> {
  const modelId = PREVIEW_MODEL[provider];
  const registry = modelId ? await loadRegistry(db) : undefined;
  const model = registry?.models.find(
    (candidate) => candidate.provider === provider && candidate.model_id === modelId,
  );
  const snapshot = model ? registry?.snapshots.get(`${provider}:${modelId}`) : undefined;
  if (!model || !snapshot) {
    throw new KilnryError(
      'NO_PROVIDER',
      `Previews for ${provider} voices arrive with that provider's synthesis path. Connect an ElevenLabs key to preview ElevenLabs voices now.`,
    );
  }
  const request: CanonicalRequest = {
    kind: 'audio',
    capability: 'tts',
    prompt: text,
    params: {},
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  };
  return priceEstimate({ model, snapshot, request, text_chars: text.length });
}

export interface PreviewServices {
  db: DatabaseState;
  // The provider call that turns text into audio bytes; passed in so this module
  // stays free of the provider adapters.
  synth: (input: { provider: string; voiceId: string; text: string }) => Promise<{
    bytes: Uint8Array;
    mime: string;
  }>;
  now?: () => Date;
}

// Preview a voice: price the sample, reserve it against the budget, synthesise it
// and record exactly one spend-ledger row and one audit event (F-VOI-01,
// F-PRV-05). Returns the audio bytes for the caller to stream or embed.
export async function previewVoice(
  services: PreviewServices,
  input: { provider: string; voiceId: string; text?: string },
): Promise<{ bytes: Uint8Array; mime: string; estimate_usd: number }> {
  const now = services.now ?? (() => new Date());
  const text = input.text && input.text.trim() !== '' ? input.text : PREVIEW_SAMPLE;
  const estimate = await pricePreview(services.db, input.provider, text);
  assertCostConfirmation(estimate, estimate.estimate_usd);
  await reserveBudget(services.db.db, {
    estimate_usd: estimate.estimate_usd,
    provider: input.provider as ProviderId,
    folder: 'inbox',
    now: now(),
  });
  const chargedUsd = estimate.authoritative_usd ?? estimate.estimate_usd;
  const audio = await services.synth({ provider: input.provider, voiceId: input.voiceId, text });
  await services.db.db.insert(spendLedger).values({
    id: ulid(),
    providerId: input.provider,
    modelId: PREVIEW_MODEL[input.provider] ?? null,
    folder: 'inbox',
    kind: 'voice_preview',
    estimateUsd: estimate.estimate_usd.toFixed(6),
    actualUsd: chargedUsd.toFixed(6),
    currencyNote: 'voice preview',
    occurredAt: now(),
  });
  await services.db.db.insert(auditEvents).values({
    id: ulid(),
    actor: 'user',
    action: 'voice.preview',
    target: input.voiceId,
    meta: { provider: input.provider, estimate_usd: estimate.estimate_usd, actual_usd: chargedUsd },
  });
  return { bytes: audio.bytes, mime: audio.mime, estimate_usd: estimate.estimate_usd };
}

// Delete a stored voice and remove any Character binding that points at it
// (F-VOI-01). Returns false when no such voice exists.
export async function deleteVoice(db: DatabaseState, voiceUlid: string): Promise<boolean> {
  const rows = await db.db.select({ id: voices.id }).from(voices).where(eq(voices.id, voiceUlid)).limit(1);
  if (!rows[0]) return false;
  await db.db.delete(characterVoices).where(eq(characterVoices.voiceUlid, voiceUlid));
  await db.db.delete(voices).where(and(eq(voices.id, voiceUlid)));
  await db.db.insert(auditEvents).values({
    id: ulid(),
    actor: 'user',
    action: 'voice.delete',
    target: voiceUlid,
    meta: {},
  });
  return true;
}
