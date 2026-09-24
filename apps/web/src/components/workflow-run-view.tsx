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

export function StepDetail({
  step,
  onRetry,
  busy = false,
}: {
  step: RunStepView | undefined;
  onRetry?: (stepId: string, model?: string) => void;
  busy?: boolean;
}): React.ReactNode {
  const [tab, setTab] = useState<DetailTab>('outputs');
  const [swapModel, setSwapModel] = useState('');
  if (!step) return <section className="run-step-detail" aria-live="polite" />;
  const failed = step.status === 'failed' || step.status === 'denied';
  const canRerun = step.status === 'completed';
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
      {onRetry && (failed || canRerun) ? (
        <div className="run-step-actions">
          {failed ? (
            <>
              <input
                type="text"
                className="run-step-swap-input"
                placeholder={message('workflows.runView.swapModel')}
                aria-label={message('workflows.runView.swapModel')}
                value={swapModel}
                onChange={(event) => setSwapModel(event.target.value)}
              />
              <button
                type="button"
                className="run-step-retry-button"
                disabled={busy}
                onClick={() => onRetry(step.step_id, swapModel.trim() === '' ? undefined : swapModel.trim())}
              >
                {message('workflows.runView.retry')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="run-step-rerun-button"
              disabled={busy}
              onClick={() => onRetry(step.step_id, undefined)}
            >
              {message('workflows.runView.rerunFrom')}
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function ApprovalCard({
  run,
  onApprove,
  onDeny,
  busy = false,
}: {
  run: RunView;
  onApprove: () => void;
  onDeny: () => void;
  busy?: boolean;
}): React.ReactNode {
  const waiting = run.steps.find((step) => step.status === 'waiting');
  // The planned calls that still remain: steps not yet completed or skipped,
  // with their estimated cost, so the card shows what approving will spend.
  const remaining = run.steps.filter((step) => !['completed', 'skipped', 'waiting'].includes(step.status));
  const remainingCost = remaining.reduce((total, step) => total + (step.estimate_usd ?? 0), 0);
  return (
    <section className="approval-card" role="alertdialog" aria-label={message('workflows.approval.title')}>
      <h2 className="approval-card-title">
        {message('workflows.approval.title')}
        {waiting ? ` · ${waiting.name}` : ''}
      </h2>
      <table className="approval-card-calls">
        <tbody>
          {remaining.map((step) => (
            <tr key={step.step_id} data-step-id={step.step_id}>
              <td>{step.name}</td>
              <td className="approval-card-model">{step.model ?? ''}</td>
              <td className="approval-card-cost">
                {step.estimate_usd && step.estimate_usd > 0 ? `≈ $${step.estimate_usd.toFixed(2)}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="approval-card-total">
        {message('workflows.approval.remaining')}
        <span className="approval-card-total-amount">{` ≈ $${remainingCost.toFixed(2)}`}</span>
      </p>
      <div className="approval-card-actions">
        <button type="button" className="approval-deny-button" disabled={busy} onClick={onDeny}>
          {message('workflows.approval.deny')}
        </button>
        <button type="button" className="approval-approve-button" disabled={busy} onClick={onApprove}>
          {message('workflows.approval.approve')}
        </button>
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

  const approve = useCallback(async (): Promise<void> => {
    await apiFetch(`/api/runs/${encodeURIComponent(runId)}/approve`, { method: 'POST' });
    void reload();
  }, [runId, reload]);

  const deny = useCallback(async (): Promise<void> => {
    await apiFetch(`/api/runs/${encodeURIComponent(runId)}/deny`, { method: 'POST' });
    void reload();
  }, [runId, reload]);

  const retry = useCallback(
    async (stepId: string, model?: string): Promise<void> => {
      await apiFetch(`/api/runs/${encodeURIComponent(runId)}/retry-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step_id: stepId, ...(model === undefined ? {} : { model }) }),
      });
      void reload();
    },
    [runId, reload],
  );

  const current = useMemo(
    () => run?.steps.find((step) => step.step_id === selected) ?? run?.steps[0],
    [run, selected],
  );

  if (!run) return <section className="run-view" aria-busy="true" />;

  return (
    <section className="run-view">
      <RunHeader run={run} onCancel={() => void cancel()} />
      {run.status === 'awaiting_approval' ? (
        <ApprovalCard run={run} onApprove={() => void approve()} onDeny={() => void deny()} />
      ) : null}
      <div className="run-body">
        <StepList steps={run.steps} selected={selected} onSelect={setSelected} />
        <StepDetail step={current} onRetry={(stepId, model) => void retry(stepId, model)} />
      </div>
    </section>
  );
}
