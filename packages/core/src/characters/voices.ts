// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { and, desc, eq } from 'drizzle-orm';
import { voices as voicesTable, characterVoices, type DatabaseState } from '@kilnry/db';

// A voice a user can preview, pin, and @mention (F-VOI-01). Presets ship with
// Kilnry; clones are rows the user created (voice cloning itself is M5).
export interface VoiceListItem {
  provider: string;
  voice_id: string;
  name: string;
  language: string;
  gender: string;
  tags: string[];
  is_clone: boolean;
  // Price per 1,000 characters, or per minute for the token-priced models, shown
  // exactly as the reference documents it.
  price_label: string;
  preview_url?: string;
}

// The provider presets shipped with Kilnry (PRD-08 B1). Adapters that synthesise
// speech arrive in the next milestone; the registry and prices are available now
// so the Voices tab can list, filter and price every option.
const PRESETS: VoiceListItem[] = [
  {
    provider: 'elevenlabs',
    voice_id: 'rachel',
    name: 'Rachel',
    language: 'en-US',
    gender: 'female',
    tags: ['calm', 'narration'],
    is_clone: false,
    price_label: '$0.10 / 1k chars',
  },
  {
    provider: 'elevenlabs',
    voice_id: 'adam',
    name: 'Adam',
    language: 'en-US',
    gender: 'male',
    tags: ['news', 'deep'],
    is_clone: false,
    price_label: '$0.10 / 1k chars',
  },
  {
    provider: 'minimax',
    voice_id: 'moss_audio_female',
    name: 'Moss (female)',
    language: 'zh-CN',
    gender: 'female',
    tags: ['energetic'],
    is_clone: false,
    price_label: '$0.10 / 1k chars',
  },
  {
    provider: 'minimax',
    voice_id: 'moss_audio_male',
    name: 'Moss (male)',
    language: 'zh-CN',
    gender: 'male',
    tags: ['narration'],
    is_clone: false,
    price_label: '$0.10 / 1k chars',
  },
  {
    provider: 'openai',
    voice_id: 'alloy',
    name: 'Alloy',
    language: 'en-US',
    gender: 'neutral',
    tags: ['balanced'],
    is_clone: false,
    price_label: '≈ $0.015 / min',
  },
  {
    provider: 'openai',
    voice_id: 'nova',
    name: 'Nova',
    language: 'en-US',
    gender: 'female',
    tags: ['bright'],
    is_clone: false,
    price_label: '≈ $0.015 / min',
  },
  {
    provider: 'google',
    voice_id: 'en-US-Neural2-C',
    name: 'Neural2 C',
    language: 'en-US',
    gender: 'female',
    tags: ['news'],
    is_clone: false,
    price_label: '≈ $0.03 / min',
  },
  {
    provider: 'kokoro',
    voice_id: 'af_bella',
    name: 'Bella',
    language: 'en-US',
    gender: 'female',
    tags: ['warm'],
    is_clone: false,
    price_label: '$0.02 / 1k chars',
  },
];

const PROVIDERS = ['elevenlabs', 'minimax', 'openai', 'google', 'kokoro', 'kling', 'fish'] as const;

export const VOICE_PROVIDERS: readonly string[] = PROVIDERS;

export interface VoiceFilter {
  provider?: string;
  language?: string;
  gender?: string;
  type?: 'preset' | 'clone';
  query?: string;
}

export function presetVoices(): VoiceListItem[] {
  return PRESETS.map((preset) => ({ ...preset, tags: [...preset.tags] }));
}

// Apply the tab filters to a list of voices (pure, unit-tested).
export function filterVoices(list: VoiceListItem[], filter: VoiceFilter): VoiceListItem[] {
  const q = filter.query?.trim().toLowerCase();
  return list.filter((voice) => {
    if (filter.provider && voice.provider !== filter.provider) return false;
    if (filter.language && !voice.language.toLowerCase().startsWith(filter.language.toLowerCase()))
      return false;
    if (filter.gender && voice.gender !== filter.gender) return false;
    if (filter.type === 'preset' && voice.is_clone) return false;
    if (filter.type === 'clone' && !voice.is_clone) return false;
    if (q && !`${voice.name} ${voice.provider} ${voice.tags.join(' ')}`.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
}

// List every voice: the shipped presets plus the user's cloned voices from the
// database, newest clones first.
export async function listVoices(db: DatabaseState, filter: VoiceFilter = {}): Promise<VoiceListItem[]> {
  const cloneRows = await db.db.select().from(voicesTable).orderBy(desc(voicesTable.createdAt));
  const clones: VoiceListItem[] = cloneRows.map((row) => ({
    provider: row.providerId,
    voice_id: row.voiceId,
    name: row.name ?? row.voiceId,
    language: row.language ?? '—',
    gender: row.gender ?? '—',
    tags: row.tags ?? [],
    is_clone: row.isClone,
    price_label: '—',
    ...(row.previewAssetId ? { preview_url: `/api/media/${row.previewAssetId}` } : {}),
  }));
  return filterVoices([...clones, ...presetVoices()], filter);
}

// Bind one voice to a Character version (F-CHR-08). Binding is per version and a
// later version inherits it; a preset bind is free, a clone was already paid for.
// The stored value is the voices.id (a ulid), resolved to provider + voice_id at
// use. Binding never copies the voice: voices are shared.
export async function bindVoice(
  db: DatabaseState,
  characterId: string,
  version: number,
  voiceUlid: string,
): Promise<void> {
  const existing = await db.db
    .select({ characterId: characterVoices.characterId })
    .from(characterVoices)
    .where(and(eq(characterVoices.characterId, characterId), eq(characterVoices.version, version)))
    .limit(1);
  if (existing[0]) {
    await db.db
      .update(characterVoices)
      .set({ voiceUlid })
      .where(and(eq(characterVoices.characterId, characterId), eq(characterVoices.version, version)));
    return;
  }
  await db.db.insert(characterVoices).values({ characterId, version, voiceUlid });
}

// Remove a Character version's binding. The voice row itself is left untouched
// because voices are shared (PRD-07 §9 acceptance 3).
export async function unbindVoice(db: DatabaseState, characterId: string, version: number): Promise<void> {
  await db.db
    .delete(characterVoices)
    .where(and(eq(characterVoices.characterId, characterId), eq(characterVoices.version, version)));
}

/** The provider and voice id bound to a Character version, if any. */
export async function boundVoice(
  db: DatabaseState,
  characterId: string,
  version: number,
): Promise<{ ulid: string; provider: string; voice_id: string } | undefined> {
  const binding = await db.db
    .select({ voiceUlid: characterVoices.voiceUlid })
    .from(characterVoices)
    .where(and(eq(characterVoices.characterId, characterId), eq(characterVoices.version, version)))
    .limit(1);
  if (!binding[0]) return undefined;
  const row = await db.db.select().from(voicesTable).where(eq(voicesTable.id, binding[0].voiceUlid)).limit(1);
  if (!row[0]) return undefined;
  return { ulid: row[0].id, provider: row[0].providerId, voice_id: row[0].voiceId };
}

export interface ClonedVoiceInput {
  id: string;
  provider: string;
  voice_id: string;
  name: string;
  language?: string;
  consent_confirmed_at: Date;
  cost_usd?: number;
  sample_asset_id?: string;
  preview_asset_id?: string;
}

// Record a cloned voice row (F-VOI-02). A clone always carries is_clone, its
// clone kind, the exact provider voice id and the moment consent was confirmed.
export async function recordClonedVoice(db: DatabaseState, input: ClonedVoiceInput): Promise<void> {
  await db.db.insert(voicesTable).values({
    id: input.id,
    providerId: input.provider,
    voiceId: input.voice_id,
    name: input.name,
    language: input.language ?? null,
    isClone: true,
    cloneKind: 'instant',
    consentConfirmedAt: input.consent_confirmed_at,
    costUsd: input.cost_usd === undefined ? null : String(input.cost_usd),
    sampleAssetId: input.sample_asset_id ?? null,
    previewAssetId: input.preview_asset_id ?? null,
  });
}
