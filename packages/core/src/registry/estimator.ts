// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { CanonicalRequest, Estimate, EstimateBreakdown } from '../types.js';
import { parsePriceRule, type ModelManifest, type PriceRule, type PriceSnapshot } from './manifest.js';

export interface EstimateInput {
  model: ModelManifest;
  snapshot: PriceSnapshot;
  request: CanonicalRequest;
  references?: { images?: Array<{ width: number; height: number }>; video_s?: number; audio_s?: number };
  text_chars?: number;
  steps?: number;
  token_usage?: { input: number; output: number; cached_input?: number };
  now?: Date;
  price_max_age_days?: number;
}

interface PriceResult {
  usd: number;
  unit: string;
  unitAmount: number;
  breakdown: EstimateBreakdown[];
}

const round6 = (value: number): number => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
const round4 = (value: number): number => Math.round((value + Number.EPSILON) * 10_000) / 10_000;
const megapixels = (width: number, height: number): number => (width * height) / 1_000_000;

function resolutionKey(value: string | undefined): string {
  if (!value) return '1K';
  const lower = value.toLowerCase();
  if (lower === '768p') return '768P';
  if (lower === '2k') return value === '2K' ? '2K' : '2k';
  if (lower === '4k') return value === '4K' ? '4K' : '4k';
  return value;
}

function dimensions(request: CanonicalRequest): { width: number; height: number } {
  if (request.params.width && request.params.height) {
    return { width: request.params.width, height: request.params.height };
  }
  const resolution = resolutionKey(request.params.resolution);
  const landscape: Record<string, [number, number]> = {
    '480p': [864, 480],
    '720p': [1280, 720],
    '768P': [1360, 768],
    '1080p': [1920, 1080],
    '2k': [2560, 1440],
    '2K': [2048, 2048],
    '4k': [3840, 2160],
    '4K': [4096, 4096],
    '0.5K': [512, 512],
    '1K': [1024, 1024],
  };
  const base = landscape[resolution] ?? landscape['1K']!;
  const ratio = request.params.aspect_ratio ?? '1:1';
  if (ratio === '9:16' || ratio === '3:4' || ratio === '2:3') return { width: base[1], height: base[0] };
  if (ratio === '4:3' && resolution === '480p') return { width: 640, height: 480 };
  return { width: base[0], height: base[1] };
}

function snappedDuration(model: ModelManifest, requested: number | undefined, adjustments: string[]): number {
  const duration = requested ?? 1;
  const allowed = model.supports.durations;
  if (!allowed) return duration;
  if (Array.isArray(allowed)) {
    const sorted = [...allowed].sort((left, right) => left - right);
    const snapped = sorted.find((value) => value >= duration) ?? sorted.at(-1) ?? duration;
    if (snapped !== duration) adjustments.push(`duration snapped ${duration}→${snapped}`);
    return snapped;
  }
  const snapped = Math.min(
    allowed.max,
    Math.max(allowed.min, Math.ceil((duration - allowed.min) / allowed.step) * allowed.step + allowed.min),
  );
  if (snapped !== duration) adjustments.push(`duration snapped ${duration}→${snapped}`);
  return snapped;
}

export function seedanceTokens(
  width: number,
  height: number,
  seconds: number,
  fps = 24,
  divisor = 1024,
): number {
  return Math.round((width * height * seconds * fps) / divisor);
}

function price(ruleInput: PriceRule, input: EstimateInput, adjustments: string[]): PriceResult {
  const rule = ruleInput.kind === 'provider_estimate' ? parsePriceRule(ruleInput.fallback) : ruleInput;
  if (ruleInput.kind === 'provider_estimate')
    adjustments.push('formula fallback; authoritative estimate requested');
  const request = input.request;
  const referenceImages = input.references?.images ?? [];
  const duration = snappedDuration(input.model, request.params.duration_s, adjustments);
  const resolution = resolutionKey(request.params.resolution);

  switch (rule.kind) {
    case 'free':
      return { usd: 0, unit: rule.unit, unitAmount: 0, breakdown: [{ label: 'demo (free)', usd: 0 }] };
    case 'flat_per_unit': {
      let amount = rule.amount;
      if (rule.by) {
        const direct =
          rule.by.key === 'audio'
            ? request.params.audio
            : rule.by.key === 'resolution'
              ? request.params.resolution
              : rule.by.key === 'quality'
                ? request.params.quality
                : undefined;
        const raw = String(direct ?? request.params.extra?.[rule.by.key] ?? 'default');
        amount = rule.by.table[raw] ?? rule.by.table.default ?? amount;
      }
      const units = rule.unit === 'second' ? duration : 1;
      const breakdown: EstimateBreakdown[] = [
        { label: `${amount} × ${units} ${rule.unit}`, usd: amount * units },
      ];
      for (const extra of rule.extras) {
        if (request.params.extra?.[extra.extra]) breakdown.push({ label: extra.label, usd: extra.usd });
      }
      return {
        usd: breakdown.reduce((sum, row) => sum + row.usd, 0),
        unit: rule.unit,
        unitAmount: amount,
        breakdown,
      };
    }
    case 'per_megapixel': {
      const output = megapixels(dimensions(request).width, dimensions(request).height);
      const inputs = referenceImages.map((image) => megapixels(image.width, image.height));
      let units: number;
      if (rule.round === 'ceil_each')
        units =
          Math.ceil(output) +
          (rule.count_inputs ? inputs.reduce((sum, value) => sum + Math.ceil(value), 0) : 0);
      else if (rule.round === 'ceil_total')
        units = Math.ceil(output + (rule.count_inputs ? inputs.reduce((sum, value) => sum + value, 0) : 0));
      else units = output + (rule.count_inputs ? inputs.reduce((sum, value) => sum + value, 0) : 0);
      if (rule.first_mp_usd !== undefined) {
        const extra = Math.max(0, units - 1);
        return {
          usd: rule.first_mp_usd + extra * rule.per_mp_usd,
          unit: 'megapixel',
          unitAmount: rule.per_mp_usd,
          breakdown: [
            { label: 'first megapixel', usd: rule.first_mp_usd },
            { label: `${extra} extra MP × ${rule.per_mp_usd}`, usd: extra * rule.per_mp_usd },
          ],
        };
      }
      return {
        usd: units * rule.per_mp_usd,
        unit: 'megapixel',
        unitAmount: rule.per_mp_usd,
        breakdown: [{ label: `${units} MP × ${rule.per_mp_usd}`, usd: units * rule.per_mp_usd }],
      };
    }
    case 'per_second_tiered': {
      const firstTier = Object.entries(rule.tiers)[0];
      const selected = rule.tiers[resolution] ?? firstTier?.[1];
      if (!selected) throw new Error(`No price tier exists for ${input.model.model_id}.`);
      if (!rule.tiers[resolution] && firstTier)
        adjustments.push(`resolution ${resolution} not priced; used ${firstTier[0]} tier`);
      const voice = request.injections.some((injection) => injection.strategy === 'voice_id');
      let rate =
        voice && selected.voice !== undefined
          ? selected.voice
          : request.params.audio && selected.audio !== undefined
            ? selected.audio
            : selected.no_audio;
      if (
        request.injections.some((injection) => injection.strategy === 'elements') &&
        rule.elements_multiplier
      ) {
        rate *= rule.elements_multiplier;
        adjustments.push('elements roughly double Kling per-second price on I2V');
      }
      const billedSeconds = rule.round_up_to_s
        ? Math.ceil(duration / rule.round_up_to_s) * rule.round_up_to_s
        : duration;
      if (billedSeconds !== duration)
        adjustments.push(`billed in ${rule.round_up_to_s} s steps: ${duration}→${billedSeconds} s`);
      const breakdown: EstimateBreakdown[] = [
        { label: `${rate} × ${billedSeconds} s`, usd: rate * billedSeconds },
      ];
      const paidReferences = Math.max(0, referenceImages.length - (rule.ref_image_free ?? 0));
      if (paidReferences && rule.ref_image_usd)
        breakdown.push({
          label: `${paidReferences} reference images`,
          usd: paidReferences * rule.ref_image_usd,
        });
      if (input.references?.video_s && rule.ref_video_per_s) {
        const videoRate = rule.ref_video_per_s[resolution] ?? rule.ref_video_per_s.default ?? 0;
        breakdown.push({ label: 'reference video', usd: input.references.video_s * videoRate });
      }
      if (request.params.extra?.fps === 60 && rule.fps60_multiplier) {
        breakdown.push({
          label: '60 fps multiplier',
          usd: rate * billedSeconds * (rule.fps60_multiplier - 1),
        });
      }
      let usd = breakdown.reduce((sum, row) => sum + row.usd, 0);
      if (rule.min_charge_usd !== undefined && usd < rule.min_charge_usd) {
        breakdown.push({ label: 'provider minimum', usd: rule.min_charge_usd - usd });
        usd = rule.min_charge_usd;
      }
      return { usd, unit: 'second', unitAmount: rate, breakdown };
    }
    case 'video_tokens': {
      const size = dimensions(request);
      const tokens = seedanceTokens(size.width, size.height, duration, rule.fps, rule.divisor);
      const rates =
        input.references?.video_s && rule.with_video_input ? rule.with_video_input : rule.usd_per_token;
      const rate = rates[resolution] ?? rates.default;
      if (rate === undefined) throw new Error(`No token price exists for ${resolution}.`);
      const variable = tokens * rate;
      return {
        usd: variable + rule.fixed_usd,
        unit: 'video_token',
        unitAmount: rate,
        breakdown: [
          { label: `${size.width}×${size.height}×${duration} s = ${tokens} tokens`, usd: variable },
          ...(rule.fixed_usd ? [{ label: 'fixed overhead', usd: rule.fixed_usd }] : []),
        ],
      };
    }
    case 'image_tokens': {
      const quality = request.params.quality ?? 'standard';
      const size = dimensions(request);
      const sizeKey = `${size.width}x${size.height}`;
      const qualityKey = quality === 'standard' ? 'medium' : quality === 'premium' ? 'high' : 'low';
      const table = rule.table[qualityKey] ?? rule.table.medium;
      const base = table?.[sizeKey] ?? table?.['1024x1024'];
      if (base === undefined) throw new Error(`No image token price exists for ${qualityKey} ${sizeKey}.`);
      const referenceUsd = referenceImages.length * rule.input_tokens_per_ref * rule.rates.image_in;
      const textUsd = ((input.text_chars ?? request.prompt.length) / 4) * rule.rates.text_in;
      return {
        usd: base + referenceUsd + textUsd,
        unit: 'image',
        unitAmount: base,
        breakdown: [
          { label: `${qualityKey} ${sizeKey}`, usd: base },
          { label: `${referenceImages.length} input images`, usd: referenceUsd },
          { label: 'prompt tokens', usd: textUsd },
        ],
      };
    }
    case 'output_tokens_table': {
      const key =
        resolution === '480p' ? '0.5K' : ['720p', '768P', '1080p'].includes(resolution) ? '1K' : resolution;
      const tokens = rule.tokens_by_size[key] ?? rule.tokens_by_size['1K'];
      if (tokens === undefined) throw new Error(`No output token count exists for ${key}.`);
      const outputUsd = tokens * rule.usd_per_token;
      const inputUsd =
        referenceImages.length * (rule.input_tokens_per_image ?? 0) * (rule.input_usd_per_token ?? 0);
      return {
        usd: outputUsd + inputUsd,
        unit: 'image',
        unitAmount: outputUsd,
        breakdown: [
          { label: `${tokens} output tokens`, usd: outputUsd },
          ...(inputUsd ? [{ label: `${referenceImages.length} input images`, usd: inputUsd }] : []),
        ],
      };
    }
    case 'per_million_tokens': {
      const usage = input.token_usage ?? {
        input: (input.text_chars ?? request.prompt.length) / 4,
        output: Number(request.params.extra?.expected_out_tokens ?? 800),
      };
      const inputUsd = usage.input * rule.in * 1e-6;
      const cachedUsd = (usage.cached_input ?? 0) * (rule.cached_in ?? rule.in) * 1e-6;
      const outputUsd = usage.output * rule.out * 1e-6;
      return {
        usd: inputUsd + cachedUsd + outputUsd,
        unit: 'M tokens',
        unitAmount: rule.out,
        breakdown: [
          { label: 'input tokens', usd: inputUsd },
          { label: 'cached tokens', usd: cachedUsd },
          { label: 'output tokens', usd: outputUsd },
        ],
      };
    }
    case 'per_1k_chars': {
      const characters = input.text_chars ?? request.prompt.length;
      const base = (characters / 1000) * rule.amount;
      const firstUse = request.params.extra?.first_use && rule.first_use_usd ? rule.first_use_usd : 0;
      return {
        usd: base + firstUse,
        unit: '1k chars',
        unitAmount: rule.amount,
        breakdown: [
          { label: `${characters} characters`, usd: base },
          ...(firstUse ? [{ label: 'voice clone first use', usd: firstUse }] : []),
        ],
      };
    }
    case 'per_minute': {
      const seconds =
        rule.unit_of === 'input' ? (input.references?.audio_s ?? input.references?.video_s ?? 0) : duration;
      const languages =
        rule.per_target_language && Array.isArray(request.params.extra?.target_languages)
          ? request.params.extra.target_languages.length
          : 1;
      const minutes = seconds / 60;
      return {
        usd: minutes * rule.amount * languages,
        unit: 'minute',
        unitAmount: rule.amount,
        breakdown: [{ label: `${minutes} minutes × ${languages}`, usd: minutes * rule.amount * languages }],
      };
    }
    case 'per_step': {
      const steps = Math.max(input.steps ?? 1000, rule.min_steps ?? 0);
      const multiplier = rule.ref_multiplier?.[String(referenceImages.length)] ?? 1;
      return {
        usd: steps * rule.usd_per_step * multiplier,
        unit: 'step',
        unitAmount: rule.usd_per_step,
        breakdown: [{ label: `${steps} steps × ${multiplier}`, usd: steps * rule.usd_per_step * multiplier }],
      };
    }
    case 'per_compute_second':
      return {
        usd: rule.usd_per_s * rule.typical_s,
        unit: 'compute second',
        unitAmount: rule.usd_per_s,
        breakdown: [{ label: `${rule.typical_s} compute seconds`, usd: rule.usd_per_s * rule.typical_s }],
      };
    case 'provider_estimate':
      throw new Error('Nested provider estimate rules are not supported.');
  }
}

function ageDays(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000;
}

export function estimate(input: EstimateInput): Estimate {
  const adjustments: string[] = [];
  if (ageDays(input.snapshot.fetched_at, input.now ?? new Date()) > (input.price_max_age_days ?? 30))
    adjustments.push('stale_price');
  const one = price(input.snapshot.rule, input, adjustments);
  const count = input.request.count ?? 1;
  const estimateUsd = round4(one.usd * count);
  const breakdown = one.breakdown.map((row) => ({ ...row, usd: round6(row.usd * count) }));
  if (breakdown.length > 0) {
    const sum = breakdown.reduce((total, row) => total + row.usd, 0);
    breakdown[breakdown.length - 1]!.usd = round6(breakdown.at(-1)!.usd + estimateUsd - sum);
  }
  return {
    estimate_usd: estimateUsd,
    source: 'formula',
    unit_price: {
      unit: one.unit,
      amount_usd: one.unitAmount,
      fetched_at: input.snapshot.fetched_at,
      source_url: input.snapshot.source_url,
    },
    breakdown,
    route: { provider: input.model.provider, model: input.model.model_id, why: '' },
    adjustments,
    eta_s: input.model.eta_s * count,
  };
}

export function withAuthoritativeEstimate(value: Estimate, authoritativeUsd: number): Estimate {
  return { ...value, authoritative_usd: round4(authoritativeUsd), source: 'provider' };
}
