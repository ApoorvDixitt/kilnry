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

export function RunHeader({
  run,
  onCancel,
  onRerunFrom,
  onDuplicate,
  onOpenFolder,
  onExportManifest,
  onSaveAsWorkflow,
}: {
  run: RunView;
  onCancel: () => void;
  onRerunFrom?: (stepId: string) => void;
  onDuplicate?: () => void;
  onOpenFolder?: () => void;
  onExportManifest?: () => void;
  onSaveAsWorkflow?: () => void;
}): React.ReactNode {
  const { done, total, fraction } = progress(run);
  const finished = ['completed', 'failed', 'cancelled'].includes(run.status);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const hasMenu = Boolean(onRerunFrom || onDuplicate || onOpenFolder || onExportManifest || onSaveAsWorkflow);
  const completedSteps = run.steps.filter((step) => step.status === 'completed');
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
        {hasMenu ? (
          <div className="run-menu">
            <button
              type="button"
              className="run-menu-button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={message('workflows.runView.menu')}
              onClick={() => {
                setMenuOpen((open) => !open);
                setPickOpen(false);
              }}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="run-menu-items" role="menu">
                {onRerunFrom && completedSteps.length > 0 ? (
                  <button type="button" role="menuitem" onClick={() => setPickOpen((open) => !open)}>
                    {message('workflows.runView.menuRerunFrom')}
                  </button>
                ) : null}
                {pickOpen && onRerunFrom ? (
                  <div className="run-menu-pick" role="menu">
                    <p>{message('workflows.runView.menuRerunPick')}</p>
                    {completedSteps.map((step) => (
                      <button
                        key={step.step_id}
                        type="button"
                        role="menuitem"
                        data-step-id={step.step_id}
                        onClick={() => {
                          onRerunFrom(step.step_id);
                          setMenuOpen(false);
                          setPickOpen(false);
                        }}
                      >
                        {step.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                {onDuplicate ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onDuplicate();
                      setMenuOpen(false);
                    }}
                  >
                    {message('workflows.runView.menuDuplicate')}
                  </button>
                ) : null}
                {onOpenFolder ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onOpenFolder();
                      setMenuOpen(false);
                    }}
                  >
                    {message('workflows.runView.menuOpenFolder')}
                  </button>
                ) : null}
                {onExportManifest ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onExportManifest();
                      setMenuOpen(false);
                    }}
                  >
                    {message('workflows.runView.menuExportManifest')}
                  </button>
                ) : null}
                {onSaveAsWorkflow ? (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="run-save-as-workflow"
                    onClick={() => {
                      onSaveAsWorkflow();
                      setMenuOpen(false);
                    }}
                  >
                    {message('workflows.runView.menuSaveAsWorkflow')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
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
  onRerunFrom,
  busy = false,
}: {
  step: RunStepView | undefined;
  onRetry?: (stepId: string, model?: string) => void;
  onRerunFrom?: (stepId: string) => void;
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
      {(onRetry && failed) || (onRerunFrom && canRerun) ? (
        <div className="run-step-actions">
          {failed && onRetry ? (
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
          ) : canRerun && onRerunFrom ? (
            <button
              type="button"
              className="run-step-rerun-button"
              disabled={busy}
              onClick={() => onRerunFrom(step.step_id)}
            >
              {message('workflows.runView.rerunFrom')}
            </button>
          ) : null}
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
  onEdit,
  onRegenerate,
  onStop,
  busy = false,
}: {
  run: RunView;
  onApprove: () => void;
  onDeny: () => void;
  onEdit?: (stepId: string) => void;
  onRegenerate?: (stepId: string) => void;
  onStop?: () => void;
  busy?: boolean;
}): React.ReactNode {
  const waiting = run.steps.find((step) => step.status === 'waiting');
  const waitingAssets = waiting?.outputs?.assets ?? [];
  // The planned calls that still remain: steps not yet completed or skipped,
  // with their estimated cost, so the card shows what approving will spend.
  const remaining = run.steps.filter((step) => !['completed', 'skipped', 'waiting'].includes(step.status));
  const remainingCost = remaining.reduce((total, step) => total + (step.estimate_usd ?? 0), 0);
  // The design contract §2.12 and PRD-10 §4 bind Enter to Approve and Esc to
  // Deny while the card is shown. The listener ignores a keystroke aimed at a
  // text field and does nothing while a decision is already in flight.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (busy) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (event.key === 'Enter') {
        event.preventDefault();
        onApprove();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onDeny();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onApprove, onDeny]);
  return (
    <section className="approval-card" role="alertdialog" aria-label={message('workflows.approval.title')}>
      <h2 className="approval-card-title">
        {message('workflows.approval.title')}
        {waiting ? ` · ${waiting.name}` : ''}
      </h2>
      {waitingAssets.length > 0 ? (
        <ul className="approval-card-outputs" aria-label={message('workflows.approval.outputs')}>
          {waitingAssets.map((assetId) => (
            <li key={assetId} className="approval-output-card" data-asset-id={assetId}>
              <a
                className="approval-output-zoom"
                href={`/api/media/${encodeURIComponent(assetId)}`}
                target="_blank"
                rel="noreferrer"
                aria-label={message('workflows.approval.zoom')}
              >
                <img
                  className="approval-output-thumb"
                  src={`/api/thumb/${encodeURIComponent(assetId)}`}
                  alt={assetId}
                  loading="lazy"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
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
        {onEdit && waiting ? (
          <button
            type="button"
            className="approval-edit-button"
            disabled={busy}
            onClick={() => onEdit(waiting.step_id)}
          >
            {message('workflows.approval.edit')}
          </button>
        ) : null}
        {onRegenerate && waiting ? (
          <button
            type="button"
            className="approval-regenerate-button"
            disabled={busy}
            onClick={() => onRegenerate(waiting.step_id)}
          >
            {message('workflows.approval.regenerate')}
          </button>
        ) : null}
        {onStop ? (
          <button type="button" className="approval-stop-button" disabled={busy} onClick={onStop}>
            {message('workflows.approval.stop')}
          </button>
        ) : null}
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
  const [savedWorkflowNote, setSavedWorkflowNote] = useState<string>();
  // The Save-as-workflow dialog: a name and a "make this a field" toggle per
  // run input (PRD-10 §8). A toggle off fixes that input as a const.
  const [saveDialog, setSaveDialog] = useState<{ name: string; fields: Record<string, boolean> } | null>(
    null,
  );

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
    // Drive the run view from the pg-boss event hub over server-sent events
    // rather than a fixed 2-second poll (F32, PRD-10 §3). Every job update,
    // completion, failure or moderation the run's steps produce arrives on the
    // same /api/events stream the shell already listens to, so the view
    // refreshes the instant a step changes instead of on the next tick. The
    // stream stays open only while the run is live or has not loaded yet; a
    // loaded, terminal run needs no further updates (F-WFL-03). When the browser
    // has no EventSource, fall back to a slow safety poll so the view still
    // advances.
    if (run && !isLive(run.status)) return;
    if (typeof EventSource === 'undefined') {
      const timer = setInterval(() => void reload(), 2000);
      return () => clearInterval(timer);
    }
    const source = new EventSource('/api/events');
    const onJob = (): void => void reload();
    for (const type of [
      'job.updated',
      'job.completed',
      'job.failed',
      'job.moderated',
      // The run itself now drives in a worker, not in the approve/start request
      // (TRD-12 §6), so the run-level transitions arrive here too: a pause at a
      // checkpoint (run.awaiting) and a terminal status (run.updated).
      'run.updated',
      'run.awaiting',
    ]) {
      source.addEventListener(type, onJob);
    }
    source.addEventListener('error', () => source.close());
    // A low-frequency safety poll covers the first-write race (a run row that
    // appears just after the stream opened) and any missed event, without the
    // old two-second churn.
    const safety = setInterval(() => void reload(), 10_000);
    return () => {
      source.close();
      clearInterval(safety);
    };
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

  // Re-run from a completed step as a new child run (F-WFL-05 / F31): the server
  // copies the inputs and plan, reuses the earlier outputs at no cost and writes
  // into a _rerun folder; the view navigates to the child run it returns.
  const rerunFrom = useCallback(
    async (stepId: string): Promise<void> => {
      const response = await apiFetch(`/api/runs/${encodeURIComponent(runId)}/rerun-from`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step_id: stepId }),
      });
      if (!response.ok) return;
      const body = (await response.json()) as { run_id?: string };
      if (body.run_id) window.location.assign(`/workflows/runs/${encodeURIComponent(body.run_id)}`);
    },
    [runId],
  );

  // Duplicate the run as a fresh child from its first step (F33 header menu):
  // re-run from the earliest step so every step runs anew under a new run id.
  const duplicate = useCallback(async (): Promise<void> => {
    const first = run?.steps[0];
    if (first) await rerunFrom(first.step_id);
  }, [run, rerunFrom]);

  // Open the output folder: a native launcher reveals it; here (and in Docker)
  // the path is copied to the clipboard so the reader can open it themselves.
  const openFolder = useCallback((): void => {
    if (!run?.folder) return;
    void navigator.clipboard?.writeText(run.folder).catch(() => undefined);
  }, [run]);

  // Export the run manifest: download the run's data as run.kilnry.json, the
  // same shape written to the run folder on disk (F-WFL-09).
  const exportManifest = useCallback((): void => {
    if (!run) return;
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'run.kilnry.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [run]);

  // Open the Save-as-workflow dialog, defaulting every run input to a field.
  const saveAsWorkflow = useCallback((): void => {
    if (!run) return;
    const keys = Object.keys(run.inputs ?? {});
    const fields: Record<string, boolean> = {};
    for (const key of keys) fields[key] = true;
    setSaveDialog({ name: run.workflow_id ? `${run.workflow_id} (saved)` : 'Saved run', fields });
  }, [run]);

  const confirmSaveAsWorkflow = useCallback((): void => {
    if (!saveDialog) return;
    const { name, fields } = saveDialog;
    setSaveDialog(null);
    void apiFetch(`/api/runs/${encodeURIComponent(runId)}/save-as-workflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, fields }),
    })
      .then(
        (response) => response.json() as Promise<{ workflow?: { id: string }; error?: { message: string } }>,
      )
      .then((body) => {
        if (body.error) throw new Error(body.error.message);
        setSavedWorkflowNote(
          message('workflows.runView.savedAsWorkflow').replace('{id}', body.workflow?.id ?? ''),
        );
      })
      .catch((cause: unknown) =>
        setSavedWorkflowNote(
          cause instanceof Error ? cause.message : message('workflows.runView.saveFailed'),
        ),
      );
  }, [saveDialog, runId]);

  const current = useMemo(
    () => run?.steps.find((step) => step.step_id === selected) ?? run?.steps[0],
    [run, selected],
  );

  if (!run) return <section className="run-view" aria-busy="true" />;

  return (
    <section className="run-view">
      <RunHeader
        run={run}
        onCancel={() => void cancel()}
        onRerunFrom={(stepId) => void rerunFrom(stepId)}
        onDuplicate={() => void duplicate()}
        onOpenFolder={openFolder}
        onExportManifest={exportManifest}
        {...(run.status === 'completed' ? { onSaveAsWorkflow: saveAsWorkflow } : {})}
      />
      {savedWorkflowNote ? (
        <p className="run-saved-note" role="status" data-testid="run-saved-note">
          {savedWorkflowNote}
        </p>
      ) : null}
      {saveDialog ? (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" data-testid="run-save-dialog">
          <div className="dialog">
            <h3>{message('workflows.runView.saveTitle')}</h3>
            <label className="run-save-name">
              {message('workflows.runView.saveName')}
              <input
                type="text"
                value={saveDialog.name}
                onChange={(event) =>
                  setSaveDialog((prev) => (prev ? { ...prev, name: event.target.value } : prev))
                }
              />
            </label>
            <p className="muted">{message('workflows.runView.saveFieldsHint')}</p>
            <ul className="run-save-fields">
              {Object.keys(saveDialog.fields).map((key) => (
                <li key={key}>
                  <label>
                    <input
                      type="checkbox"
                      data-testid={`run-save-field-${key}`}
                      checked={saveDialog.fields[key]}
                      onChange={(event) =>
                        setSaveDialog((prev) =>
                          prev ? { ...prev, fields: { ...prev.fields, [key]: event.target.checked } } : prev,
                        )
                      }
                    />
                    <span>{key}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setSaveDialog(null)}>
                {message('workflows.runView.saveCancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="run-save-confirm"
                onClick={confirmSaveAsWorkflow}
              >
                {message('workflows.runView.saveConfirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {run.status === 'awaiting_approval' ? (
        <ApprovalCard
          run={run}
          onApprove={() => void approve()}
          onDeny={() => void deny()}
          onEdit={(stepId) => setSelected(stepId)}
          onRegenerate={(stepId) => void retry(stepId)}
          onStop={() => void cancel()}
        />
      ) : null}
      <div className="run-body">
        <StepList steps={run.steps} selected={selected} onSelect={setSelected} />
        <StepDetail
          step={current}
          onRetry={(stepId, model) => void retry(stepId, model)}
          onRerunFrom={(stepId) => void rerunFrom(stepId)}
        />
      </div>
    </section>
  );
}
