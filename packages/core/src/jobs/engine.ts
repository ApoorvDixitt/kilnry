// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { PgBoss, fromPglite, type Job } from 'pg-boss';
import type { DatabaseState } from '@kilnry/db';
import { jobs, providers, spendLedger } from '@kilnry/db';
import { assertCostConfirmation, reserveBudget } from '../budget/enforcer.js';
import { KilnryError } from '../errors.js';
import { eventHub, type EventHub } from '../events/hub.js';
import { ulid } from '../ids.js';
import type { ProviderKeyStore } from '../security/key-store.js';
import { redact, redactString } from '../security/redact.js';
import { loadRegistry, providerRouteStates, seedRegistry } from '../registry/store.js';
import { refreshProviderPrices } from '../providers/service.js';
import { route, type RouteConstraints } from '../registry/router.js';
import { withAuthoritativeEstimate } from '../registry/estimator.js';
import type {
  AdapterContext,
  AdapterRegistry,
  PollStatus,
  ProviderAdapter,
  ProviderResult,
  SubmitHandle,
} from '../providers/adapter.js';
import {
  CanonicalRequestSchema,
  ProviderIdSchema,
  type CanonicalRequest,
  type Estimate,
  type ProviderId,
} from '../types.js';
import { finalizeOutput, type FinalizedAsset } from './finalize.js';

type JobRow = typeof jobs.$inferSelect;

interface QueuePayload {
  job_id: string;
  resume?: boolean;
}

interface MaintenancePayload {
  op: 'price_refresh';
}

interface StoredResolved {
  handle?: {
    provider: ProviderId;
    model_id: string;
    provider_request_id: string;
    status_url?: string;
    response_url?: string;
    cancel_url?: string;
    submitted_at: string;
    payload_redacted: unknown;
  };
}

const budgetLockId = 1_264_843_079;

export interface JobEngineOptions {
  state: DatabaseState;
  keyStore: ProviderKeyStore;
  adapters: AdapterRegistry;
  dataDir: string;
  libraryRoot: string;
  libraryId: string;
  fetch?: typeof fetch;
  events?: EventHub;
  pollScheduleMs?: number[];
  pollTimeoutMs?: number;
  submitRetryScheduleMs?: number[];
  now?: () => Date;
  log?: (level: 'debug' | 'info' | 'warn' | 'error', event: string, meta?: Record<string, unknown>) => void;
}

export interface CreateJobResult {
  job_id: string;
  status: string;
  estimate: Estimate;
  route: { provider: ProviderId; model: string };
  idempotent_replay?: boolean;
}

function queueName(provider: ProviderId): string {
  return `gen/${provider}`;
}

export function canonicalQueueName(provider: ProviderId): string {
  return `gen:${provider}`;
}

function numeric(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid numeric database value: ${value}`);
  return result;
}

function storedHandle(row: JobRow): SubmitHandle | undefined {
  if (!row.providerRequestId || typeof row.resolved !== 'object' || row.resolved === null) return undefined;
  const handle = (row.resolved as StoredResolved).handle;
  if (!handle) return undefined;
  return { ...handle };
}

function billed(error: KilnryError): 'no' | 'maybe' | 'yes' {
  const details = error.options.details;
  if (typeof details === 'object' && details !== null && 'billed' in details) {
    const value = details.billed;
    if (value === 'yes' || value === 'maybe' || value === 'no') return value;
  }
  return 'no';
}

function ambiguous(error: KilnryError): boolean {
  const details = error.options.details;
  return Boolean(
    typeof details === 'object' &&
    details !== null &&
    'ambiguous_submit' in details &&
    details.ambiguous_submit,
  );
}

function retryAfterMs(error: KilnryError): number | undefined {
  const details = error.options.details;
  if (typeof details !== 'object' || details === null || !('retry_after_s' in details)) return undefined;
  const seconds = Number(details.retry_after_s);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 120) * 1000 : undefined;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'),
    );
  }
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function estimateFromRow(row: JobRow, request: CanonicalRequest): Estimate {
  const unit = row.unitPrice ?? {};
  return {
    estimate_usd: numeric(row.estimateUsd),
    ...(row.authoritativeUsd === null ? {} : { authoritative_usd: numeric(row.authoritativeUsd) }),
    source: row.authoritativeUsd === null ? 'formula' : 'provider',
    unit_price: {
      unit: typeof unit.unit === 'string' ? unit.unit : 'generation',
      amount_usd: typeof unit.amount_usd === 'number' ? unit.amount_usd : numeric(row.estimateUsd),
      fetched_at: typeof unit.fetched_at === 'string' ? unit.fetched_at : row.createdAt.toISOString(),
      source_url: typeof unit.source_url === 'string' ? unit.source_url : 'https://kilnry.app',
    },
    breakdown: [{ label: 'confirmed estimate', usd: numeric(row.estimateUsd) }],
    route: {
      provider: ProviderIdSchema.parse(row.providerId),
      model: row.modelId ?? String(request.params.extra?.model ?? ''),
      why: typeof request.params.extra?.route_why === 'string' ? request.params.extra.route_why : '',
    },
    adjustments: row.adjustments ?? [],
    eta_s: 0,
  };
}

export class JobEngine {
  readonly #options: Required<
    Pick<
      JobEngineOptions,
      'fetch' | 'events' | 'pollScheduleMs' | 'pollTimeoutMs' | 'submitRetryScheduleMs' | 'now' | 'log'
    >
  > &
    Omit<
      JobEngineOptions,
      'fetch' | 'events' | 'pollScheduleMs' | 'pollTimeoutMs' | 'submitRetryScheduleMs' | 'now' | 'log'
    >;
  readonly #controllers = new Map<string, AbortController>();
  #boss: PgBoss | undefined;
  #started = false;
  #stopping = false;

  constructor(options: JobEngineOptions) {
    this.#options = {
      ...options,
      fetch: options.fetch ?? fetch,
      events: options.events ?? eventHub,
      pollScheduleMs: options.pollScheduleMs ?? [2000, 3000, 5000, 8000, 10_000],
      pollTimeoutMs: options.pollTimeoutMs ?? 7_200_000,
      submitRetryScheduleMs: options.submitRetryScheduleMs ?? [2000, 8000, 32_000],
      now: options.now ?? (() => new Date()),
      log: options.log ?? (() => undefined),
    };
  }

  get boss(): PgBoss {
    if (!this.#boss) throw new Error('Job engine has not started.');
    return this.#boss;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#stopping = false;
    await this.#options.state.ready;
    await this.#options.keyStore.initialize();
    await seedRegistry(this.#options.state);
    const boss = new PgBoss({
      backend: 'pglite',
      db: fromPglite(this.#options.state.client),
      schema: 'pgboss',
      application_name: 'kilnry',
    });
    boss.on('error', (error) => this.#options.log('error', 'pgboss_error', { error: redact(error) }));
    boss.on('warning', (warning) =>
      this.#options.log('warn', 'pgboss_warning', { warning: redact(warning) }),
    );
    await boss.start();
    await boss.createQueue('dead', { deleteAfterSeconds: 30 * 86_400, retryLimit: 0 });
    await boss.createQueue('maintenance', {
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 3600,
      deleteAfterSeconds: 7 * 86_400,
      deadLetter: 'dead',
    });
    for (const provider of Object.keys(this.#options.adapters) as ProviderId[]) {
      await boss.createQueue(queueName(provider), {
        retryLimit: 0,
        retryDelay: 0,
        expireInSeconds: 7200,
        deleteAfterSeconds: 7 * 86_400,
        deadLetter: 'dead',
      });
    }
    this.#boss = boss;
    await this.#recover();
    const providerControls = new Map(
      (await this.#options.state.db.select({ id: providers.id, extra: providers.extra }).from(providers)).map(
        (provider) => [provider.id, provider.extra],
      ),
    );
    for (const [providerKey, adapter] of Object.entries(this.#options.adapters)) {
      if (!adapter) continue;
      const provider = ProviderIdSchema.parse(providerKey);
      const configured = providerControls.get(provider)?.max_concurrency;
      const requestedConcurrency = typeof configured === 'number' ? configured : adapter.concurrency.default;
      const concurrency = Math.max(
        1,
        Math.min(requestedConcurrency, adapter.concurrency.default, adapter.concurrency.max_known ?? 32),
      );
      await boss.work<QueuePayload>(
        queueName(provider),
        {
          batchSize: 1,
          localConcurrency: concurrency,
          pollingIntervalSeconds: 0.5,
        },
        async (messages) => {
          await Promise.all(messages.map((message) => this.#process(message)));
        },
      );
    }
    await boss.work<MaintenancePayload>(
      'maintenance',
      { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 },
      async (messages) => {
        for (const message of messages) {
          if (message.data.op !== 'price_refresh') {
            throw new Error(`Unknown maintenance operation: ${String(message.data.op)}`);
          }
          for (const provider of Object.keys(this.#options.adapters) as ProviderId[]) {
            const key = await this.#options.keyStore.get(provider);
            if (!key) continue;
            try {
              await refreshProviderPrices({
                state: this.#options.state,
                keyStore: this.#options.keyStore,
                adapters: this.#options.adapters,
                provider,
                dataDir: this.#options.dataDir,
                fetch: this.#options.fetch,
              });
            } catch (error) {
              this.#options.log('warn', 'price_refresh_failed', {
                provider,
                error: redact(error),
              });
            }
          }
        }
      },
    );
    await boss.schedule('maintenance', '0 4 * * *', { op: 'price_refresh' }, { key: 'price-refresh' });
    this.#started = true;
  }

  async stop(): Promise<void> {
    if (!this.#boss) return;
    this.#stopping = true;
    for (const controller of this.#controllers.values())
      controller.abort(new DOMException('Runtime stopping', 'AbortError'));
    this.#controllers.clear();
    await this.#boss.stop({ graceful: true, timeout: 30_000, close: false });
    this.#boss = undefined;
    this.#started = false;
  }

  async estimate(
    request: CanonicalRequest,
    constraints: RouteConstraints = {},
  ): Promise<{ request: CanonicalRequest; estimate: Estimate }> {
    const registry = await loadRegistry(this.#options.state);
    const providersState = await providerRouteStates(this.#options.state);
    const needsAudio = constraints.needs_audio ?? request.params.audio;
    const durationSeconds = constraints.duration_s ?? request.params.duration_s;
    const aspectRatio = constraints.aspect_ratio ?? request.params.aspect_ratio;
    const minimumResolution =
      constraints.min_resolution ??
      (request.params.resolution
        ? (request.params.resolution as RouteConstraints['min_resolution'])
        : undefined);
    const inferred: RouteConstraints = {
      ...constraints,
      ...(needsAudio === undefined ? {} : { needs_audio: needsAudio }),
      refs_count:
        constraints.refs_count ??
        request.medias.filter((media) => ['reference', 'product'].includes(media.role)).length,
      ...(durationSeconds === undefined ? {} : { duration_s: durationSeconds }),
      ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
      ...(minimumResolution === undefined ? {} : { min_resolution: minimumResolution }),
    };
    const selected = route(request, inferred, {
      models: registry.models,
      snapshots: registry.snapshots,
      providers: providersState,
    });
    const routedRequest = CanonicalRequestSchema.parse({
      ...request,
      params: {
        ...request.params,
        extra: {
          ...(request.params.extra ?? {}),
          model: selected.model_id,
          route_why: selected.why,
        },
      },
    });
    let value = selected.estimate;
    const adapter = this.#options.adapters[selected.provider];
    if (adapter?.supports_authoritative_estimate && adapter.authoritativeEstimate) {
      const key = await this.#options.keyStore.get(selected.provider);
      if (key) {
        try {
          const authoritative = await adapter.authoritativeEstimate(
            routedRequest,
            value,
            this.#adapterContext(adapter, key, new AbortController().signal),
          );
          value = withAuthoritativeEstimate(value, authoritative);
        } catch (error) {
          value = { ...value, adjustments: [...value.adjustments, 'provider_estimate_unavailable'] };
          this.#options.log('warn', 'provider_estimate_unavailable', {
            provider: selected.provider,
            model: selected.model_id,
            error: redact(error),
          });
        }
      }
    }
    return { request: routedRequest, estimate: value };
  }

  async createJob(input: {
    request: CanonicalRequest;
    constraints?: RouteConstraints;
    confirmed_cost_usd?: number;
    confirmed_by: string;
    client_request_id?: string;
    override_budget?: boolean;
    allow_stale_price?: boolean;
  }): Promise<CreateJobResult> {
    if (!this.#started) throw new Error('Job engine must be started before creating jobs.');
    if (input.client_request_id) {
      const prior = await this.#options.state.db
        .select()
        .from(jobs)
        .where(eq(jobs.clientRequestId, input.client_request_id))
        .orderBy(desc(jobs.createdAt))
        .limit(1);
      if (prior[0] && this.#options.now().getTime() - prior[0].createdAt.getTime() < 86_400_000) {
        const provider = ProviderIdSchema.parse(prior[0].providerId);
        return {
          job_id: prior[0].id,
          status: prior[0].status,
          estimate: estimateFromRow(prior[0], CanonicalRequestSchema.parse(prior[0].request)),
          route: { provider, model: prior[0].modelId ?? '' },
          idempotent_replay: true,
        };
      }
    }
    const prepared = await this.estimate(input.request, input.constraints);
    if (prepared.estimate.adjustments.includes('stale_price') && !input.allow_stale_price) {
      throw new KilnryError(
        'INVALID_INPUT',
        'This price snapshot is older than 30 days. Refresh provider prices before generating, or explicitly allow the stale estimate.',
        { details: { stale_price: true, estimate: prepared.estimate } },
      );
    }
    assertCostConfirmation(prepared.estimate, input.confirmed_cost_usd);
    const id = ulid();
    const row: typeof jobs.$inferInsert = {
      id,
      kind: prepared.request.kind,
      status: 'queued',
      source: prepared.request.source,
      providerId: prepared.estimate.route.provider,
      modelId: prepared.estimate.route.model,
      request: redact(prepared.request) as Record<string, unknown>,
      medias: prepared.request.medias,
      characters: prepared.request.injections,
      adjustments: prepared.estimate.adjustments,
      estimateUsd: prepared.estimate.estimate_usd.toFixed(6),
      ...(prepared.estimate.authoritative_usd === undefined
        ? {}
        : { authoritativeUsd: prepared.estimate.authoritative_usd.toFixed(6) }),
      unitPrice: { ...prepared.estimate.unit_price },
      ...(input.client_request_id === undefined ? {} : { clientRequestId: input.client_request_id }),
      targetFolder: prepared.request.target_folder,
      confirmedCostUsd: input.confirmed_cost_usd?.toFixed(6) ?? '0.000000',
      confirmedBy: input.confirmed_by,
      createdAt: this.#options.now(),
      stepLabel: 'queued',
    };
    const replay = await this.#options.state.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(${budgetLockId})`);
      if (input.client_request_id) {
        const existing = await transaction
          .select()
          .from(jobs)
          .where(eq(jobs.clientRequestId, input.client_request_id))
          .orderBy(desc(jobs.createdAt))
          .limit(1);
        if (existing[0]) {
          if (this.#options.now().getTime() - existing[0].createdAt.getTime() < 86_400_000) {
            return existing[0];
          }
          await transaction.update(jobs).set({ clientRequestId: null }).where(eq(jobs.id, existing[0].id));
        }
      }
      await reserveBudget(transaction, {
        estimate_usd: prepared.estimate.authoritative_usd ?? prepared.estimate.estimate_usd,
        provider: prepared.estimate.route.provider,
        folder: prepared.request.target_folder,
        ...(input.override_budget === undefined ? {} : { override_budget: input.override_budget }),
        now: this.#options.now(),
      });
      await transaction.insert(jobs).values(row);
      return undefined;
    });
    if (replay) {
      const provider = ProviderIdSchema.parse(replay.providerId);
      return {
        job_id: replay.id,
        status: replay.status,
        estimate: estimateFromRow(replay, CanonicalRequestSchema.parse(replay.request)),
        route: { provider, model: replay.modelId ?? '' },
        idempotent_replay: true,
      };
    }
    await this.#enqueue(id, prepared.estimate.route.provider);
    this.#options.events.emit({
      type: 'job.updated',
      job_id: id,
      status: 'queued',
      step_label: 'queued',
      estimate_usd: prepared.estimate.estimate_usd,
      ts: this.#options.now().toISOString(),
    });
    return {
      job_id: id,
      status: 'queued',
      estimate: prepared.estimate,
      route: { provider: prepared.estimate.route.provider, model: prepared.estimate.route.model },
    };
  }

  async cancelJob(jobId: string): Promise<{ status: string; provider_acknowledged: boolean }> {
    const row = await this.#job(jobId);
    if (['completed', 'failed', 'cancelled', 'moderated'].includes(row.status)) {
      return { status: row.status, provider_acknowledged: false };
    }
    await this.#options.state.db
      .update(jobs)
      .set({
        status: 'cancelled',
        errorCode: 'CANCELLED',
        errorMessage: 'Cancelled.',
        retryable: false,
        finishedAt: this.#options.now(),
      })
      .where(eq(jobs.id, jobId));
    this.#controllers.get(jobId)?.abort(new DOMException('Cancelled', 'AbortError'));
    let acknowledged = false;
    const handle = storedHandle(row);
    if (handle && row.providerId) {
      const provider = ProviderIdSchema.parse(row.providerId);
      const adapter = this.#options.adapters[provider];
      const key = adapter ? await this.#options.keyStore.get(provider) : undefined;
      if (adapter && key) {
        const result = await adapter.cancel(
          handle,
          this.#adapterContext(adapter, key, new AbortController().signal),
        );
        acknowledged = result.ok;
      }
    }
    await this.#recordLedger(row, 0, 'cancelled');
    await rm(join(this.#options.dataDir, 'tmp', jobId), { recursive: true, force: true });
    return { status: 'cancelled', provider_acknowledged: acknowledged };
  }

  async retryJob(jobId: string, confirmedCostUsd: number): Promise<void> {
    const row = await this.#job(jobId);
    if (row.status !== 'failed') throw new KilnryError('INVALID_INPUT', 'Only failed jobs can be retried.');
    const request = CanonicalRequestSchema.parse(row.request);
    const estimate = estimateFromRow(row, request);
    assertCostConfirmation(estimate, confirmedCostUsd);
    await this.#options.state.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(${budgetLockId})`);
      await reserveBudget(transaction, {
        estimate_usd: estimate.authoritative_usd ?? estimate.estimate_usd,
        provider: ProviderIdSchema.parse(row.providerId),
        folder: request.target_folder,
        now: this.#options.now(),
      });
      await transaction
        .update(jobs)
        .set({
          status: 'queued',
          errorCode: null,
          errorMessage: null,
          retryable: null,
          finishedAt: null,
          stepLabel: 'queued',
          confirmedCostUsd: confirmedCostUsd.toFixed(6),
        })
        .where(eq(jobs.id, jobId));
    });
    await this.#enqueue(jobId, ProviderIdSchema.parse(row.providerId));
  }

  async waitForJob(jobId: string, timeoutMs = 30_000): Promise<JobRow> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const row = await this.#job(jobId);
      if (['completed', 'failed', 'cancelled', 'moderated'].includes(row.status)) return row;
      await delay(25);
    }
    return this.#job(jobId);
  }

  async #job(id: string): Promise<JobRow> {
    const rows = await this.#options.state.db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    if (!rows[0]) throw new KilnryError('NOT_FOUND', `Job ${id} was not found.`);
    return rows[0];
  }

  async #enqueue(jobId: string, provider: ProviderId, resume = false): Promise<void> {
    const result = await this.boss.send(
      queueName(provider),
      { job_id: jobId, ...(resume ? { resume: true } : {}) },
      { singletonKey: resume ? `${jobId}:resume` : jobId, retryLimit: 0 },
    );
    if (!result) this.#options.log('debug', 'queue_singleton_reused', { job_id: jobId, provider });
  }

  #adapterContext(
    adapter: ProviderAdapter,
    key: string,
    signal: AbortSignal,
    tempDir?: string,
  ): AdapterContext {
    return {
      key,
      fetch: this.#options.fetch,
      signal,
      ...(tempDir ? { temp_dir: tempDir } : {}),
      log: (level, event, meta) => this.#options.log(level, event, { provider: adapter.id, ...(meta ?? {}) }),
    };
  }

  async #process(message: Job<QueuePayload>): Promise<void> {
    const jobId = message.data.job_id;
    try {
      await this.#run(jobId, message.data.resume ?? false);
    } catch (error) {
      const row = await this.#job(jobId);
      if (row.status === 'cancelled') return;
      if (this.#stopping) {
        this.#options.log('info', 'job_paused_for_shutdown', { job_id: jobId, status: row.status });
        return;
      }
      const normalized =
        error instanceof KilnryError
          ? error
          : new KilnryError('PROVIDER_ERROR', 'The job handler stopped unexpectedly.', {
              retryable: true,
              cause: error,
            });
      await this.#finishError(row, normalized, false);
      this.#options.log('error', 'handler_crash', { job_id: jobId, error: redact(error) });
    } finally {
      this.#controllers.delete(jobId);
    }
  }

  async #run(jobId: string, resume: boolean): Promise<void> {
    let row = await this.#job(jobId);
    if (['completed', 'failed', 'cancelled', 'moderated'].includes(row.status)) return;
    const provider = ProviderIdSchema.parse(row.providerId);
    const adapter = this.#options.adapters[provider];
    if (!adapter) throw new KilnryError('NO_PROVIDER', `No adapter is registered for ${provider}.`);
    const key = await this.#options.keyStore.get(provider);
    if (!key) throw new KilnryError('NO_PROVIDER', `No ${provider} key is configured.`);
    const request = CanonicalRequestSchema.parse(row.request);
    const estimate = estimateFromRow(row, request);
    const controller = new AbortController();
    this.#controllers.set(jobId, controller);
    const tempDir = join(this.#options.dataDir, 'tmp', jobId);
    await mkdir(tempDir, { recursive: true, mode: 0o700 });
    const context = this.#adapterContext(adapter, key, controller.signal, tempDir);
    if (!resume && row.status === 'queued') {
      await this.#options.state.db
        .update(jobs)
        .set({ status: 'running', startedAt: this.#options.now(), stepLabel: 'preparing' })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued')));
      row = await this.#job(jobId);
    }
    let handle = storedHandle(row);
    let result: ProviderResult | undefined;
    if (!handle) {
      await this.#options.state.db
        .update(jobs)
        .set({ stepLabel: 'submitting', attempts: row.attempts + 1 })
        .where(eq(jobs.id, jobId));
      handle = await this.#submitWithSafeRetries(adapter, request, context);
      const persisted = {
        provider: handle.provider,
        model_id: handle.model_id,
        provider_request_id: handle.provider_request_id,
        ...(handle.status_url ? { status_url: handle.status_url } : {}),
        ...(handle.response_url ? { response_url: handle.response_url } : {}),
        ...(handle.cancel_url ? { cancel_url: handle.cancel_url } : {}),
        submitted_at: handle.submitted_at,
        payload_redacted: handle.payload_redacted,
      };
      await this.#options.state.db
        .update(jobs)
        .set({
          providerRequestId: handle.provider_request_id,
          providerStatusUrl: handle.status_url,
          resolved: { handle: persisted },
          stepLabel: handle.inline_result ? 'downloading' : 'queued at provider',
        })
        .where(eq(jobs.id, jobId));
      result = handle.inline_result;
    }
    if (!result) result = await this.#pollUntilTerminal(await this.#job(jobId), adapter, handle, context);
    await this.#complete(await this.#job(jobId), request, estimate, adapter, result, context);
  }

  async #submitWithSafeRetries(
    adapter: ProviderAdapter,
    request: CanonicalRequest,
    context: AdapterContext,
  ): Promise<SubmitHandle> {
    let attempt = 0;
    while (true) {
      try {
        return await adapter.submit(request, context);
      } catch (error) {
        const normalized = adapter.normalizeError(error);
        const definitiveNoSpend = billed(normalized) === 'no' && !ambiguous(normalized);
        const limit = normalized.code === 'RATE_LIMITED' ? 5 : normalized.code === 'PROVIDER_ERROR' ? 3 : 0;
        if (!definitiveNoSpend || attempt >= limit) throw normalized;
        const schedule = this.#options.submitRetryScheduleMs;
        const providerDelay = normalized.code === 'RATE_LIMITED' ? retryAfterMs(normalized) : undefined;
        await delay(providerDelay ?? schedule[Math.min(attempt, schedule.length - 1)] ?? 0, context.signal);
        attempt += 1;
      }
    }
  }

  async #pollUntilTerminal(
    row: JobRow,
    adapter: ProviderAdapter,
    handle: SubmitHandle,
    context: AdapterContext,
  ): Promise<ProviderResult> {
    const started = Date.now();
    let poll = 0;
    while (Date.now() - started <= this.#options.pollTimeoutMs) {
      const current = await this.#job(row.id);
      if (current.status === 'cancelled') throw new KilnryError('CANCELLED', 'Cancelled.');
      if (poll > 0) {
        const schedule = this.#options.pollScheduleMs;
        await delay(schedule[Math.min(poll - 1, schedule.length - 1)] ?? 10_000, context.signal);
      }
      let status: PollStatus;
      try {
        status = await adapter.poll(handle, context);
      } catch (error) {
        const normalized = adapter.normalizeError(error);
        if (
          normalized.code === 'PROVIDER_ERROR' ||
          normalized.code === 'RATE_LIMITED' ||
          normalized.code === 'TIMEOUT'
        ) {
          this.#options.log('warn', 'provider_poll_retry', {
            job_id: row.id,
            provider: adapter.id,
            error: normalized.toJSON(),
          });
          poll += 1;
          continue;
        }
        throw normalized;
      }
      if (status.state === 'completed') return status.result;
      if (status.state === 'failed') throw status.error;
      if (status.state === 'moderated') {
        await this.#finishError(await this.#job(row.id), status.error, true, status.billed);
        throw new KilnryError('CANCELLED', 'Moderated job was finalized.');
      }
      if (status.state === 'cancelled') throw new KilnryError('CANCELLED', 'Cancelled.');
      await this.#options.state.db
        .update(jobs)
        .set({
          stepLabel:
            status.state === 'queued'
              ? `queued at provider${status.position === undefined ? '' : ` (#${status.position})`}`
              : (status.step_label ?? 'generating'),
          ...(status.state === 'running' && status.progress !== undefined
            ? { progress: status.progress.toFixed(3) }
            : {}),
        })
        .where(eq(jobs.id, row.id));
      this.#options.events.emit({
        type: 'job.updated',
        job_id: row.id,
        status: 'running',
        step_label: status.state === 'queued' ? 'queued at provider' : (status.step_label ?? 'generating'),
        ...(status.state === 'running' && status.progress !== undefined ? { progress: status.progress } : {}),
        provider_request_id: handle.provider_request_id,
        estimate_usd: numeric(row.estimateUsd),
        ts: this.#options.now().toISOString(),
      });
      poll += 1;
    }
    throw new KilnryError(
      'TIMEOUT',
      `No answer from ${adapter.id}. Kilnry has not resubmitted, so the request was not sent twice.`,
      {
        provider: adapter.id,
        retryable: true,
        details: { billed: 'maybe', poll_timeout: true },
      },
    );
  }

  async #complete(
    row: JobRow,
    request: CanonicalRequest,
    estimate: Estimate,
    adapter: ProviderAdapter,
    result: ProviderResult,
    context: AdapterContext,
  ): Promise<void> {
    const actualUsd = result.billing?.actual_usd ?? estimate.authoritative_usd ?? estimate.estimate_usd;
    await this.#options.state.db.update(jobs).set({ stepLabel: 'downloading' }).where(eq(jobs.id, row.id));
    let downloaded: Awaited<ReturnType<ProviderAdapter['download']>>;
    try {
      downloaded = await adapter.download(result, context);
    } catch (error) {
      throw new KilnryError(
        'PROVIDER_ERROR',
        `The result was generated but Kilnry could not download it: ${error instanceof Error ? redactString(error.message) : 'unknown download error'}. Retry downloads the existing result without a new submission.`,
        {
          provider: adapter.id,
          retryable: true,
          details: { billed: 'yes', actual_usd: actualUsd, retry_download_only: true },
          cause: error,
        },
      );
    }
    const finalized: FinalizedAsset[] = [];
    for (const output of downloaded) {
      finalized.push(
        await finalizeOutput({
          state: this.#options.state,
          dataDir: this.#options.dataDir,
          libraryRoot: this.#options.libraryRoot,
          libraryId: this.#options.libraryId,
          job: {
            id: row.id,
            source: row.source,
            providerId: adapter.id,
            modelId: row.modelId ?? String(request.params.extra?.model ?? ''),
            providerRequestId: row.providerRequestId ?? 'inline',
            createdAt: row.createdAt,
          },
          request,
          estimate,
          actualUsd,
          output,
          onStage: (stage) => this.#options.log('debug', `job_finalize_${stage}`, { job_id: row.id }),
        }),
      );
    }
    await this.#recordLedger(
      row,
      actualUsd,
      result.billing?.source ?? (actualUsd === 0 ? 'free' : 'formula:post'),
    );
    await this.#options.state.db.transaction(async (transaction) => {
      await transaction
        .update(jobs)
        .set({
          status: 'completed',
          stepLabel: 'completed',
          progress: '1.000',
          actualUsd: actualUsd.toFixed(6),
          outputAssetIds: finalized.map((asset) => asset.asset_id),
          finishedAt: this.#options.now(),
          errorCode: null,
          errorMessage: null,
          retryable: null,
        })
        .where(eq(jobs.id, row.id));
      await transaction
        .update(providers)
        .set({ status: 'ok', degradedUntil: null, lastError: null, updatedAt: this.#options.now() })
        .where(eq(providers.id, adapter.id));
    });
    this.#options.events.emit({
      type: 'job.completed',
      job_id: row.id,
      asset_ids: finalized.map((asset) => asset.asset_id),
      paths: finalized.map((asset) => asset.path),
      actual_usd: actualUsd,
      duration_ms: this.#options.now().getTime() - (row.startedAt ?? row.createdAt).getTime(),
      ts: this.#options.now().toISOString(),
    });
    if (context.temp_dir) await rm(context.temp_dir, { recursive: true, force: true });
  }

  async #recordLedger(row: JobRow, actualUsd: number, note: string): Promise<void> {
    const existing = await this.#options.state.db
      .select({ id: spendLedger.id })
      .from(spendLedger)
      .where(eq(spendLedger.jobId, row.id))
      .limit(1);
    if (existing[0]) {
      await this.#options.state.db
        .update(spendLedger)
        .set({
          actualUsd: actualUsd.toFixed(6),
          currencyNote: note,
          occurredAt: this.#options.now(),
        })
        .where(eq(spendLedger.id, existing[0].id));
      return;
    }
    await this.#options.state.db.insert(spendLedger).values({
      id: ulid(),
      jobId: row.id,
      providerId: row.providerId,
      modelId: row.modelId,
      folder: row.targetFolder,
      kind: row.kind,
      estimateUsd: row.estimateUsd,
      actualUsd: actualUsd.toFixed(6),
      currencyNote: note,
      occurredAt: this.#options.now(),
    });
  }

  async #finishError(
    row: JobRow,
    error: KilnryError,
    moderated: boolean,
    billedState: 'no' | 'maybe' | 'yes' = billed(error),
  ): Promise<void> {
    if (['failed', 'moderated', 'cancelled', 'completed'].includes(row.status)) return;
    const details = error.options.details;
    const reportedActual =
      typeof details === 'object' &&
      details !== null &&
      'actual_usd' in details &&
      typeof details.actual_usd === 'number'
        ? details.actual_usd
        : undefined;
    const confirmedEstimate =
      row.authoritativeUsd === null ? numeric(row.estimateUsd) : numeric(row.authoritativeUsd);
    const actualUsd = billedState === 'yes' ? (reportedActual ?? confirmedEstimate) : 0;
    await this.#recordLedger(
      row,
      actualUsd,
      moderated
        ? actualUsd
          ? 'moderation:charged'
          : 'moderation:refunded'
        : actualUsd
          ? 'failure:charged'
          : 'failed',
    );
    const json = error.toJSON();
    const status =
      moderated || error.code === 'MODERATION_REJECTED'
        ? 'moderated'
        : error.code === 'CANCELLED'
          ? 'cancelled'
          : 'failed';
    await this.#options.state.db
      .update(jobs)
      .set({
        status,
        errorCode: error.code,
        errorMessage: redactString(error.message),
        retryable: json.retryable,
        actualUsd: actualUsd.toFixed(6),
        finishedAt: this.#options.now(),
        stepLabel: status,
      })
      .where(eq(jobs.id, row.id));
    const keepPartial =
      typeof details === 'object' &&
      details !== null &&
      'retry_download_only' in details &&
      details.retry_download_only === true;
    if (!keepPartial) {
      await rm(join(this.#options.dataDir, 'tmp', row.id), { recursive: true, force: true });
    }
    if (status === 'moderated') {
      this.#options.events.emit({
        type: 'job.moderated',
        job_id: row.id,
        reason: redactString(error.message),
        billed: actualUsd > 0,
        ts: this.#options.now().toISOString(),
      });
    } else {
      this.#options.events.emit({
        type: 'job.failed',
        job_id: row.id,
        error: {
          code: error.code,
          message: redactString(error.message),
          retryable: json.retryable,
          ...(row.providerId ? { provider: row.providerId } : {}),
        },
        ts: this.#options.now().toISOString(),
      });
    }
    if (row.providerId && (error.code === 'PROVIDER_ERROR' || error.code === 'INSUFFICIENT_FUNDS')) {
      const recent = await this.#options.state.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.providerId, row.providerId),
            inArray(jobs.errorCode, ['PROVIDER_ERROR', 'INSUFFICIENT_FUNDS']),
            gte(jobs.finishedAt, new Date(this.#options.now().getTime() - 5 * 60_000)),
          ),
        )
        .limit(3);
      if (recent.length >= 3 || error.code === 'INSUFFICIENT_FUNDS') {
        const until = new Date(this.#options.now().getTime() + 15 * 60_000);
        await this.#options.state.db
          .update(providers)
          .set({
            status: 'degraded',
            degradedUntil: until,
            lastError: redactString(error.message),
            updatedAt: this.#options.now(),
          })
          .where(eq(providers.id, row.providerId));
        this.#options.events.emit({
          type: 'provider.status',
          provider: ProviderIdSchema.parse(row.providerId),
          status: 'degraded',
          until: until.toISOString(),
          ts: this.#options.now().toISOString(),
        });
      }
    }
  }

  async #recover(): Promise<void> {
    const rows = await this.#options.state.db
      .select()
      .from(jobs)
      .where(inArray(jobs.status, ['queued', 'running']));
    for (const row of rows) {
      const provider = ProviderIdSchema.safeParse(row.providerId);
      if (!provider.success) {
        await this.#finishError(
          row,
          new KilnryError('NO_PROVIDER', 'The queued job has no provider route.'),
          false,
        );
        continue;
      }
      if (row.status === 'running' && !row.providerRequestId) {
        await this.#finishError(
          row,
          new KilnryError(
            'TIMEOUT',
            `Kilnry stopped while submitting to ${provider.data}. The outcome is unknown; check the provider dashboard before retrying.`,
            {
              provider: provider.data,
              retryable: true,
              details: { ambiguous_submit: true, billed: 'maybe' },
            },
          ),
          false,
        );
        continue;
      }
      await this.#enqueue(row.id, provider.data, row.status === 'running');
    }
  }
}
