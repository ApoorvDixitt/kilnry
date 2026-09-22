// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { CanonicalRequest, MediaRole, Strategy } from '../types.js';
import type { CharacterHead, LoadedVersion } from './store.js';

// A trained low-rank adaptation (LoRA) or hosted identity available for a version.
export interface TrainedIdentityInfo {
  provider: string;
  kind: 'lora' | 'soul_id' | 'hosted_character';
  status: string;
  base_model?: string;
  trigger_word?: string;
  default_scale?: number;
  artifact_url?: string;
  local_path?: string;
  remote_id?: string;
}

// Everything the resolver needs from the data layer, injected so it stays pure
// and unit-testable without a live database (TRD-14 §3).
export interface ResolverCtx {
  lookupHandle: (handle: string) => CharacterHead | undefined;
  loadVersion: (id: string, version?: number) => LoadedVersion;
  identitiesFor?: (id: string, version: number) => TrainedIdentityInfo[];
  // Turn an asset id into the provider-facing URL the adapter will fetch.
  assetUrl: (assetId: string) => string;
  knownHandles?: string[];
}

// One resolved reference or identity injection for a target (TRD-14 §3).
export interface Injection {
  handle: string;
  id: string;
  version: number;
  kind: 'character' | 'prop' | 'environment' | 'style';
  strategy: Strategy;
  inputs: Array<{ role: MediaRole; asset_id: string; view?: string; label?: string; weight?: number }>;
  lora?: { path: string; scale: number; trigger_word?: string; base_model: string };
  identity?: { provider: string; remote_id: string; strength: number };
  voice?: { provider: string; voice_id: string };
  slot_index?: number;
  // Whether the mentioned Character is a real person, and what consent is on
  // record. Surfaces are shown these so they can ask for the extra confirmation
  // before a real person's likeness goes to a provider that trains on inputs.
  is_real_person?: boolean;
  consent_status?: string;
  notes: string[];
}

export interface ResolvedRequest extends Omit<CanonicalRequest, 'injections'> {
  prompt: string;
  injections: Injection[];
  provider_fragment: Record<string, unknown>;
  warnings: string[];
  original_prompt: string;
}

// The output of one emitter: what it contributes to the payload and the prompt.
export interface EmitResult {
  inputs: Injection['inputs'];
  fragment: Record<string, unknown>;
  replacement: string;
  refsUsed: number;
  slot_index?: number;
  notes: string[];
  warnings: string[];
  trigger_word?: string;
  lora?: Injection['lora'];
  identity?: Injection['identity'];
  voice?: Injection['voice'];
}

export interface EmitContext {
  slot: number;
  refBudget: number;
  usedTriggers: Set<string>;
  ctx: ResolverCtx;
  // How many elements have already been emitted (for @Element{k} numbering).
  emittedElements?: number;
}

export type MediaKind = 'image' | 'video' | 'audio';

// Which of the three strategy orders applies, from the target kind and medias.
export function mediaKindFor(req: CanonicalRequest): MediaKind {
  if (req.kind === 'audio') return 'audio';
  if (req.kind === 'video' || req.kind === 'video_edit') return 'video';
  return 'image';
}

// The D-23 default strategy orders.
export const STRATEGY_ORDER: Record<MediaKind, Strategy[]> = {
  image: ['lora', 'identity_id', 'reference_images', 'text'],
  video: ['elements', 'reference_images', 'start_frame', 'text'],
  audio: ['voice_id', 'text'],
};
