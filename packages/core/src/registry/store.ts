// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { asc, desc, eq } from 'drizzle-orm';
import type { DatabaseState } from '@kilnry/db';
import { models, priceSnapshots, providers } from '@kilnry/db';
import { ulid } from '../ids.js';
import { ProviderIdSchema, type ProviderId } from '../types.js';
import {
  ModelManifestSchema,
  PriceSnapshotSchema,
  parsePriceRule,
  type ModelManifest,
  type PriceRule,
  type PriceSnapshot,
} from './manifest.js';
import { registrySeed, seedSnapshot } from './seed/index.js';

export function priceSummary(ruleInput: PriceRule): { unit: string; amount: number } {
  const rule = ruleInput.kind === 'provider_estimate' ? parsePriceRule(ruleInput.fallback) : ruleInput;
  switch (rule.kind) {
    case 'free':
      return { unit: rule.unit, amount: 0 };
    case 'flat_per_unit':
      return { unit: rule.unit, amount: rule.amount };
    case 'per_megapixel':
      return { unit: 'megapixel', amount: rule.first_mp_usd ?? rule.per_mp_usd };
    case 'per_second_tiered': {
      const tier = Object.values(rule.tiers)[0];
      return { unit: 'second', amount: tier?.no_audio ?? 0 };
    }
    case 'video_tokens':
      return {
        unit: 'video_token',
        amount: rule.usd_per_token.default ?? Object.values(rule.usd_per_token)[0] ?? 0,
      };
    case 'image_tokens':
      return { unit: 'image', amount: rule.table.medium?.['1024x1024'] ?? 0 };
    case 'output_tokens_table':
      return { unit: 'output_token', amount: rule.usd_per_token };
    case 'per_million_tokens':
      return { unit: 'M tokens', amount: rule.out };
    case 'per_1k_chars':
      return { unit: '1k chars', amount: rule.amount };
    case 'per_minute':
      return { unit: 'minute', amount: rule.amount };
    case 'per_step':
      return { unit: 'step', amount: rule.usd_per_step };
    case 'per_compute_second':
      return { unit: 'compute second', amount: rule.usd_per_s };
    case 'provider_estimate':
      throw new Error('Nested provider estimate rules are not supported.');
  }
}

export async function seedRegistry(state: DatabaseState): Promise<void> {
  await state.ready;
  for (const id of ProviderIdSchema.options) {
    await state.db.insert(providers).values({ id }).onConflictDoNothing({ target: providers.id });
  }
  for (const manifest of registrySeed) {
    const existing = await state.db
      .select({ id: models.id })
      .from(models)
      .where(eq(models.providerId, manifest.provider))
      .orderBy(asc(models.modelId));
    const duplicate = await state.db
      .select({ id: models.id })
      .from(models)
      .where(eq(models.modelId, manifest.model_id));
    const exact = duplicate.find((row) => existing.some((candidate) => candidate.id === row.id));
    let modelId = exact?.id;
    if (!modelId) {
      modelId = ulid();
      await state.db.insert(models).values({
        id: modelId,
        providerId: manifest.provider,
        modelId: manifest.model_id,
        displayName: manifest.display_name,
        capabilities: manifest.capabilities,
        paramsSchema: manifest.params_schema,
        mediaRoles: manifest.media_roles,
        supports: manifest.supports,
        priceRule: manifest.price_rule as Record<string, unknown>,
        retentionDays: manifest.retention_days,
        moderation: manifest.moderation,
        qualityTier: manifest.quality_tier,
        tags: [
          ...manifest.tags,
          ...(manifest.training_on_inputs ? ['training_on_inputs'] : []),
          ...(manifest.enabled ? [] : ['disabled']),
        ],
        deprecatedAt: manifest.deprecated_at ? new Date(manifest.deprecated_at) : null,
        sourceUrl: manifest.source_url,
        updatedAt: new Date(manifest.seeded_at),
      });
    }
    const prior = await state.db
      .select({ id: priceSnapshots.id })
      .from(priceSnapshots)
      .where(eq(priceSnapshots.modelUlid, modelId))
      .limit(1);
    if (prior.length === 0) {
      const summary = priceSummary(manifest.price_rule);
      await state.db.insert(priceSnapshots).values({
        id: ulid(),
        modelUlid: modelId,
        unit: summary.unit,
        amountUsd: summary.amount.toFixed(6),
        tiers: manifest.price_rule,
        source: 'seed',
        sourceUrl: manifest.source_url,
        fetchedAt: new Date(manifest.seeded_at),
      });
    }
  }
}

export interface StoredRegistry {
  models: ModelManifest[];
  snapshots: Map<string, PriceSnapshot>;
}

export async function loadRegistry(state: DatabaseState): Promise<StoredRegistry> {
  await state.ready;
  const modelRows = await state.db.select().from(models).orderBy(asc(models.providerId), asc(models.modelId));
  const snapshotRows = await state.db.select().from(priceSnapshots).orderBy(desc(priceSnapshots.fetchedAt));
  const latest = new Map<string, (typeof snapshotRows)[number]>();
  for (const row of snapshotRows) if (!latest.has(row.modelUlid)) latest.set(row.modelUlid, row);
  const manifests: ModelManifest[] = [];
  const snapshots = new Map<string, PriceSnapshot>();
  for (const row of modelRows) {
    const provider = ProviderIdSchema.parse(row.providerId);
    const snapshot = latest.get(row.id);
    const manifest = ModelManifestSchema.parse({
      provider,
      model_id: row.modelId,
      display_name: row.displayName,
      capabilities: row.capabilities,
      supports: row.supports,
      media_roles: row.mediaRoles,
      params_schema: row.paramsSchema,
      price_rule: parsePriceRule(row.priceRule),
      retention_days: row.retentionDays,
      moderation: row.moderation ?? { http: null, shape: 'unknown', billed: 'maybe' },
      quality_tier: row.qualityTier ?? 'standard',
      eta_s: 30,
      tags: row.tags ?? [],
      training_on_inputs: (row.tags ?? []).includes('training_on_inputs'),
      enabled: !(row.tags ?? []).includes('disabled'),
      deprecated_at: row.deprecatedAt?.toISOString() ?? null,
      source_url: row.sourceUrl ?? 'https://kilnry.app',
      seeded_at: (snapshot?.fetchedAt ?? row.updatedAt).toISOString(),
    });
    manifests.push(manifest);
    snapshots.set(
      `${provider}:${row.modelId}`,
      snapshot
        ? PriceSnapshotSchema.parse({
            rule: snapshot.tiers ?? manifest.price_rule,
            fetched_at: snapshot.fetchedAt.toISOString(),
            source: snapshot.source ?? 'seed',
            source_url: snapshot.sourceUrl ?? manifest.source_url,
          })
        : seedSnapshot(manifest),
    );
  }
  return { models: manifests, snapshots };
}

export async function providerRouteStates(
  state: DatabaseState,
): Promise<
  Partial<
    Record<
      ProviderId,
      { connected: boolean; status: 'ok' | 'degraded' | 'error' | 'not_connected'; degraded_until?: Date }
    >
  >
> {
  const rows = await state.db.select().from(providers);
  const output: Partial<
    Record<
      ProviderId,
      { connected: boolean; status: 'ok' | 'degraded' | 'error' | 'not_connected'; degraded_until?: Date }
    >
  > = {};
  for (const row of rows) {
    const id = ProviderIdSchema.safeParse(row.id);
    const status = zStatus(row.status);
    if (!id.success) continue;
    output[id.data] = {
      connected: row.enabled && status !== 'not_connected',
      status,
      ...(row.degradedUntil ? { degraded_until: row.degradedUntil } : {}),
    };
  }
  return output;
}

function zStatus(value: string): 'ok' | 'degraded' | 'error' | 'not_connected' {
  return ['ok', 'degraded', 'error', 'not_connected'].includes(value)
    ? (value as 'ok' | 'degraded' | 'error' | 'not_connected')
    : 'error';
}
