// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The workflow run view (F-WFL-03). A header with the status, how far the run is,
// a thin progress bar, the cost so far against the estimate and a Cancel button;
// a StepList on the left with a status glyph and model chip per step; and a
// StepDetail on the right with Inputs, Outputs, Logs and Cost tabs. The view
// polls while the run is live. The cost figures use the money-green accent.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import {
  costSoFarLabel,
  isLive,
  progress,
  statusGlyph,
  type RunStepView,
  type RunView,
} from './workflow-run-view-logic';

const DETAIL_TABS = ['inputs', 'outputs', 'logs', 'cost'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

export function RunHeader({ run, onCancel }: { run: RunView; onCancel: () => void }): React.ReactNode {
  const { done, total, fraction } = progress(run);
  const finished = ['completed', 'failed', 'cancelled'].includes(run.status);
  return (
    <header className="run-header">
      <div className="run-header-top">
        <span className={`run-status-pill run-status-${run.status}`}>{run.status}</span>
        <span className="run-progress-count">
          {message('workflows.runView.progress').replace('{n}', String(done)).replace('{m}', String(total))}
        </span>
        <span className="run-cost">{costSoFarLabel(run)}</span>
        {finished ? null : (
          <button type="button" className="run-cancel-button" onClick={onCancel}>
            {message('workflows.runView.cancel')}
          </button>
        )}
      </div>
      <div className="run-progress-bar" role="progressbar" aria-valuenow={Math.round(fraction * 100)}>
        <div className="run-progress-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
    </header>
  );
}

export function StepList({
  steps,
  selected,
  onSelect,
}: {
  steps: RunStepView[];
  selected: string | undefined;
  onSelect: (stepId: string) => void;
}): React.ReactNode {
  return (
    <ol className="run-step-list" aria-label={message('workflows.runView.stepsLabel')}>
      {steps.map((step, index) => (
        <li key={step.step_id}>
          <button
            type="button"
            className={`run-step-row${selected === step.step_id ? ' is-selected' : ''}`}
            data-step-id={step.step_id}
            data-status={step.status}
            aria-current={selected === step.step_id}
            onClick={() => onSelect(step.step_id)}
          >
            <span className={`run-step-glyph glyph-${statusGlyph(step.status)}`} aria-hidden="true" />
            <span className="run-step-number">{index + 1}</span>
            <span className="run-step-name">{step.name}</span>
            {step.model ? <span className="run-step-model">{step.model}</span> : null}
          </button>
        </li>
      ))}
    </ol>
  );
}

export function StepDetail({ step }: { step: RunStepView | undefined }): React.ReactNode {
  const [tab, setTab] = useState<DetailTab>('outputs');
  if (!step) return <section className="run-step-detail" aria-live="polite" />;
  return (
    <section className="run-step-detail" aria-live="polite">
      <h2 className="run-step-detail-title">{step.name}</h2>
      <div className="run-detail-tabs" role="tablist" aria-label={message('workflows.runView.detailLabel')}>
        {DETAIL_TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            className="run-detail-tab"
            onClick={() => setTab(entry)}
          >
            {message(`workflows.runView.tab.${entry}`)}
          </button>
        ))}
      </div>
      <div className="run-detail-body">
        {tab === 'cost' ? (
          <p className="run-detail-cost">
            {step.actual_usd !== null
              ? `$${step.actual_usd.toFixed(2)}`
              : step.estimate_usd !== null
                ? `≈ $${step.estimate_usd.toFixed(2)}`
                : message('workflows.costUnknown')}
          </p>
        ) : (
          <p className="run-detail-empty">{message(`workflows.runView.tab.${tab}`)}</p>
        )}
      </div>
    </section>
  );
}

export function WorkflowRunView({ runId, initial }: { runId: string; initial?: RunView }): React.ReactNode {
  const [run, setRun] = useState<RunView | null>(initial ?? null);
  const [selected, setSelected] = useState<string>();

  const reload = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
      if (!response.ok) return;
      const body = (await response.json()) as { run?: RunView };
      if (body.run) setRun(body.run);
    } catch {
      // Leave the current view in place on a failed poll.
    }
  }, [runId]);

  useEffect(() => {
    if (initial === undefined) void reload();
  }, [initial, reload]);

  useEffect(() => {
    if (!run || !isLive(run.status)) return;
    const timer = setInterval(() => void reload(), 2000);
    return () => clearInterval(timer);
  }, [run, reload]);

  const cancel = useCallback(async (): Promise<void> => {
    await apiFetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
    void reload();
  }, [runId, reload]);

  const current = useMemo(
    () => run?.steps.find((step) => step.step_id === selected) ?? run?.steps[0],
    [run, selected],
  );

  if (!run) return <section className="run-view" aria-busy="true" />;

  return (
    <section className="run-view">
      <RunHeader run={run} onCancel={() => void cancel()} />
      <div className="run-body">
        <StepList steps={run.steps} selected={selected} onSelect={setSelected} />
        <StepDetail step={current} />
      </div>
    </section>
  );
}
