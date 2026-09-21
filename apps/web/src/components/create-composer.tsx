'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useRef, useState } from 'react';
import { SaveAsPreset, type ComposerSnapshot } from './save-as-preset';
import { TransformsPanel } from './transforms-panel';
import { AnimatePresence, motion } from 'motion/react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import type { ApiEstimate, ApiModel } from '../lib/composer-types';
import { Composer } from './composer';
import { batchRequests, parseBatch } from './batch-logic';
import { editPayload, editSourceFromDetail, type EditAssetDetail, type EditSource } from './edit-logic';
import type { ComposerMode } from './model-picker';
import type { ComposerParams } from './param-chips';
import { ResultTileActions, type TileCapabilities } from './result-tile-actions';
import { ModeratedTile } from './moderated-tile';
import type { BudgetLine } from './cost-strip';

interface ResultTile {
  id: string;
  jobId: string;
  status: string;
  stepLabel: string;
  provider: string;
  prompt: string;
  assetId?: string | undefined;
  actualUsd?: string | null | undefined;
  error?: string | undefined;
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? message('create.proof.requestFailed'));
  return body;
}

function toEstimatePayload(
  state: {
    mode: ComposerMode;
    prompt: string;
    model: string;
    params: ComposerParams;
  },
  edit?: EditSource | null,
): Record<string, unknown> {
  const params: Record<string, unknown> = { quality: 'standard' };
  if (state.params.aspect_ratio) params.aspect_ratio = state.params.aspect_ratio;
  if (state.params.resolution) params.resolution = state.params.resolution;
  if (state.params.duration_s !== undefined) params.duration_s = state.params.duration_s;
  if (state.params.audio !== undefined) params.audio = state.params.audio;
  if (state.mode === 'image') {
    params.width = 1024;
    params.height = 1024;
  }
  // In edit mode the request routes to image_edit or video2video with the source
  // recorded in medias[]; it is never a text-to-image request (F-CRE-10 AC 2).
  if (edit) {
    return editPayload(edit, { prompt: state.prompt, model: state.model, params });
  }
  return {
    kind: state.mode === 'workflow' ? 'image' : state.mode,
    prompt: state.prompt,
    model: state.model,
    params,
    count: state.params.count,
  };
}

export function CreateComposer({ editAssetId = null }: { editAssetId?: string | null }): React.ReactNode {
  const [models, setModels] = useState<ApiModel[]>([]);
  const [estimate, setEstimate] = useState<ApiEstimate | null>(null);
  const [tiles, setTiles] = useState<ResultTile[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [capabilities, setCapabilities] = useState<TileCapabilities>({ reveal: false });
  const [budgets, setBudgets] = useState<BudgetLine[]>([]);
  const [seed, setSeed] = useState<{ token: number; prompt: string }>();
  const [edit, setEdit] = useState<EditSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState<ComposerSnapshot | null>(null);
  const [transformSource, setTransformSource] = useState<string | null>(null);
  const editRef = useRef<EditSource | null>(null);
  const lastState = useRef<ReturnType<typeof toEstimatePayload> | null>(null);
  const lastPrompt = useRef('');
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Opening Create with ?edit=<assetId> — the Library asset's Edit action —
  // pre-attaches that asset as the Source and switches the composer to its kind
  // (F-CRE-10 AC 1). A non-image/non-video or missing asset shows the source
  // notice and leaves the composer in plain create mode. The query is read on the
  // server and handed in as a prop, so the composer is in the initial HTML.
  useEffect(() => {
    editRef.current = edit;
  }, [edit]);

  useEffect(() => {
    if (!editAssetId) {
      setEdit(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/library/asset/${encodeURIComponent(editAssetId)}`)
      .then((response) => (response.ok ? (response.json() as Promise<{ asset: EditAssetDetail }>) : null))
      .then((body) => {
        if (cancelled) return;
        const source = body?.asset ? editSourceFromDetail(body.asset) : null;
        setEdit(source);
        if (!source) setLoadError(message('create.edit.sourceMissing'));
      })
      .catch(() => {
        if (!cancelled) setLoadError(message('create.edit.sourceMissing'));
      });
    return () => {
      cancelled = true;
    };
  }, [editAssetId]);

  useEffect(() => {
    void fetch('/api/models')
      .then((response) => json<{ models: ApiModel[] }>(response))
      .then((body) => setModels(body.models))
      .catch((cause: unknown) =>
        setLoadError(cause instanceof Error ? cause.message : message('create.proof.requestFailed')),
      );
    void fetch('/api/capabilities')
      .then((response) => (response.ok ? (response.json() as Promise<{ reveal?: boolean }>) : null))
      .then((body) => {
        if (body) setCapabilities({ reveal: Boolean(body.reveal) });
      })
      .catch(() => setCapabilities({ reveal: false }));
    void fetch('/api/budget')
      .then((response) => (response.ok ? (response.json() as Promise<{ budgets: BudgetLine[] }>) : null))
      .then((body) => {
        if (body) setBudgets(body.budgets);
      })
      .catch(() => setBudgets([]));
  }, []);

  // A preset handed over from its drawer arrives as query parameters, so the
  // composer opens already filled in (PRD-09 §2 acceptance 3).
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const prompt = query.get('prompt');
    if (prompt === null || prompt === '') return;
    setSeed({ token: Date.now(), prompt });
    window.history.replaceState(null, '', '/create');
  }, []);

  // Re-price on every composer change, debounced, using the engine's estimate
  // route. The interface never computes a price itself.
  const onStateChange = useCallback(
    (state: {
      mode: ComposerMode;
      prompt: string;
      model: string;
      params: ComposerParams;
      ready: boolean;
    }) => {
      if (!state.ready) {
        setEstimate(null);
        lastState.current = null;
        return;
      }
      const payload = toEstimatePayload(state, editRef.current);
      lastState.current = payload;
      lastPrompt.current = state.prompt;
      // What "Save as preset" would turn into a file (F-CRE-12).
      setSnapshot({
        prompt: state.prompt,
        model: state.model,
        kind: (payload.kind as string) ?? 'image',
        params: (payload.params as Record<string, unknown>) ?? {},
        count: state.params.count,
        medias: (payload.medias as Array<{ role: string; asset_id?: string }>) ?? [],
      });
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        void apiFetch('/api/estimate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then((response) => json<ApiEstimate>(response))
          .then((body) => setEstimate(body))
          .catch(() => setEstimate(null));
      }, 150);
    },
    [],
  );

  async function poll(tileId: string, jobId: string): Promise<void> {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const body = await json<{ job: ResultTileJob }>(await fetch(`/api/jobs/${jobId}`));
      const job = body.job;
      setTiles((prior) =>
        prior.map((tile) =>
          tile.id === tileId
            ? {
                ...tile,
                status: job.status,
                stepLabel: job.stepLabel ?? stepFor(job.status, tile.provider),
                assetId: job.status === 'completed' ? (job.outputAssetIds?.[0] ?? undefined) : undefined,
                actualUsd: job.actualUsd ?? undefined,
                error:
                  job.status === 'failed' || job.status === 'moderated'
                    ? (job.errorMessage ?? message('create.proof.jobFailed'))
                    : undefined,
              }
            : tile,
        ),
      );
      if (['completed', 'failed', 'moderated', 'cancelled'].includes(job.status)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async function generate(overrideBudget = false): Promise<void> {
    const payload = lastState.current;
    const priced = estimate;
    if (!payload || !priced) return;
    const tileId = crypto.randomUUID();
    const provider = priced.route.provider;
    // The queued tile appears immediately, before the provider responds.
    setTiles((prior) => [
      {
        id: tileId,
        jobId: '',
        status: 'queued',
        stepLabel: stepFor('queued', provider),
        provider,
        prompt: lastPrompt.current,
      },
      ...prior,
    ]);
    try {
      const body = await json<{ jobs: Array<{ job_id: string; status: string }> }>(
        await apiFetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            confirmed_cost_usd: priced.authoritative_usd ?? priced.estimate_usd,
            client_request_id: crypto.randomUUID(),
            ...(overrideBudget ? { override_budget: true } : {}),
          }),
        }),
      );
      const created = body.jobs[0];
      if (!created) throw new Error(message('create.proof.requestFailed'));
      setTiles((prior) =>
        prior.map((tile) => (tile.id === tileId ? { ...tile, jobId: created.job_id } : tile)),
      );
      await poll(tileId, created.job_id);
    } catch (cause) {
      setTiles((prior) =>
        prior.map((tile) =>
          tile.id === tileId
            ? {
                ...tile,
                status: 'failed',
                error: cause instanceof Error ? cause.message : message('create.proof.requestFailed'),
              }
            : tile,
        ),
      );
    }
  }

  async function generateBatch(text: string, model: string): Promise<void> {
    const parse = parseBatch(text);
    if (parse.error || parse.lines.length === 0) return;
    const requests = batchRequests(parse, { kind: 'image', model }).map((request) => ({
      index: request.index,
      kind: request.kind,
      prompt: request.prompt,
      model: request.model,
      params: { quality: 'standard', width: 1024, height: 1024, ...request.params },
    }));
    const groupTiles = requests.map((request) => ({
      id: crypto.randomUUID(),
      jobId: '',
      status: 'queued',
      stepLabel: stepFor('queued', 'auto'),
      provider: 'auto',
      prompt: request.prompt,
    }));
    setTiles((prior) => [...groupTiles, ...prior]);
    try {
      const body = await json<{ jobs: Array<{ index?: number; job_id: string }> }>(
        await apiFetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests, client_request_id: crypto.randomUUID() }),
        }),
      );
      await Promise.all(
        body.jobs.map((job, position) => {
          const tile = groupTiles[job.index ?? position];
          if (!tile) return Promise.resolve();
          setTiles((prior) => prior.map((t) => (t.id === tile.id ? { ...t, jobId: job.job_id } : t)));
          return poll(tile.id, job.job_id);
        }),
      );
    } catch (cause) {
      const messageText = cause instanceof Error ? cause.message : message('create.proof.requestFailed');
      setTiles((prior) =>
        prior.map((t) =>
          groupTiles.some((g) => g.id === t.id) ? { ...t, status: 'failed', error: messageText } : t,
        ),
      );
    }
  }

  return (
    <section className="create-composer">
      <div className="create-results" aria-live="polite">
        {tiles.length === 0 ? (
          <p className="create-results-empty">{message('create.tile.readyBody')}</p>
        ) : (
          <ul className="result-grid">
            <AnimatePresence initial={false}>
              {tiles.map((tile) => (
                <motion.li
                  key={tile.id}
                  className="result-tile"
                  data-status={tile.status}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {tile.assetId ? (
                    <figure>
                      {/* Served by the authenticated, Range-capable media route. */}
                      <img src={`/api/media/${tile.assetId}`} alt="" />
                      {tile.provider === 'pollinations' ? (
                        <span className="result-tile-demo" data-demo="true">
                          {message('create.demoBadge')}
                        </span>
                      ) : null}
                      <figcaption data-money="true">
                        {message('create.saved').replace(
                          '{amount}',
                          tile.actualUsd ? `$${Number(tile.actualUsd).toFixed(2)}` : '$0.00',
                        )}
                      </figcaption>
                      <ResultTileActions
                        status="completed"
                        capabilities={capabilities}
                        handlers={{
                          onUsePrompt: () => setSeed({ token: Date.now(), prompt: tile.prompt }),
                          onRerun: () => void generate(),
                          onCopyPath: () => void navigator.clipboard?.writeText(`/api/media/${tile.assetId}`),
                          onCopyParams: () => void navigator.clipboard?.writeText(tile.prompt),
                          onDelete: () => setTiles((prior) => prior.filter((t) => t.id !== tile.id)),
                        }}
                      />
                      <button
                        type="button"
                        className="result-tile-transform"
                        onClick={() => setTransformSource(tile.assetId ?? null)}
                      >
                        {message('create.transform.open')}
                      </button>
                    </figure>
                  ) : tile.status === 'moderated' ? (
                    <ModeratedTile
                      info={{
                        provider: tile.provider,
                        reason: tile.error,
                        computeUsd: tile.actualUsd ? Number(tile.actualUsd) : 0,
                      }}
                      onEditPrompt={() => setSeed({ token: Date.now(), prompt: tile.prompt })}
                      onTryAnother={() => setSeed({ token: Date.now(), prompt: tile.prompt })}
                      onDismiss={() => setTiles((prior) => prior.filter((t) => t.id !== tile.id))}
                    />
                  ) : tile.error ? (
                    <>
                      <p className="result-tile-error">{tile.error}</p>
                      <ResultTileActions
                        status="failed"
                        capabilities={capabilities}
                        handlers={{
                          onRetry: () => void generate(),
                          onEditPrompt: () => setSeed({ token: Date.now(), prompt: tile.prompt }),
                          onCopyError: () => void navigator.clipboard?.writeText(tile.error ?? ''),
                        }}
                      />
                    </>
                  ) : (
                    <span className="result-tile-step">{tile.stepLabel}</span>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        {loadError ? <p className="form-error">{loadError}</p> : null}
      </div>
      {snapshot === null || snapshot.prompt.trim() === '' ? null : (
        <button type="button" className="create-save-preset" onClick={() => setSaving(true)}>
          {message('presets.saveTitle')}
        </button>
      )}
      {saving && snapshot !== null ? (
        <SaveAsPreset
          snapshot={{
            ...snapshot,
            ...(tiles[0]?.assetId === undefined ? {} : { exampleAssetId: tiles[0].assetId }),
          }}
          onClose={() => setSaving(false)}
        />
      ) : null}
      {transformSource !== null ? (
        <TransformsPanel source={transformSource} onClose={() => setTransformSource(null)} />
      ) : null}
      <Composer
        models={models}
        estimate={estimate}
        budgets={budgets}
        onStateChange={onStateChange}
        onGenerate={(payload) => {
          if (payload.batch_text) void generateBatch(payload.batch_text, payload.model);
          else void generate(payload.override_budget);
        }}
        seed={seed}
        {...(edit ? { edit } : {})}
        onExitEdit={() => {
          setEdit(null);
          setLoadError(undefined);
          window.history.replaceState(null, '', '/create');
        }}
      />
    </section>
  );
}

interface ResultTileJob {
  status: string;
  stepLabel?: string | null;
  outputAssetIds?: string[] | null;
  actualUsd?: string | null;
  errorMessage?: string | null;
}

function stepFor(status: string, provider: string): string {
  switch (status) {
    case 'queued':
      return message('create.tile.queued').replace('{provider}', provider);
    case 'running':
      return message('create.tile.rendering').replace('{elapsed}', '…');
    default:
      return message('create.tile.queued').replace('{provider}', provider);
  }
}
