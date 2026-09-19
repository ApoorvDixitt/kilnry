'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import type { ApiEstimate, ApiModel } from '../lib/composer-types';
import { Composer } from './composer';
import type { ComposerMode } from './model-picker';
import type { ComposerParams } from './param-chips';

interface ResultTile {
  id: string;
  jobId: string;
  status: string;
  stepLabel: string;
  provider: string;
  assetId?: string | undefined;
  actualUsd?: string | null | undefined;
  error?: string | undefined;
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? message('create.proof.requestFailed'));
  return body;
}

function toEstimatePayload(state: {
  mode: ComposerMode;
  prompt: string;
  model: string;
  params: ComposerParams;
}): Record<string, unknown> {
  const params: Record<string, unknown> = { quality: 'standard' };
  if (state.params.aspect_ratio) params.aspect_ratio = state.params.aspect_ratio;
  if (state.params.resolution) params.resolution = state.params.resolution;
  if (state.params.duration_s !== undefined) params.duration_s = state.params.duration_s;
  if (state.params.audio !== undefined) params.audio = state.params.audio;
  if (state.mode === 'image') {
    params.width = 1024;
    params.height = 1024;
  }
  return {
    kind: state.mode === 'workflow' ? 'image' : state.mode,
    prompt: state.prompt,
    model: state.model,
    params,
    count: state.params.count,
  };
}

export function CreateComposer(): React.ReactNode {
  const [models, setModels] = useState<ApiModel[]>([]);
  const [estimate, setEstimate] = useState<ApiEstimate | null>(null);
  const [tiles, setTiles] = useState<ResultTile[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const lastState = useRef<ReturnType<typeof toEstimatePayload> | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    void fetch('/api/models')
      .then((response) => json<{ models: ApiModel[] }>(response))
      .then((body) => setModels(body.models))
      .catch((cause: unknown) =>
        setLoadError(cause instanceof Error ? cause.message : message('create.proof.requestFailed')),
      );
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
      const payload = toEstimatePayload(state);
      lastState.current = payload;
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

  async function generate(): Promise<void> {
    const payload = lastState.current;
    const priced = estimate;
    if (!payload || !priced) return;
    const tileId = crypto.randomUUID();
    const provider = priced.route.provider;
    // The queued tile appears immediately, before the provider responds.
    setTiles((prior) => [
      { id: tileId, jobId: '', status: 'queued', stepLabel: stepFor('queued', provider), provider },
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
                      <figcaption data-money="true">
                        {message('create.saved').replace(
                          '{amount}',
                          tile.actualUsd ? `$${Number(tile.actualUsd).toFixed(2)}` : '$0.00',
                        )}
                      </figcaption>
                    </figure>
                  ) : tile.error ? (
                    <p className="result-tile-error">{tile.error}</p>
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
      <Composer
        models={models}
        estimate={estimate}
        onStateChange={onStateChange}
        onGenerate={() => void generate()}
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
