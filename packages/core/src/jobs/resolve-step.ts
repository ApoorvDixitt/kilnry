// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { DatabaseState } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import type { ModelManifest } from '../registry/manifest.js';
import { resolvePromptFromDb } from '../characters/resolve-db.js';
import type { CanonicalRequest } from '../types.js';

// The engine runs the one character resolver for every surface (TRD-14 §1,
// TRD-08 JobHandler.prepare, F-CHR-09). It happens once, in estimate(), against
// the routed model, so the price reflects the resolved inputs (Kling elements
// double the per-second rate) and the request createJob stores is the request
// the worker submits. The worker never resolves again.
//
// Reference images are Library assets, which the provider cannot fetch until the
// worker uploads them. The resolver's payload fragments (elements[], loras[],
// image_reference_url …) therefore carry a placeholder URL per asset here, and
// bindFragmentAssets() swaps each for the uploaded URL right before submit.

const PLACEHOLDER_PREFIX = 'kilnry-asset://';
const PLACEHOLDER = /^kilnry-asset:\/\/(.+)$/;

// The same mention shapes resolve-db scans for, used only to skip the resolver
// (and its Character lookups) for the common prompt with no mention at all.
const MENTION =
  /(?:^|[\s(,"'])@([a-z0-9_-]{2,32})(?:@v([1-9][0-9]*))?|<<<([0-9A-HJKMNP-TV-Z]{26})(?:@v([1-9][0-9]*))?>>>/i;

export function placeholderAssetUrl(assetId: string): string {
  return `${PLACEHOLDER_PREFIX}${assetId}`;
}

export function mentionsPossible(request: CanonicalRequest): boolean {
  if (MENTION.test(request.prompt)) return true;
  const explicit = (request as { characters?: unknown }).characters;
  return Array.isArray(explicit) && explicit.length > 0;
}

export interface ResolvedForEngine {
  request: CanonicalRequest;
  fragment: Record<string, unknown>;
  warnings: string[];
  voice_mismatch?: { handle: string; provider: string; voice_id: string };
}

/**
 * Resolve every @mention in the request against the routed model and fold the
 * result into the canonical request: the rewritten prompt and negative prompt,
 * the injected reference medias, the injection record for lineage, and the
 * user's typed prompt kept as original_prompt for the sidecar (TRD-05).
 * The provider payload fragment is returned separately so the caller can merge
 * it into params.extra. Throws the resolver's own INVALID_INPUT (people cap).
 */
export async function resolveForEngine(
  state: DatabaseState,
  request: CanonicalRequest,
  model: ModelManifest,
): Promise<ResolvedForEngine> {
  const resolved = await resolvePromptFromDb(state, request, model, { assetUrl: placeholderAssetUrl });
  const injections: CanonicalRequest['injections'] = resolved.injections.map((injection) => ({
    handle: injection.handle,
    version: injection.version,
    strategy: injection.strategy,
    inputs: injection.inputs.map((input) => input.asset_id),
  }));
  return {
    request: {
      ...request,
      prompt: resolved.prompt,
      ...(resolved.negative_prompt === undefined ? {} : { negative_prompt: resolved.negative_prompt }),
      medias: resolved.medias,
      injections,
      original_prompt: request.original_prompt ?? request.prompt,
    },
    fragment: resolved.provider_fragment,
    warnings: resolved.warnings,
    ...(resolved.voice_mismatch ? { voice_mismatch: resolved.voice_mismatch } : {}),
  };
}

// Deep-merge a resolver fragment into params.extra the way the resolver merges
// emitter fragments: arrays concatenate, objects recurse, scalars overwrite.
export function mergeFragment(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    // The same guard the resolver's deepMerge and the workflows templater use:
    // a fragment with an own __proto__ key must not reach Object.prototype
    // (F-26).
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const existing = out[key];
    if (Array.isArray(existing) && Array.isArray(value)) out[key] = [...existing, ...value];
    else if (isRecord(existing) && isRecord(value)) out[key] = mergeFragment(existing, value);
    else out[key] = value;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Replace every placeholder asset URL inside params.extra with the URL the
 * worker's media upload produced for that asset, and drop those medias from the
 * list the adapter maps by role so a Kling element's images are not also sent as
 * image_urls. The request is returned unchanged when no fragment carries one.
 */
export function bindFragmentAssets(request: CanonicalRequest): CanonicalRequest {
  const extra = request.params.extra;
  if (!extra || !JSON.stringify(extra).includes(PLACEHOLDER_PREFIX)) return request;
  const urlByAsset = new Map<string, string>();
  for (const media of request.medias) {
    if (media.asset_id && media.url) urlByAsset.set(media.asset_id, media.url);
  }
  const used = new Set<string>();
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const match = PLACEHOLDER.exec(value);
      if (!match) return value;
      const assetId = match[1]!;
      const url = urlByAsset.get(assetId);
      if (!url) {
        throw new KilnryError(
          'INVALID_INPUT',
          'A Character reference this prompt needs is not in the Library, so it cannot be sent to the provider.',
          { details: { asset_id: assetId } },
        );
      }
      used.add(assetId);
      return url;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (isRecord(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) out[key] = walk(inner);
      return out;
    }
    return value;
  };
  const bound = walk(extra) as Record<string, unknown>;
  return {
    ...request,
    params: { ...request.params, extra: bound },
    // A media the fragment now carries is not sent twice — but only the
    // reference-shaped roles are in the fragment. A first or last frame, an
    // audio track or a driving video is its own payload field on the endpoint
    // (fal's start_image_url), so it stays even when the same asset also rides
    // in elements[] (D-72: the Character's anchor opens the video and is the
    // element's frontal image).
    medias: request.medias.filter(
      (media) =>
        !(
          media.asset_id &&
          used.has(media.asset_id) &&
          ['reference', 'style', 'product'].includes(media.role)
        ),
    ),
  };
}
