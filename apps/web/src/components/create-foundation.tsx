'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Image as ImageIcon, LoaderCircle, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

interface Estimate {
  estimate_usd: number;
  authoritative_usd?: number;
  route: { provider: string; model: string; why: string };
  adjustments: string[];
}

interface Job {
  id: string;
  status: string;
  stepLabel?: string | null;
  outputAssetIds?: string[] | null;
  actualUsd?: string | null;
  errorMessage?: string | null;
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? message('create.proof.requestFailed'));
  return body;
}

export function CreateFoundation(): React.ReactNode {
  const [prompt, setPrompt] = useState(message('create.proof.examplePrompt'));
  const [providers, setProviders] = useState<string[]>([]);
  const [estimate, setEstimate] = useState<Estimate>();
  const [job, setJob] = useState<Job>();
  const [resultId, setResultId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void fetch('/api/providers')
      .then((response) => json<{ providers: Array<{ id: string; connected: boolean }> }>(response))
      .then((body) =>
        setProviders(body.providers.filter((provider) => provider.connected).map((provider) => provider.id)),
      )
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : message('create.proof.requestFailed')),
      );
  }, []);

  const demoOnly = useMemo(() => providers.length === 1 && providers[0] === 'pollinations', [providers]);

  async function price(): Promise<Estimate> {
    const body = await json<Estimate>(
      await apiFetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'image',
          prompt,
          model: 'auto',
          params: { width: 1024, height: 1024, resolution: '1K', quality: 'draft' },
        }),
      }),
    );
    setEstimate(body);
    return body;
  }

  async function poll(jobId: string): Promise<void> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const body = await json<{ job: Job }>(await fetch(`/api/jobs/${jobId}`));
      setJob(body.job);
      if (['completed', 'failed', 'moderated', 'cancelled'].includes(body.job.status)) {
        if (body.job.status === 'completed') setResultId(body.job.outputAssetIds?.[0]);
        else setError(body.job.errorMessage ?? message('create.proof.jobFailed'));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(message('create.proof.waitTimeout'));
  }

  async function generate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setJob(undefined);
    setResultId(undefined);
    try {
      const priced = estimate ?? (await price());
      const body = await json<{ jobs: Array<{ job_id: string; status: string }> }>(
        await apiFetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'image',
            prompt,
            model: 'auto',
            params: { width: 1024, height: 1024, resolution: '1K', quality: 'draft' },
            confirmed_cost_usd: priced.authoritative_usd ?? priced.estimate_usd,
            client_request_id: crypto.randomUUID(),
          }),
        }),
      );
      const created = body.jobs[0];
      if (!created) throw new Error(message('create.proof.requestFailed'));
      setJob({ id: created.job_id, status: created.status });
      await poll(created.job_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('create.proof.requestFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="create-foundation">
      <div className="proof-results" aria-live="polite">
        <AnimatePresence mode="wait">
          {resultId ? (
            <motion.figure
              key={resultId}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* User media is served by the authenticated, Range-capable route. */}
              <img src={`/api/media/${resultId}`} alt={prompt.slice(0, 80)} />
              <figcaption>
                {demoOnly ? <span>{message('create.demoBadge')}</span> : null}
                {message('create.proof.saved')}
                {job?.actualUsd ? ` · $${Number(job.actualUsd).toFixed(4)}` : ''}
              </figcaption>
            </motion.figure>
          ) : job ? (
            <motion.div
              className="proof-job"
              key="job"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <LoaderCircle className="proof-spinner" size={24} />
              <strong>{message(`create.proof.status.${job.status}`)}</strong>
              <span>{job.stepLabel ?? message('create.proof.queued')}</span>
            </motion.div>
          ) : providers.length === 0 ? (
            <div className="create-empty" key="empty">
              <div className="empty-illustration">
                <ImageIcon size={34} strokeWidth={1.5} />
              </div>
              <h2>{message('create.keylessTitle')}</h2>
              <p>{message('create.keylessBody')}</p>
              <Link href="/settings/providers">{message('create.addKey')}</Link>
            </div>
          ) : (
            <div className="create-empty" key="ready">
              <div className="empty-illustration">
                <Sparkles size={34} strokeWidth={1.5} />
              </div>
              <h2>{message('create.proof.readyTitle')}</h2>
              <p>{message('create.proof.readyBody')}</p>
              {demoOnly ? <span>{message('create.proof.demoOnly')}</span> : null}
            </div>
          )}
        </AnimatePresence>
      </div>
      <form className="composer-stub proof-composer" onSubmit={(event) => void generate(event)}>
        <div className="mode-segment">
          <button className="is-on" type="button">
            {message('create.modeImage')}
          </button>
          <button type="button" disabled title={message('create.proof.m3Later')}>
            {message('create.modeVideo')}
          </button>
          <button type="button" disabled title={message('create.proof.m3Later')}>
            {message('create.modeAudio')}
          </button>
          <button type="button" disabled title={message('create.proof.m3Later')}>
            {message('create.modeWorkflow')}
          </button>
        </div>
        <label htmlFor="proof-prompt">{message('create.proof.promptLabel')}</label>
        <textarea
          id="proof-prompt"
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            setEstimate(undefined);
          }}
          placeholder={message('create.composerPlaceholder')}
        />
        {error ? <p className="form-error">{error}</p> : null}
        <div className="composer-footer">
          <button
            className="model-chip"
            type="button"
            onClick={() => void price()}
            disabled={!prompt || providers.length === 0 || pending}
          >
            {estimate
              ? message('create.proof.route').replace('{model}', estimate.route.model)
              : message('create.proof.auto')}
          </button>
          <span className="composer-spacer" />
          <span className="cost-zero" data-money="true">
            {estimate
              ? `${estimate.authoritative_usd === undefined ? '≈ ' : ''}$${(
                  estimate.authoritative_usd ?? estimate.estimate_usd
                ).toFixed(4)}`
              : message('create.proof.estimateFirst')}
          </span>
          <button
            className="generate-button"
            type="submit"
            disabled={pending || providers.length === 0 || !prompt}
            title={providers.length === 0 ? message('create.generateDisabled') : undefined}
          >
            {pending ? message('create.proof.working') : message('create.generate')}
          </button>
        </div>
      </form>
      <p className="shortcut-hint">{message('create.proof.scopeNote')}</p>
    </section>
  );
}
