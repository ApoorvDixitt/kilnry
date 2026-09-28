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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import {
  costSoFarLabel,
  isLive,
  progress,
  statusGlyph,
  statusLabel,
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
        <span className={`run-status-pill run-status-${run.status}`}>{statusLabel(run.status)}</span>
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
        {tab === 'inputs' ? <StepInputs step={step} /> : null}
        {tab === 'outputs' ? <StepOutputs step={step} /> : null}
        {tab === 'logs' ? <StepLogs step={step} /> : null}
        {tab === 'cost' ? <StepCost step={step} /> : null}
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

// The Inputs tab: the rendered prompt, params and media a step ran with, shown
// as a definition list. Structural values are JSON-formatted (F-WFL-03).
function StepInputs({ step }: { step: RunStepView }): React.ReactNode {
  const entries = Object.entries(step.inputs ?? {});
  if (entries.length === 0)
    return <p className="run-detail-empty">{message('workflows.runView.noInputs')}</p>;
  return (
    <dl className="run-detail-inputs">
      {entries.map(([key, value]) => (
        <div key={key} className="run-detail-input-row">
          <dt>{key}</dt>
          <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

// The Outputs tab: the assets a step produced, as cards with a thumbnail served
// by the Library media route (PRD-10 §3 Outputs as AssetCards, F-WFL-03).
function StepOutputs({ step }: { step: RunStepView }): React.ReactNode {
  const assets = step.outputs?.assets ?? [];
  if (assets.length === 0)
    return <p className="run-detail-empty">{message('workflows.runView.noOutputs')}</p>;
  return (
    <ul className="run-detail-outputs" aria-label={message('workflows.runView.tab.outputs')}>
      {assets.map((assetId) => (
        <li key={assetId} className="run-output-card" data-asset-id={assetId}>
          <img
            className="run-output-thumb"
            src={`/api/thumb/${encodeURIComponent(assetId)}`}
            alt={assetId}
            loading="lazy"
          />
        </li>
      ))}
    </ul>
  );
}

// The Logs tab: the step's logs in a monospaced pane with a follow-tail toggle.
// Follow-tail scrolls to the newest line only while the step is still running; a
// completed step is left where the reader put it (PRD-10 §3, F-WFL-03).
function StepLogs({ step }: { step: RunStepView }): React.ReactNode {
  const [follow, setFollow] = useState(true);
  const paneRef = useRef<HTMLPreElement | null>(null);
  const running = step.status === 'running';
  useEffect(() => {
    if (follow && running && paneRef.current) {
      paneRef.current.scrollTop = paneRef.current.scrollHeight;
    }
  }, [follow, running, step.logs]);
  if (!step.logs || step.logs.trim() === '')
    return <p className="run-detail-empty">{message('workflows.runView.noLogs')}</p>;
  return (
    <div className="run-detail-logs">
      <label className="run-logs-follow">
        <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
        {message('workflows.runView.followTail')}
      </label>
      <pre ref={paneRef} className="run-logs-pane">
        {step.logs}
      </pre>
    </div>
  );
}

// The Cost tab: the estimate against the actual spend and the unit price the job
// ran at (PRD-10 §3, F-WFL-03).
function StepCost({ step }: { step: RunStepView }): React.ReactNode {
  const unit = step.unit_price ?? null;
  return (
    <dl className="run-detail-cost">
      <div className="run-detail-input-row">
        <dt>{message('workflows.runView.estimateLabel')}</dt>
        <dd>{step.estimate_usd !== null ? `≈ $${step.estimate_usd.toFixed(2)}` : '—'}</dd>
      </div>
      <div className="run-detail-input-row">
        <dt>{message('workflows.runView.actualLabel')}</dt>
        <dd className="run-cost-actual">
          {step.actual_usd !== null
            ? `$${step.actual_usd.toFixed(2)}`
            : message('workflows.runView.costPending')}
        </dd>
      </div>
      {unit && Object.keys(unit).length > 0 ? (
        <div className="run-detail-input-row">
          <dt>{message('workflows.runView.unitPriceLabel')}</dt>
          <dd>{JSON.stringify(unit)}</dd>
        </div>
      ) : null}
    </dl>
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
    // Keep polling while the run has not loaded yet as well as while it is live.
    // Stopping when `run` was still null meant a first fetch that lost the race
    // with the run being written left the view blank for good: no header, no step
    // list and no approval card, so a run waiting for a decision could never be
    // answered. Polling stops only once a run has loaded and reached a terminal
    // state (F-WFL-03: the view survives a reload).
    if (run && !isLive(run.status)) return;
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
