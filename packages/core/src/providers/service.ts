// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { randomBytes } from 'node:crypto';
import { mkdir, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { DatabaseState } from '@kilnry/db';
import { models, priceSnapshots, providerKeys, providers, spendLedger } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';
import { priceSummary } from '../registry/store.js';
import type { ProviderKeyStore } from '../security/key-store.js';
import type { ProviderId } from '../types.js';
import { ProviderIdSchema } from '../types.js';
import type { AdapterRegistry } from './adapter.js';

export interface ProviderSummary {
  id: ProviderId;
  display_name: string;
  connected: boolean;
  status: 'ok' | 'degraded' | 'error' | 'not_connected';
  key_prefix?: string;
  model_count: number;
  spend_month_usd: number;
  last_error?: string;
  last_tested_at?: string;
  degraded_until?: string;
  monthly_cap_usd?: number;
  max_concurrency: number;
  price_fetched_at?: string;
  price_stale: boolean;
  training_on_inputs: boolean;
}

function status(value: string): ProviderSummary['status'] {
  return ['ok', 'degraded', 'error', 'not_connected'].includes(value)
    ? (value as ProviderSummary['status'])
    : 'error';
}

function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function listProviders(
  state: DatabaseState,
  adapters: AdapterRegistry,
): Promise<ProviderSummary[]> {
  await state.ready;
  const rows = await state.db.select().from(providers);
  const keys = await state.db.select().from(providerKeys);
  const counts = await state.db
    .select({ providerId: models.providerId, value: count() })
    .from(models)
    .groupBy(models.providerId);
  const modelRows = await state.db.select({ id: models.id, providerId: models.providerId }).from(models);
  const snapshots = await state.db
    .select({ modelId: priceSnapshots.modelUlid, fetchedAt: priceSnapshots.fetchedAt })
    .from(priceSnapshots);
  const spend = await state.db
    .select({
      providerId: spendLedger.providerId,
      value: sql<string>`coalesce(sum(${spendLedger.actualUsd}), 0)`,
    })
    .from(spendLedger)
    .where(gte(spendLedger.occurredAt, monthStart()))
    .groupBy(spendLedger.providerId);
  const byKey = new Map(keys.map((row) => [row.providerId, row]));
  const byCount = new Map(counts.map((row) => [row.providerId, row.value]));
  const bySpend = new Map(spend.map((row) => [row.providerId, Number(row.value)]));
  const providerForModel = new Map(modelRows.map((row) => [row.id, row.providerId]));
  const latestPrice = new Map<string, Date>();
  for (const snapshot of snapshots) {
    const providerId = providerForModel.get(snapshot.modelId);
    if (!providerId) continue;
    const prior = latestPrice.get(providerId);
    if (!prior || snapshot.fetchedAt > prior) latestPrice.set(providerId, snapshot.fetchedAt);
  }
  const summaries = rows.flatMap((row) => {
    const parsed = ProviderIdSchema.safeParse(row.id);
    if (!parsed.success) return [];
    const id = parsed.data;
    const adapter = adapters[id];
    const key = byKey.get(id);
    const fetchedAt = latestPrice.get(id);
    const configuredConcurrency =
      typeof row.extra.max_concurrency === 'number' ? row.extra.max_concurrency : undefined;
    return [
      {
        id,
        display_name: adapter?.display_name ?? id,
        connected: Boolean(row.enabled && key),
        status: status(row.status),
        ...(key?.keyPrefix ? { key_prefix: key.keyPrefix } : {}),
        model_count: byCount.get(id) ?? 0,
        spend_month_usd: bySpend.get(id) ?? 0,
        ...(row.lastError ? { last_error: row.lastError } : {}),
        ...(row.lastTestedAt ? { last_tested_at: row.lastTestedAt.toISOString() } : {}),
        ...(row.degradedUntil ? { degraded_until: row.degradedUntil.toISOString() } : {}),
        ...(row.monthlyCapUsd ? { monthly_cap_usd: Number(row.monthlyCapUsd) } : {}),
        max_concurrency: Math.max(
          1,
          Math.min(
            configuredConcurrency ?? adapter?.concurrency.default ?? 1,
            adapter?.concurrency.max_known ?? 32,
          ),
        ),
        ...(fetchedAt ? { price_fetched_at: fetchedAt.toISOString() } : {}),
        price_stale: !fetchedAt || Date.now() - fetchedAt.getTime() > 30 * 86_400_000,
        training_on_inputs: adapter?.training_on_inputs ?? false,
        // When the provider's training notice was acknowledged (D-44), so Settings
        // can collapse the notice to one acknowledged line.
        ...(typeof row.extra.accepted_tos_at === 'string'
          ? { accepted_tos_at: row.extra.accepted_tos_at }
          : {}),
      },
    ];
  });
  const order = ProviderIdSchema.options;
  return summaries.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
}

export async function testProvider(input: {
  state: DatabaseState;
  keyStore: ProviderKeyStore;
  adapters: AdapterRegistry;
  provider: ProviderId;
  key?: string;
  fetch?: typeof fetch;
}): Promise<{
  ok: boolean;
  latency_ms?: number;
  model_count?: number;
  error?: ReturnType<KilnryError['toJSON']>;
}> {
  const adapter = input.adapters[input.provider];
  if (!adapter) throw new KilnryError('NO_PROVIDER', `${input.provider} is not available in this milestone.`);
  const key = input.key ?? (await input.keyStore.get(input.provider));
  if (!key) throw new KilnryError('NO_PROVIDER', `No ${input.provider} key is configured.`);
  const tested = await adapter.testKey(key, { fetch: input.fetch ?? fetch });
  if (tested.ok) {
    await input.state.db
      .update(providers)
      .set({
        status: 'ok',
        enabled: true,
        lastError: null,
        degradedUntil: null,
        lastTestedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(providers.id, input.provider));
    return {
      ok: true,
      latency_ms: tested.latency_ms,
      ...(tested.model_count === undefined ? {} : { model_count: tested.model_count }),
    };
  }
  await input.state.db
    .update(providers)
    .set({
      status: 'error',
      lastError: tested.error.message,
      lastTestedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(providers.id, input.provider));
  return { ok: false, error: tested.error.toJSON() };
}

export async function connectProvider(input: {
  state: DatabaseState;
  keyStore: ProviderKeyStore;
  adapters: AdapterRegistry;
  provider: ProviderId;
  key: string;
  label?: string;
  save_anyway?: boolean;
  accept_tos?: boolean;
  fetch?: typeof fetch;
}): Promise<{
  provider: ProviderSummary;
  recovery_kit?: string;
  test: { ok: boolean; latency_ms?: number; model_count?: number; error?: ReturnType<KilnryError['toJSON']> };
}> {
  // Higgsfield is opt-in (D-44, F-PRV-06): its key cannot be saved until the
  // Terms-of-Use training notice has been acknowledged in this request or on a
  // prior connect. The acknowledgement time is kept in providers.extra.
  if (input.provider === 'higgsfield') {
    const rows = await input.state.db
      .select({ extra: providers.extra })
      .from(providers)
      .where(eq(providers.id, 'higgsfield'));
    const alreadyAccepted = typeof rows[0]?.extra.accepted_tos_at === 'string';
    if (!alreadyAccepted && !input.accept_tos) {
      throw new KilnryError(
        'CONFIRMATION_REQUIRED',
        'Read and accept the Higgsfield notice before connecting the key.',
        { provider: 'higgsfield', retryable: false },
      );
    }
    if (input.accept_tos && !alreadyAccepted) {
      const extra = { ...(rows[0]?.extra ?? {}), accepted_tos_at: new Date().toISOString() };
      await input.state.db
        .update(providers)
        .set({ extra, updatedAt: new Date() })
        .where(eq(providers.id, 'higgsfield'));
    }
  }
  const tested = await testProvider({
    state: input.state,
    keyStore: input.keyStore,
    adapters: input.adapters,
    provider: input.provider,
    key: input.key,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
  if (!tested.ok && !input.save_anyway) {
    throw new KilnryError(
      tested.error?.code ?? 'INVALID_INPUT',
      tested.error?.message ?? `${input.provider} rejected the key.`,
      {
        ...(tested.error?.retryable === undefined ? {} : { retryable: tested.error.retryable }),
        provider: input.provider,
      },
    );
  }
  const saved = await input.keyStore.save(input.provider, input.key, input.label);
  const summary = (await listProviders(input.state, input.adapters)).find(
    (provider) => provider.id === input.provider,
  );
  if (!summary) throw new Error(`Provider ${input.provider} was not seeded.`);
  return {
    provider: summary,
    ...(saved.recovery_kit ? { recovery_kit: saved.recovery_kit } : {}),
    test: tested,
  };
}

export async function disconnectProvider(input: {
  keyStore: ProviderKeyStore;
  provider: ProviderId;
}): Promise<void> {
  await input.keyStore.remove(input.provider);
}

export async function refreshProviderPrices(input: {
  state: DatabaseState;
  keyStore: ProviderKeyStore;
  adapters: AdapterRegistry;
  provider: ProviderId;
  dataDir?: string;
  fetch?: typeof fetch;
}): Promise<{ models: number; fetched_at: string }> {
  const adapter = input.adapters[input.provider];
  if (!adapter) throw new KilnryError('NO_PROVIDER', `${input.provider} is not available in this milestone.`);
  const key = await input.keyStore.get(input.provider);
  if (!key) throw new KilnryError('NO_PROVIDER', `No ${input.provider} key is configured.`);
  const updates = adapter.refreshPrices
    ? await adapter.refreshPrices(key, { fetch: input.fetch ?? fetch })
    : (await adapter.listModels(key, { fetch: input.fetch ?? fetch })).map((manifest) => ({
        model_id: manifest.model_id,
        price_rule: manifest.price_rule,
        source_url: manifest.source_url,
      }));
  if (updates.length === 0) {
    throw new KilnryError(
      'PROVIDER_ERROR',
      `${input.provider} returned no usable price rows. Existing snapshots were left unchanged.`,
      { provider: input.provider, retryable: true },
    );
  }
  const fetchedAt = new Date();
  for (const update of updates) {
    const rows = await input.state.db
      .select({ id: models.id })
      .from(models)
      .where(and(eq(models.providerId, input.provider), eq(models.modelId, update.model_id)))
      .limit(1);
    const model = rows[0];
    if (!model) continue;
    const summary = priceSummary(update.price_rule);
    const source =
      input.provider === 'fal'
        ? 'fal_pricing_api'
        : input.provider === 'openrouter'
          ? update.source_url.includes('/videos/')
            ? 'openrouter_videos'
            : update.source_url.endsWith('/models')
              ? 'openrouter_models'
              : 'openrouter_endpoints'
          : 'seed';
    await input.state.db
      .update(models)
      .set({ priceRule: update.price_rule as Record<string, unknown>, updatedAt: fetchedAt })
      .where(eq(models.id, model.id));
    await input.state.db.insert(priceSnapshots).values({
      id: ulid(),
      modelUlid: model.id,
      unit: summary.unit,
      amountUsd: summary.amount.toFixed(6),
      tiers: update.price_rule,
      source,
      sourceUrl: update.source_url,
      fetchedAt,
    });
  }
  if (input.dataDir) {
    const directory = join(input.dataDir, 'cache', 'pricing');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = join(directory, `${input.provider}.json`);
    const temporary = `${destination}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(
        `${JSON.stringify(
          {
            provider: input.provider,
            fetched_at: fetchedAt.toISOString(),
            models: updates.map((update) => ({
              model_id: update.model_id,
              price_rule: update.price_rule,
              source_url: update.source_url,
            })),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
  }
  return { models: updates.length, fetched_at: fetchedAt.toISOString() };
}

export async function setProviderCap(
  state: DatabaseState,
  provider: ProviderId,
  capUsd: number | null,
): Promise<void> {
  await state.db
    .update(providers)
    .set({ monthlyCapUsd: capUsd === null ? null : capUsd.toFixed(6), updatedAt: new Date() })
    .where(and(eq(providers.id, provider)));
}

export async function updateProviderControls(
  state: DatabaseState,
  provider: ProviderId,
  input: { monthly_cap_usd?: number | null; max_concurrency?: number; resume?: boolean },
): Promise<void> {
  const rows = await state.db
    .select({ extra: providers.extra })
    .from(providers)
    .where(eq(providers.id, provider));
  const current = rows[0];
  if (!current) throw new KilnryError('NOT_FOUND', `Provider ${provider} is not seeded.`);
  const extra = { ...current.extra };
  if (input.max_concurrency !== undefined) extra.max_concurrency = input.max_concurrency;
  await state.db
    .update(providers)
    .set({
      extra,
      ...(input.monthly_cap_usd === undefined
        ? {}
        : {
            monthlyCapUsd: input.monthly_cap_usd === null ? null : input.monthly_cap_usd.toFixed(6),
          }),
      ...(input.resume ? { status: 'ok', degradedUntil: null, lastError: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(providers.id, provider));
}
