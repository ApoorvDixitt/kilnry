// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The transforms panel (F-CRE-11, PRD-05 §11). A right drawer with one tab per
// provider-billed operation — upscale, remove background, reframe, outpaint,
// lip-sync and transcribe today; dubbing and voice change show a not-available
// notice. Each tab takes a source asset and the operation's inputs, prices
// through the transform route (the same engine the composer uses) and runs only
// after a confirmed cost. Nothing is reimplemented: Run posts to /api/transform.

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import {
  TRANSFORM_TABS,
  canRun,
  lipsyncBilledSeconds,
  tabFor,
  type TransformOp,
} from './transforms-panel-logic';

export function TransformsPanel({
  source,
  onClose,
  onRan,
}: {
  source: string;
  onClose: () => void;
  onRan?: () => void;
}): React.ReactNode {
  const [op, setOp] = useState<TransformOp>('upscale_image');
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [estimateUsd, setEstimateUsd] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();

  const tab = tabFor(op);
  const runnable = canRun({ op, source, params, running });

  // Re-price whenever the op or its inputs change, on the same route Run uses.
  useEffect(() => {
    if (!tab.available || source.trim() === '') {
      setEstimateUsd(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void apiFetch('/api/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, source, params, estimate_only: true }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { estimate_usd?: number } | null) => {
          if (!cancelled) setEstimateUsd(body?.estimate_usd ?? null);
        })
        .catch(() => {
          if (!cancelled) setEstimateUsd(null);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [op, source, params, tab.available]);

  function setParam(key: string, value: unknown): void {
    setParams((prior) => ({ ...prior, [key]: value }));
  }

  function run(): void {
    if (!runnable || estimateUsd === null) return;
    setRunning(true);
    setError(undefined);
    void apiFetch('/api/transform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, source, params, confirm_cost_usd: estimateUsd }),
    })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((body: { error?: { message?: string } }) => {
              throw new Error(body.error?.message ?? message('create.transform.failed'));
            }),
      )
      .then(() => {
        onRan?.();
        onClose();
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : message('create.transform.failed')),
      )
      .finally(() => setRunning(false));
  }

  const clipSeconds = typeof params.clip_seconds === 'number' ? params.clip_seconds : 0;

  return (
    <aside className="transforms-panel" role="dialog" aria-label={message('create.transform.title')}>
      <header className="transforms-header">
        <h3>{message('create.transform.title')}</h3>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {message('create.transform.close')}
        </button>
      </header>

      <div className="transforms-tabs" role="tablist">
        {TRANSFORM_TABS.map((each) => (
          <button
            key={each.op}
            role="tab"
            aria-selected={op === each.op}
            className={op === each.op ? 'on' : ''}
            onClick={() => {
              setOp(each.op);
              setParams({});
            }}
          >
            {message(each.labelKey)}
          </button>
        ))}
      </div>

      {!tab.available ? (
        <p className="transforms-unavailable">{message('create.transform.unavailable')}</p>
      ) : (
        <div className="transforms-body">
          {tab.requires.includes('aspect_ratio') ? (
            <label className="transforms-field">
              {message('create.transform.aspect')}
              <select
                value={(params.aspect_ratio as string) ?? ''}
                onChange={(event) => setParam('aspect_ratio', event.target.value)}
              >
                <option value="">—</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
                <option value="16:9">16:9</option>
              </select>
            </label>
          ) : null}
          {tab.requires.includes('audio') ? (
            <label className="transforms-field">
              {message('create.transform.audio')}
              <input
                type="text"
                className="transforms-audio"
                value={(params.audio as string) ?? ''}
                placeholder={message('create.transform.audioHint')}
                onChange={(event) => setParam('audio', event.target.value)}
              />
            </label>
          ) : null}
          {op === 'lipsync' ? (
            <label className="transforms-field">
              {message('create.transform.clipSeconds')}
              <input
                type="number"
                min={0}
                value={clipSeconds}
                onChange={(event) => setParam('clip_seconds', Number(event.target.value))}
              />
              {clipSeconds > 0 ? (
                <span className="transforms-billed">
                  {message('create.transform.billedAs').replace(
                    '{seconds}',
                    String(lipsyncBilledSeconds(clipSeconds)),
                  )}
                </span>
              ) : null}
            </label>
          ) : null}

          <p className="transforms-cost">
            {estimateUsd === null
              ? message('create.transform.costUnknown')
              : message('create.transform.cost').replace('{price}', `$${estimateUsd.toFixed(2)}`)}
          </p>

          {error ? (
            <p className="characters-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="btn primary transforms-run" type="button" disabled={!runnable} onClick={run}>
            {running
              ? message('create.transform.running')
              : message('create.transform.run').replace(
                  '{price}',
                  estimateUsd === null ? '—' : `$${estimateUsd.toFixed(2)}`,
                )}
          </button>
        </div>
      )}
    </aside>
  );
}
