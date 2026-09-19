// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { KilnryError } from '../errors.js';
import type { CanonicalRequest, Estimate, ProviderId } from '../types.js';
import { estimate } from './estimator.js';
import type { ModelManifest, PriceSnapshot, Resolution } from './manifest.js';

export interface RouteConstraints {
  needs_audio?: boolean;
  refs_count?: number;
  refs_kinds?: Array<'image' | 'video' | 'audio'>;
  duration_s?: number;
  min_resolution?: Resolution;
  aspect_ratio?: string;
  needs_lora?: boolean;
  needs_identity?: 'higgsfield_soul_id';
  needs_voice_ids?: boolean;
  needs_start_end?: boolean;
  quality?: 'draft' | 'standard' | 'premium';
  max_price_usd?: number;
  exclude_training_on_inputs?: boolean;
  tags?: string[];
  pinned_model?: string;
  provider?: ProviderId;
}

export interface ProviderRouteState {
  connected: boolean;
  status: 'ok' | 'degraded' | 'error' | 'not_connected';
  degraded_until?: Date;
  health_score?: number;
}

export interface RouteResult {
  provider: ProviderId;
  model_id: string;
  why: string;
  estimate: Estimate;
  alternates: Array<{ provider: ProviderId; model_id: string; estimate_usd: number; why_not_chosen: string }>;
}

const providerPriority: ProviderId[] = [
  'fal',
  'openrouter',
  'google',
  'openai',
  'elevenlabs',
  'minimax',
  'higgsfield',
  'ollama',
  'replicate',
  'kie',
  'wavespeed',
  'pollinations',
];
const tierRank = { draft: 0, standard: 1, premium: 2 } as const;
const resolutionRank: Record<string, number> = {
  '0.5K': 0,
  '480p': 0,
  '720p': 1,
  '768p': 1,
  '768P': 1,
  '1K': 1,
  '1080p': 2,
  '2k': 3,
  '2K': 3,
  '4k': 4,
  '4K': 4,
};

function durationAllowed(model: ModelManifest, seconds: number): boolean {
  const supported = model.supports.durations;
  if (!supported) return true;
  if (Array.isArray(supported)) {
    const sorted = [...supported].sort((left, right) => left - right);
    return seconds >= (sorted[0] ?? seconds) && seconds <= (sorted.at(-1) ?? seconds);
  }
  return seconds >= supported.min && seconds <= supported.max;
}

function blockedByCanon(model: ModelManifest): string | undefined {
  if (/sora/i.test(model.model_id)) return 'Sora is retired';
  if (/gemini-2\.5-flash-image|fal-ai\/nano-banana(?:\/|$)/i.test(model.model_id)) return 'model is retired';
  if (model.provider === 'fal' && /seedance-2\.5/.test(model.model_id))
    return 'Seedance 2.5 must route through OpenRouter or Higgsfield';
  return undefined;
}

function rejection(
  model: ModelManifest,
  constraints: RouteConstraints,
  providers: Partial<Record<ProviderId, ProviderRouteState>>,
  now: Date,
): string | undefined {
  const canon = blockedByCanon(model);
  if (canon) return canon;
  if (!model.enabled || model.deprecated_at) return 'model is disabled or deprecated';
  const provider = providers[model.provider];
  if (!provider?.connected || !['ok', 'degraded'].includes(provider.status))
    return `add ${model.provider} key`;
  if (provider.status === 'degraded' && provider.degraded_until && provider.degraded_until > now)
    return `${model.provider} paused after errors`;
  if (constraints.provider && constraints.provider !== model.provider)
    return `provider ${constraints.provider} required`;
  if (constraints.exclude_training_on_inputs && model.training_on_inputs) return 'provider trains on inputs';
  if (constraints.needs_audio && !model.supports.audio) return 'audio is not supported';
  const references = constraints.refs_count ?? 0;
  if (references > model.supports.references_max && !model.supports.elements)
    return `accepts only ${model.supports.references_max} references`;
  if (constraints.refs_kinds?.some((kind) => !model.media_roles.some((role) => role.kinds.includes(kind))))
    return 'reference kind is not supported';
  if (constraints.duration_s && !durationAllowed(model, constraints.duration_s))
    return `duration ${constraints.duration_s} s is not supported`;
  if (constraints.min_resolution) {
    const maximum = Math.max(...model.supports.resolutions.map((value) => resolutionRank[value] ?? -1), -1);
    if (maximum < (resolutionRank[constraints.min_resolution] ?? 0))
      return `resolution ${constraints.min_resolution} is not supported`;
  }
  if (
    constraints.aspect_ratio &&
    !model.supports.aspect_ratios.includes('auto') &&
    !model.supports.aspect_ratios.includes(constraints.aspect_ratio)
  )
    return `aspect ${constraints.aspect_ratio} is not supported`;
  if (constraints.needs_lora && !model.supports.lora) return 'LoRA is not supported';
  if (constraints.needs_identity && !model.supports.identity_ids.includes(constraints.needs_identity))
    return 'identity id is not supported';
  if (constraints.needs_voice_ids && !model.supports.voice_ids) return 'voice ids are not supported';
  if (constraints.needs_start_end && !model.supports.start_end_frame)
    return 'start/end frames are not supported';
  if (constraints.tags?.some((tag) => !model.tags.includes(tag)))
    return `missing tag ${constraints.tags.find((tag) => !model.tags.includes(tag))}`;
  if (constraints.quality && tierRank[model.quality_tier] < tierRank[constraints.quality])
    return `${constraints.quality} quality required`;
  return undefined;
}

export function route(
  request: CanonicalRequest,
  constraints: RouteConstraints,
  context: {
    models: ModelManifest[];
    snapshots: ReadonlyMap<string, PriceSnapshot>;
    providers: Partial<Record<ProviderId, ProviderRouteState>>;
    now?: Date;
    price_max_age_days?: number;
  },
): RouteResult {
  const now = context.now ?? new Date();
  const requested = constraints.pinned_model
    ? context.models.filter(
        (model) =>
          model.model_id === constraints.pinned_model ||
          `${model.provider}/${model.model_id}` === constraints.pinned_model,
      )
    : context.models.filter((model) => model.capabilities.includes(request.capability));
  if (constraints.pinned_model && requested.length === 0)
    throw new KilnryError('NOT_FOUND', `Model ${constraints.pinned_model} is not in the registry.`);

  const rejected: Array<{ model: ModelManifest; reason: string }> = [];
  const candidates: Array<{ model: ModelManifest; estimate: Estimate }> = [];
  for (const model of requested) {
    const reason = rejection(model, constraints, context.providers, now);
    if (reason) {
      rejected.push({ model, reason });
      continue;
    }
    const snapshot = context.snapshots.get(`${model.provider}:${model.model_id}`);
    if (!snapshot) {
      rejected.push({ model, reason: 'price is unavailable' });
      continue;
    }
    const priced = estimate({
      model,
      snapshot,
      request,
      now,
      ...(context.price_max_age_days === undefined ? {} : { price_max_age_days: context.price_max_age_days }),
    });
    if (constraints.max_price_usd !== undefined && priced.estimate_usd > constraints.max_price_usd) {
      rejected.push({ model, reason: `over your $${constraints.max_price_usd.toFixed(2)} cap` });
      continue;
    }
    candidates.push({ model, estimate: priced });
  }
  if (candidates.length === 0) {
    const details = rejected
      .slice(0, 3)
      .map(({ model, reason }) => `${model.display_name}: ${reason}`)
      .join('; ');
    const prefix = constraints.pinned_model
      ? 'The selected model cannot run this request.'
      : 'No connected provider can do this.';
    throw new KilnryError('NO_PROVIDER', details ? `${prefix} ${details}` : prefix, { details: rejected });
  }

  candidates.sort((left, right) => {
    if (constraints.quality === 'premium' && left.model.quality_tier !== right.model.quality_tier)
      return tierRank[right.model.quality_tier] - tierRank[left.model.quality_tier];
    const difference = left.estimate.estimate_usd - right.estimate.estimate_usd;
    const baseline = Math.max(left.estimate.estimate_usd, right.estimate.estimate_usd, 0.000001);
    if (Math.abs(difference) / baseline > 0.05) return difference;
    if (left.model.quality_tier !== right.model.quality_tier)
      return tierRank[right.model.quality_tier] - tierRank[left.model.quality_tier];
    const health =
      (context.providers[right.model.provider]?.health_score ?? 1) -
      (context.providers[left.model.provider]?.health_score ?? 1);
    if (health !== 0) return health;
    const providerOrder =
      providerPriority.indexOf(left.model.provider) - providerPriority.indexOf(right.model.provider);
    return providerOrder || left.model.model_id.localeCompare(right.model.model_id);
  });

  const winner = candidates[0]!;
  const constraintText = [
    constraints.needs_audio ? 'audio' : undefined,
    (constraints.refs_count ?? 0) > 0 ? `${constraints.refs_count} references` : undefined,
    constraints.min_resolution,
  ]
    .filter(Boolean)
    .join(', ');
  const why = constraints.pinned_model
    ? `Locked by you: ${winner.model.display_name} on ${winner.model.provider}.`
    : `Auto picked ${winner.model.display_name} on ${winner.model.provider}: cheapest live route${constraintText ? ` for ${constraintText}` : ''}.`;
  const finalWhy = why.length <= 160 ? why : `${why.slice(0, 159)}…`;
  winner.estimate.route.why = finalWhy;
  return {
    provider: winner.model.provider,
    model_id: winner.model.model_id,
    why: finalWhy,
    estimate: winner.estimate,
    alternates: candidates.slice(1, 4).map((candidate) => ({
      provider: candidate.model.provider,
      model_id: candidate.model.model_id,
      estimate_usd: candidate.estimate.estimate_usd,
      why_not_chosen:
        candidate.estimate.estimate_usd > winner.estimate.estimate_usd
          ? 'higher estimated price'
          : 'lower routing priority',
    })),
  };
}
