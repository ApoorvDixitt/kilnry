// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { priceSummary, type ModelManifest, type PriceRule } from '@kilnry/core';

export interface ImagePricingEntry {
  billable?: string;
  cost_usd?: number;
  unit?: string;
}

const money = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1_000_000_000_000) / 1_000_000_000_000;

function ratioFor(rule: PriceRule, nextBase: number): number {
  const current = priceSummary(rule).amount;
  return current > 0 ? nextBase / current : 1;
}

function scaleTable(table: Record<string, number>, ratio: number): Record<string, number> {
  return Object.fromEntries(Object.entries(table).map(([key, value]) => [key, money(value * ratio)]));
}

export function withBasePrice(rule: PriceRule, nextBase: number): PriceRule {
  if (!Number.isFinite(nextBase) || nextBase < 0) throw new Error(`Invalid provider price: ${nextBase}`);
  const ratio = ratioFor(rule, nextBase);
  switch (rule.kind) {
    case 'free':
      return rule;
    case 'flat_per_unit':
      return {
        ...rule,
        amount: money(nextBase),
        extras: rule.extras.map((extra) => ({ ...extra, usd: money(extra.usd * ratio) })),
      };
    case 'per_megapixel':
      return {
        ...rule,
        per_mp_usd: money(rule.per_mp_usd * ratio),
        ...(rule.first_mp_usd === undefined ? {} : { first_mp_usd: money(nextBase) }),
      };
    case 'per_second_tiered':
      return {
        ...rule,
        tiers: Object.fromEntries(
          Object.entries(rule.tiers).map(([tier, values]) => [
            tier,
            {
              no_audio: money(values.no_audio * ratio),
              ...(values.audio === undefined ? {} : { audio: money(values.audio * ratio) }),
              ...(values.voice === undefined ? {} : { voice: money(values.voice * ratio) }),
            },
          ]),
        ),
        ...(rule.ref_image_usd === undefined ? {} : { ref_image_usd: money(rule.ref_image_usd * ratio) }),
        ...(rule.ref_video_per_s === undefined
          ? {}
          : { ref_video_per_s: scaleTable(rule.ref_video_per_s, ratio) }),
        ...(rule.min_charge_usd === undefined ? {} : { min_charge_usd: money(rule.min_charge_usd * ratio) }),
      };
    case 'video_tokens':
      return {
        ...rule,
        usd_per_token: scaleTable(rule.usd_per_token, ratio),
        ...(rule.with_video_input === undefined
          ? {}
          : { with_video_input: scaleTable(rule.with_video_input, ratio) }),
        fixed_usd: money(rule.fixed_usd * ratio),
      };
    case 'image_tokens':
      return {
        ...rule,
        table: Object.fromEntries(
          Object.entries(rule.table).map(([quality, sizes]) => [quality, scaleTable(sizes, ratio)]),
        ),
        rates: {
          image_out: money(rule.rates.image_out * ratio),
          image_in: money(rule.rates.image_in * ratio),
          text_in: money(rule.rates.text_in * ratio),
          ...(rule.rates.text_out === undefined ? {} : { text_out: money(rule.rates.text_out * ratio) }),
        },
      };
    case 'output_tokens_table':
      return {
        ...rule,
        usd_per_token: money(rule.usd_per_token * ratio),
        ...(rule.input_usd_per_token === undefined
          ? {}
          : { input_usd_per_token: money(rule.input_usd_per_token * ratio) }),
      };
    case 'per_million_tokens':
      return {
        ...rule,
        in: money(rule.in * ratio),
        out: money(rule.out * ratio),
        ...(rule.cached_in === undefined ? {} : { cached_in: money(rule.cached_in * ratio) }),
      };
    case 'per_1k_chars':
      return {
        ...rule,
        amount: money(nextBase),
        ...(rule.first_use_usd === undefined ? {} : { first_use_usd: money(rule.first_use_usd * ratio) }),
      };
    case 'per_minute':
      return { ...rule, amount: money(nextBase) };
    case 'per_step':
      return { ...rule, usd_per_step: money(nextBase) };
    case 'per_compute_second':
      return { ...rule, usd_per_s: money(nextBase) };
    case 'provider_estimate':
      return { ...rule, fallback: withBasePrice(rule.fallback as PriceRule, nextBase) };
  }
}

function updateImageTokenRate(
  rule: Extract<PriceRule, { kind: 'image_tokens' }>,
  key: 'image_out' | 'image_in' | 'text_in' | 'text_out',
  next: number,
): PriceRule {
  const current = rule.rates[key] ?? 0;
  const ratio = current > 0 ? next / current : 1;
  return {
    ...rule,
    ...(key === 'image_out'
      ? {
          table: Object.fromEntries(
            Object.entries(rule.table).map(([quality, sizes]) => [quality, scaleTable(sizes, ratio)]),
          ),
        }
      : {}),
    rates: { ...rule.rates, [key]: money(next) },
  };
}

export function withImagePricing(ruleInput: PriceRule, entries: ImagePricingEntry[]): PriceRule {
  let rule = ruleInput;
  for (const entry of entries) {
    const billable = entry.billable?.toLowerCase();
    const cost = entry.cost_usd;
    if (!billable || cost === undefined || !Number.isFinite(cost) || cost < 0) continue;
    if (billable === 'output_image' || billable === 'output_megapixel') {
      rule = withBasePrice(rule, cost);
    } else if (rule.kind === 'image_tokens' && billable === 'output_image_token') {
      rule = updateImageTokenRate(rule, 'image_out', cost);
    } else if (rule.kind === 'image_tokens' && billable === 'input_image_token') {
      rule = updateImageTokenRate(rule, 'image_in', cost);
    } else if (rule.kind === 'image_tokens' && billable === 'input_text_token') {
      rule = updateImageTokenRate(rule, 'text_in', cost);
    } else if (rule.kind === 'image_tokens' && billable === 'output_text_token') {
      rule = updateImageTokenRate(rule, 'text_out', cost);
    } else if (rule.kind === 'output_tokens_table' && billable === 'output_image_token') {
      const ratio = rule.usd_per_token > 0 ? cost / rule.usd_per_token : 1;
      rule = {
        ...rule,
        usd_per_token: money(cost),
        ...(rule.input_usd_per_token === undefined
          ? {}
          : { input_usd_per_token: money(rule.input_usd_per_token * ratio) }),
      };
    }
  }
  return rule;
}

function numericSku(skus: Record<string, string | number>, key: string): number | undefined {
  const value = Number(skus[key]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function withVideoPricing(rule: PriceRule, skus: Record<string, string | number>): PriceRule {
  if (rule.kind === 'video_tokens') {
    const direct = numericSku(skus, 'video_tokens') ?? numericSku(skus, 'video_token');
    const cents = numericSku(skus, 'cents_per_video_token');
    const next = direct ?? (cents === undefined ? undefined : cents / 100);
    if (next !== undefined) {
      return {
        ...rule,
        usd_per_token: Object.fromEntries(Object.keys(rule.usd_per_token).map((key) => [key, next])),
      };
    }
  }
  const direct = numericSku(skus, 'duration_seconds') ?? numericSku(skus, 'seconds_output');
  const cents = numericSku(skus, 'cents_per_second_output');
  const perSecond = direct ?? (cents === undefined ? undefined : cents / 100);
  if (perSecond !== undefined) return withBasePrice(rule, perSecond);
  const minimum = numericSku(skus, 'minimum_cents_per_generation');
  return minimum === undefined ? rule : withBasePrice(rule, minimum / 100);
}

export function withTokenPricing(
  rule: PriceRule,
  pricing: { prompt?: string | number; completion?: string | number; input_cache_read?: string | number },
): PriceRule {
  if (rule.kind !== 'per_million_tokens') return rule;
  const prompt = Number(pricing.prompt);
  const completion = Number(pricing.completion);
  const cached = Number(pricing.input_cache_read);
  return {
    ...rule,
    ...(Number.isFinite(prompt) && prompt >= 0 ? { in: money(prompt * 1_000_000) } : {}),
    ...(Number.isFinite(completion) && completion >= 0 ? { out: money(completion * 1_000_000) } : {}),
    ...(Number.isFinite(cached) && cached >= 0 ? { cached_in: money(cached * 1_000_000) } : {}),
  };
}

export function priceUpdate(
  model: ModelManifest,
  priceRule: PriceRule,
  sourceUrl: string,
): { model_id: string; price_rule: PriceRule; source_url: string } {
  return { model_id: model.model_id, price_rule: priceRule, source_url: sourceUrl };
}
