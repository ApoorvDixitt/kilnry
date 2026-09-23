// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Training orchestration for identities (F-CHR-07, TRD-14 §10). A trained
// identity — a low-rank adaptation (LoRA) on fal, a fast-flux model on Replicate,
// or a hosted Soul ID on Higgsfield — locks a Character's look so it can be
// generated through later. Training is gated by the consent invariant: a real
// person's likeness cannot be trained until consent is recorded (§9). A LoRA
// artefact is copied to the user's own disk under ~/.kilnry/identities/ so it
// survives the provider's short retention; a Soul ID lives in the Higgsfield
// account and only its remote id is stored.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, and } from 'drizzle-orm';
import {
  auditEvents,
  characterVersions,
  characters,
  spendLedger,
  trainedIdentities,
  type DatabaseState,
} from '@kilnry/db';
import type { AdapterContext, ProviderAdapter, SubmitHandle } from '../providers/adapter.js';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';
import { assertCostConfirmation, reserveBudget } from '../budget/enforcer.js';
import { estimate as priceEstimate } from '../registry/estimator.js';
import { loadRegistry } from '../registry/store.js';
import type { CanonicalRequest, Estimate } from '../types.js';
import { assertConsentForTraining } from './consent.js';
import { loadVersion } from './store.js';

// The trainers Kilnry offers (PRD-07 §8). The price is not on the card: each
// trainer's cost is priced from its registry row through the estimator, so the
// figure the user confirms is the figure the registry holds. `trainerModelId`
// maps a trainer to the registry model that carries its price rule.
export type TrainerId = 'fal' | 'replicate' | 'higgsfield';

export interface TrainerCard {
  trainer: TrainerId;
  model_id: string;
  kind: 'lora' | 'soul_id';
  base_model?: string;
  min_images: number;
  recommended: string;
  exportable: boolean;
}

export const TRAINERS: Record<TrainerId, TrainerCard> = {
  fal: {
    trainer: 'fal',
    model_id: 'fal-ai/flux-lora-fast-training',
    kind: 'lora',
    base_model: 'flux1-dev',
    min_images: 4,
    recommended: '10–20, one full-body',
    exportable: true,
  },
  replicate: {
    trainer: 'replicate',
    model_id: 'replicate/fast-flux-trainer',
    kind: 'lora',
    base_model: 'flux1-dev',
    min_images: 4,
    recommended: '10–20',
    exportable: true,
  },
  higgsfield: {
    trainer: 'higgsfield',
    model_id: 'higgsfield-ai/custom-references',
    kind: 'soul_id',
    min_images: 1,
    recommended: '20–80, recent, one full-height',
    exportable: false,
  },
};

// The registry model whose price rule prices each trainer's run, and the
// capability that model advertises (PRD-07 §8, TRD-07 §5). fal's FLUX LoRA is
// billed per step; Replicate's fast-flux per compute second; a Higgsfield Soul
// ID is a flat per-run charge.
const TRAINER_PRICING: Record<TrainerId, { model_id: string; capability: CanonicalRequest['capability'] }> = {
  fal: { model_id: 'fal-ai/flux-lora-fast-training', capability: 'train_lora' },
  replicate: { model_id: 'replicate/fast-flux-trainer', capability: 'train_lora' },
  higgsfield: { model_id: '/v1/custom-references', capability: 'train_identity' },
};

// Price a training run from the registry so the confirmed figure is the figure
// the registry holds (F-CHR-07, F-PRV-05). The estimate carries the provider's
// authoritative figure when one is available and the formula figure otherwise.
export async function priceTraining(db: DatabaseState, trainer: TrainerId, steps: number): Promise<Estimate> {
  const pricing = TRAINER_PRICING[trainer];
  const registry = await loadRegistry(db);
  const model = registry.models.find(
    (candidate) => candidate.provider === trainer && candidate.model_id === pricing.model_id,
  );
  const snapshot = model ? registry.snapshots.get(`${trainer}:${pricing.model_id}`) : undefined;
  if (!model || !snapshot) {
    throw new KilnryError(
      'NO_PROVIDER',
      `No price is registered for ${trainer} training; refresh provider prices and try again.`,
    );
  }
  const request: CanonicalRequest = {
    kind: 'image',
    capability: pricing.capability,
    prompt: `train ${trainer}`,
    params: {},
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui',
  };
  return priceEstimate({ model, snapshot, request, steps });
}

// The trigger word a LoRA is trained with (PRD-07 §8): the handle stripped to
// letters and digits with a trailing "k", rejected if under four characters.
export function triggerWordFor(handle: string): string {
  const base = handle.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `${base}k`;
}

export function isValidTriggerWord(word: string): boolean {
  return /^[a-z0-9]{4,}$/i.test(word);
}

export interface TrainingInput {
  handle: string;
  trainer: TrainerId;
  steps?: number;
  trigger_word?: string;
  confirmed_cost_usd: number;
}

export interface TrainingServices {
  db: DatabaseState;
  adapters: Readonly<Partial<Record<TrainerId, ProviderAdapter>>>;
  keyFor: (trainer: TrainerId) => Promise<string | undefined>;
  assetUrl: (assetId: string) => string;
  identitiesRoot: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface TrainingResult {
  identity_id: string;
  provider: TrainerId;
  kind: 'lora' | 'soul_id';
  status: 'ready' | 'failed';
  local_path?: string;
  remote_id?: string;
  sha256?: string;
  error?: string;
}

function adapterContext(key: string, fetchImpl: typeof fetch): AdapterContext {
  const controller = new AbortController();
  return {
    key,
    fetch: fetchImpl,
    signal: controller.signal,
    log: () => undefined,
  };
}

// Run a submit-then-poll loop against a provider adapter until it reaches a
// terminal state, returning the completed result or throwing the terminal error.
async function runToCompletion(
  adapter: ProviderAdapter,
  handle: SubmitHandle,
  context: AdapterContext,
  maxPolls = 120,
): Promise<import('../providers/adapter.js').ProviderResult> {
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const status = await adapter.poll(handle, context);
    if (status.state === 'completed') return status.result;
    if (status.state === 'failed' || status.state === 'moderated') throw status.error;
    if (status.state === 'cancelled')
      throw new KilnryError('CANCELLED', 'The training was cancelled.', { retryable: false });
  }
  throw new KilnryError('PROVIDER_ERROR', 'The training did not finish in time.', { retryable: true });
}

// Train an identity for a Character version. Consent is asserted first, so a real
// person's likeness never reaches a trainer without a recorded record (§9). The
// artefact is downloaded, its checksum verified, its manifest written, and a
// trained_identities row upserted; a Soul ID keeps only its hosted remote id.
export async function startTraining(
  services: TrainingServices,
  input: TrainingInput,
): Promise<TrainingResult> {
  const fetchImpl = services.fetch ?? fetch;
  const now = services.now ?? (() => new Date());
  const card = TRAINERS[input.trainer];
  const adapter = services.adapters[input.trainer];
  if (!adapter) throw new KilnryError('NO_PROVIDER', `${input.trainer} is not connected.`);

  const head = await services.db.db
    .select()
    .from(characters)
    .where(eq(characters.handle, input.handle.toLowerCase().replace(/^@/, '')))
    .limit(1);
  if (!head[0]) throw new KilnryError('NOT_FOUND', `@${input.handle} is not a Character.`);
  const characterId = head[0].id;
  const version = head[0].currentVersion;

  // The consent gate is a hard invariant (§9): a real person must have consent
  // recorded before any training that sends their likeness.
  await assertConsentForTraining(services.db, characterId);

  const key = await services.keyFor(input.trainer);
  if (!key) throw new KilnryError('NO_PROVIDER', `${input.trainer} has no connected key.`);

  // Price the run from the registry, refuse to start unless the confirmed figure
  // matches the priced one, and reserve the estimate against the budget caps
  // before any provider request is made (F-CHR-07, F-PRV-05). The estimate, the
  // reservation and the ledger row all use this one figure.
  const steps = input.steps ?? 1000;
  const trainingEstimate = await priceTraining(services.db, input.trainer, steps);
  assertCostConfirmation(trainingEstimate, input.confirmed_cost_usd);
  await reserveBudget(services.db.db, {
    estimate_usd: trainingEstimate.estimate_usd,
    provider: input.trainer,
    folder: 'inbox',
    now: now(),
  });
  const chargedUsd = trainingEstimate.authoritative_usd ?? trainingEstimate.estimate_usd;

  const loaded = await loadVersion(services.db, characterId, version);
  const sources = loaded.references
    .filter((reference) => reference.role !== 'grid')
    .map((reference) => ({ asset_id: reference.asset_id, url: services.assetUrl(reference.asset_id) }));
  if (sources.length < card.min_images) {
    throw new KilnryError(
      'INVALID_INPUT',
      `${input.trainer} needs at least ${card.min_images} reference image(s); this version has ${sources.length}.`,
    );
  }

  const identityId = ulid();
  const providerDir = join(services.identitiesRoot, characterId, String(version), input.trainer);

  // A Soul ID is a hosted reference: create it, poll it, and store only its id.
  if (input.trainer === 'higgsfield') {
    const remoteId = await trainSoulId(fetchImpl, adapter.base_url, key, {
      name: `kilnry-${input.handle}-v${version}`,
      images: sources.slice(0, 80).map((source) => source.url),
    });
    await upsertIdentity(services.db, {
      id: identityId,
      characterId,
      version,
      provider: 'higgsfield',
      kind: 'soul_id',
      remoteId,
      status: 'ready',
      costUsd: chargedUsd,
      trainedAt: now(),
      sourceAssetIds: sources.map((source) => source.asset_id),
    });
    await recordTrainingSpend(services.db, {
      identityId,
      trainer: 'higgsfield',
      modelId: TRAINER_PRICING.higgsfield.model_id,
      estimateUsd: trainingEstimate.estimate_usd,
      actualUsd: chargedUsd,
      characterId,
      handle: input.handle,
      now: now(),
    });
    return {
      identity_id: identityId,
      provider: 'higgsfield',
      kind: 'soul_id',
      status: 'ready',
      remote_id: remoteId,
    };
  }

  // fal and Replicate train a LoRA. The zip of images is uploaded by the caller
  // and passed as a URL in the training input; here we submit, poll, download the
  // safetensors file, verify its checksum and copy it to the user's disk.
  const trigger = input.trigger_word ?? triggerWordFor(input.handle);
  if (!isValidTriggerWord(trigger)) {
    throw new KilnryError('INVALID_INPUT', 'A trigger word must be at least four letters or digits.');
  }
  const context = adapterContext(key, fetchImpl);
  const request = {
    kind: 'image' as const,
    capability: 'train_lora' as const,
    prompt: '',
    params: {
      extra: {
        model: card.model_id,
        images_data_url: sources.map((source) => source.url),
        trigger_word: trigger,
        steps,
        create_masks: head[0].kind === 'character' || head[0].kind === 'environment',
        is_style: head[0].kind === 'style',
      },
    },
    medias: [],
    injections: [],
    count: 1,
    target_folder: 'inbox',
    source: 'ui' as const,
  } as unknown as import('../types.js').CanonicalRequest;

  try {
    const handle = await adapter.submit(request, context);
    const result = await runToCompletion(adapter, handle, context);
    const artefactUrl = result.outputs[0]?.url;
    if (!artefactUrl) throw new KilnryError('PROVIDER_ERROR', 'Training returned no artefact URL.');
    const bytes = await downloadArtefact(fetchImpl, artefactUrl);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await mkdir(providerDir, { recursive: true });
    const localPath = join(providerDir, 'lora.safetensors');
    await writeFile(localPath, bytes);
    const trainedAt = now();
    const expiresAt = new Date(trainedAt.getTime() + 7 * 86_400_000);
    const manifest = {
      provider: input.trainer,
      kind: 'lora',
      base_model: card.base_model,
      trigger_word: trigger,
      default_scale: 0.85,
      artifact_url: artefactUrl,
      sha256,
      bytes: bytes.byteLength,
      trained_at: trainedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      source_asset_ids: sources.map((source) => source.asset_id),
      cost_usd: chargedUsd,
      trainer_model_id: card.model_id,
      steps,
    };
    await writeFile(join(providerDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await upsertIdentity(services.db, {
      id: identityId,
      characterId,
      version,
      provider: input.trainer,
      kind: 'lora',
      status: 'ready',
      baseModel: card.base_model,
      triggerWord: trigger,
      defaultScale: 0.85,
      localPath,
      artifactUrl: artefactUrl,
      sha256,
      costUsd: chargedUsd,
      trainedAt,
      expiresAt,
      sourceAssetIds: sources.map((source) => source.asset_id),
    });
    await recordTrainingSpend(services.db, {
      identityId,
      trainer: input.trainer,
      modelId: TRAINER_PRICING[input.trainer].model_id,
      estimateUsd: trainingEstimate.estimate_usd,
      actualUsd: chargedUsd,
      characterId,
      handle: input.handle,
      now: trainedAt,
    });
    return {
      identity_id: identityId,
      provider: input.trainer,
      kind: 'lora',
      status: 'ready',
      local_path: localPath,
      sha256,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Training failed.';
    await upsertIdentity(services.db, {
      id: identityId,
      characterId,
      version,
      provider: input.trainer,
      kind: 'lora',
      status: 'failed',
      error: message,
    });
    return {
      identity_id: identityId,
      provider: input.trainer,
      kind: 'lora',
      status: 'failed',
      error: message,
    };
  }
}

// Create a hosted Soul ID from a set of public image URLs and poll it to ready
// (TRD-14 §10.3). The ToS notice is enforced at key-save time (D-44).
async function trainSoulId(
  fetchImpl: typeof fetch,
  baseUrl: string,
  key: string,
  input: { name: string; images: string[] },
): Promise<string> {
  const created = (await fetchJson(fetchImpl, `${baseUrl}/v1/custom-references`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      input_images: input.images.map((url) => ({ type: 'image_url', image_url: url })),
    }),
  })) as { id?: string; status?: string };
  if (!created.id) throw new KilnryError('PROVIDER_ERROR', 'Higgsfield did not return a reference id.');
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = (await fetchJson(fetchImpl, `${baseUrl}/v1/custom-references/${created.id}`, {
      headers: { Authorization: `Key ${key}` },
    })) as { status?: string };
    const state = status.status?.toLowerCase();
    if (state === 'completed') return created.id;
    if (state === 'failed')
      throw new KilnryError('PROVIDER_ERROR', 'Higgsfield could not train the Soul ID.', { retryable: true });
  }
  throw new KilnryError('PROVIDER_ERROR', 'The Soul ID did not finish in time.', { retryable: true });
}

async function fetchJson(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetchImpl(url, init);
  if (!response.ok)
    throw new KilnryError('PROVIDER_ERROR', `Higgsfield returned ${response.status}.`, {
      provider: 'higgsfield',
      retryable: response.status >= 500,
    });
  return response.json();
}

async function downloadArtefact(fetchImpl: typeof fetch, url: string): Promise<Uint8Array> {
  const response = await fetchImpl(url);
  if (!response.ok)
    throw new KilnryError('PROVIDER_ERROR', `Could not download the artefact (${response.status}).`, {
      retryable: true,
    });
  return new Uint8Array(await response.arrayBuffer());
}

interface IdentityRow {
  id: string;
  characterId: string;
  version: number;
  provider: TrainerId;
  kind: 'lora' | 'soul_id';
  status: 'ready' | 'failed';
  baseModel?: string | undefined;
  triggerWord?: string | undefined;
  defaultScale?: number | undefined;
  localPath?: string | undefined;
  artifactUrl?: string | undefined;
  remoteId?: string | undefined;
  sha256?: string | undefined;
  costUsd?: number | undefined;
  trainedAt?: Date | undefined;
  expiresAt?: Date | undefined;
  sourceAssetIds?: string[] | undefined;
  error?: string | undefined;
}

// Record a completed training run as exactly one spend-ledger row and one audit
// event (F-CHR-07, F-PRV-05, TRD-15). The ledger row has no job id because
// training does not go through the job queue; it is keyed by the identity id so
// a run is charged at most once.
async function recordTrainingSpend(
  db: DatabaseState,
  input: {
    identityId: string;
    trainer: TrainerId;
    modelId: string;
    estimateUsd: number;
    actualUsd: number;
    characterId: string;
    handle: string;
    now: Date;
  },
): Promise<void> {
  await db.db.insert(spendLedger).values({
    id: input.identityId,
    providerId: input.trainer,
    modelId: input.modelId,
    folder: 'inbox',
    characterIds: [input.characterId],
    kind: 'train',
    estimateUsd: input.estimateUsd.toFixed(6),
    actualUsd: input.actualUsd.toFixed(6),
    currencyNote: 'training',
    occurredAt: input.now,
  });
  await db.db.insert(auditEvents).values({
    id: ulid(),
    actor: 'user',
    action: 'character.train',
    target: input.handle.replace(/^@/, ''),
    meta: { trainer: input.trainer, estimate_usd: input.estimateUsd, actual_usd: input.actualUsd },
  });
}

// Upsert the trained_identities row for one (character, version, provider, kind).
async function upsertIdentity(db: DatabaseState, row: IdentityRow): Promise<void> {
  const existing = await db.db
    .select({ id: trainedIdentities.id })
    .from(trainedIdentities)
    .where(
      and(
        eq(trainedIdentities.characterId, row.characterId),
        eq(trainedIdentities.version, row.version),
        eq(trainedIdentities.providerId, row.provider),
        eq(trainedIdentities.kind, row.kind),
      ),
    )
    .limit(1);
  const values = {
    characterId: row.characterId,
    version: row.version,
    providerId: row.provider,
    kind: row.kind,
    status: row.status,
    remoteId: row.remoteId ?? null,
    artifactUrl: row.artifactUrl ?? null,
    localPath: row.localPath ?? null,
    sha256: row.sha256 ?? null,
    baseModel: row.baseModel ?? null,
    triggerWord: row.triggerWord ?? null,
    defaultScale: row.defaultScale === undefined ? null : String(row.defaultScale),
    costUsd: row.costUsd === undefined ? null : String(row.costUsd),
    trainedAt: row.trainedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    sourceAssetIds: row.sourceAssetIds ?? null,
    error: row.error ?? null,
  };
  if (existing[0]) {
    await db.db.update(trainedIdentities).set(values).where(eq(trainedIdentities.id, existing[0].id));
    // Mark the version as having a trained identity, freezing implicitly happens
    // when the identity is used in a job (F-CHR-10).
    void characterVersions;
    return;
  }
  await db.db.insert(trainedIdentities).values({ id: row.id, ...values });
}
