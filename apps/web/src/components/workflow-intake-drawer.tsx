// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The workflow intake drawer and plan preview (F-WFL-02). It renders a field per
// input from the workflow's JSON Schema (using the x-kilnry widget hints), asks
// the plan route to price the run, shows the plan as a checklist with a per-step
// model chip and cost and a total, and an Approve button that starts the run at
// that confirmed total. Nothing is charged until Approve; the total and the
// Approve button carry the money-green accent per the design contract.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import {
  initialInputs,
  missingRequired,
  readInputFields,
  stepCostLabel,
  totalLabel,
  etaLabel,
  type PlanView,
  type WorkflowInputField,
} from './workflow-intake-drawer-logic';

interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  inputs?: Record<string, unknown>;
}

export function PlanChecklist({ plan }: { plan: PlanView }): React.ReactNode {
  const done = 0;
  return (
    <div className="plan-checklist">
      <p className="plan-checklist-head">
        {message('workflows.planSteps')
          .replace('{n}', String(done))
          .replace('{m}', String(plan.steps.length))}
      </p>
      <ol className="plan-step-list">
        {plan.steps.map((step) => (
          <li key={step.step_id} className="plan-step" data-step-id={step.step_id}>
            <span className="plan-step-name">{step.name}</span>
            {step.model ? <span className="plan-step-model">{step.model}</span> : null}
            {step.approval ? (
              <span className="plan-step-approval">{message('workflows.checkpoint')}</span>
            ) : null}
            <span className="plan-step-cost">{stepCostLabel(step)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: WorkflowInputField;
  value: unknown;
  onChange: (value: unknown) => void;
}): React.ReactNode {
  const label = field.help ?? field.description ?? field.name;
  const id = `wf-input-${field.name}`;
  if (field.readOnly) {
    // A value fixed when the run was saved as a workflow (PRD-10 §8): shown as a
    // read-only chip, not editable, and never asked for.
    return (
      <div className="workflow-field workflow-field-const" data-testid="workflow-field-const">
        <span className="workflow-field-label">{label}</span>
        <span className="workflow-field-chip" data-readonly="true" aria-readonly="true">
          {String(field.constValue ?? field.default ?? '')}
        </span>
      </div>
    );
  }
  if (field.widget === 'toggle') {
    return (
      <label className="workflow-field workflow-field-toggle" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
    );
  }
  if (field.widget === 'segment' || field.widget === 'select' || field.enum) {
    const options = field.enum ?? field.options?.map(String) ?? [];
    return (
      <label className="workflow-field" htmlFor={id}>
        <span className="workflow-field-label">{label}</span>
        <select
          id={id}
          className="workflow-field-select"
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.required ? null : <option value="" />}
          {options.map((option) => (
            <option key={option} value={option}>
              {field.labels?.[option] ?? option}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.widget === 'number' || field.widget === 'chips') {
    return (
      <label className="workflow-field" htmlFor={id}>
        <span className="workflow-field-label">{label}</span>
        <input
          id={id}
          type="number"
          className="workflow-field-input"
          value={value === '' || value === undefined ? '' : Number(value)}
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
      </label>
    );
  }
  if (field.widget === 'textarea') {
    return (
      <label className="workflow-field" htmlFor={id}>
        <span className="workflow-field-label">{label}</span>
        <textarea
          id={id}
          className="workflow-field-textarea"
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }
  // media, character, voice, text, tags, language, folder all take a text value
  // in this first cut (drop/pick pickers arrive with the media tray wiring).
  return (
    <label className="workflow-field" htmlFor={id}>
      <span className="workflow-field-label">{label}</span>
      <input
        id={id}
        type="text"
        className="workflow-field-input"
        data-widget={field.widget}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function WorkflowIntakeDrawer({
  workflowId,
  name,
  onClose,
}: {
  workflowId: string;
  name: string;
  onClose: () => void;
}): React.ReactNode {
  const [fields, setFields] = useState<WorkflowInputField[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [folder, setFolder] = useState('');
  const [description, setDescription] = useState('');
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [runId, setRunId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // A plan refusal that names one input (D-59, TRD-12 §2): shown inline under
  // that field with the planner's own reason, not as a generic failure.
  const [refusal, setRefusal] = useState<{ input: string; reason: string }>();
  const [skipApprovals, setSkipApprovals] = useState(false);

  useEffect(() => {
    // A load that is superseded (the effect re-ran, or the drawer closed) must
    // not land afterwards: resetting the values then would silently replace the
    // answers the user already gave with the defaults.
    let current = true;
    void fetch(`/api/workflows/${encodeURIComponent(workflowId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { workflow?: WorkflowDefinition } | null) => {
        const workflow = body?.workflow;
        if (!current || !workflow) return;
        const read = readInputFields(workflow.inputs);
        setFields(read);
        setValues(initialInputs(read));
        setDescription(workflow.description ?? '');
      })
      .catch(() => {
        if (current) setError(message('workflows.loadFailed'));
      });
    return () => {
      current = false;
    };
  }, [workflowId]);

  const missing = missingRequired(fields, values);

  const requestPlan = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setRefusal(undefined);
    try {
      const response = await apiFetch(`/api/workflows/${encodeURIComponent(workflowId)}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: values }),
      });
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string; details?: { input?: string; reason?: string } };
        };
        const details = failed.error?.details;
        if (failed.error?.code === 'INVALID_INPUT' && details?.input && details.reason) {
          setRefusal({ input: details.input, reason: details.reason });
          return;
        }
        throw new Error('plan failed');
      }
      const body = (await response.json()) as { run_id: string; plan: PlanView };
      setRunId(body.run_id);
      setPlan(body.plan);
    } catch {
      setError(message('workflows.planFailed'));
    } finally {
      setBusy(false);
    }
  }, [workflowId, values]);

  const approve = useCallback(async (): Promise<void> => {
    if (!plan || !runId) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await apiFetch(`/api/workflows/${encodeURIComponent(workflowId)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: runId,
          confirm_cost_usd: plan.total_estimate_usd,
          ...(skipApprovals ? { skip_approvals: true } : {}),
          ...(folder.trim() === '' ? {} : { target_folder: folder.trim() }),
        }),
      });
      if (!response.ok) throw new Error('run failed');
      window.location.href = `/workflows/runs/${runId}`;
    } catch {
      setError(message('workflows.runFailed'));
      setBusy(false);
    }
  }, [workflowId, plan, runId, folder, skipApprovals]);

  return (
    <aside className="workflow-drawer" role="dialog" aria-label={name} data-workflow-id={workflowId}>
      <header className="workflow-drawer-head">
        <h2 className="workflow-drawer-title">{name}</h2>
        <button
          type="button"
          className="workflow-drawer-close"
          onClick={onClose}
          aria-label={message('shell.close')}
        >
          ×
        </button>
      </header>
      {description ? <p className="workflow-drawer-hint">{description}</p> : null}

      <form className="workflow-form" onSubmit={(event) => event.preventDefault()}>
        <label className="workflow-field" htmlFor="workflow-folder">
          <span className="workflow-field-label">{message('workflows.folderLabel')}</span>
          <input
            id="workflow-folder"
            type="text"
            className="workflow-field-input"
            data-widget="folder"
            placeholder={message('workflows.folderPlaceholder')}
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          />
        </label>
        {fields.map((field) => (
          <div key={field.name} className="workflow-field-slot">
            <Field
              field={field}
              value={values[field.name]}
              onChange={(next) => {
                setRefusal((current) => (current?.input === field.name ? undefined : current));
                setValues((current) => ({ ...current, [field.name]: next }));
              }}
            />
            {refusal?.input === field.name ? (
              <p className="workflow-field-refusal" role="alert" data-testid={`wf-refusal-${field.name}`}>
                {refusal.reason}
              </p>
            ) : null}
          </div>
        ))}
      </form>

      {error ? (
        <p className="workflow-drawer-error" role="alert">
          {error}
        </p>
      ) : null}

      {plan === null ? (
        <button
          type="button"
          className="workflow-plan-button"
          disabled={busy || missing.length > 0}
          onClick={() => void requestPlan()}
        >
          {message('workflows.planPreview')}
        </button>
      ) : (
        <div className="workflow-plan">
          <PlanChecklist plan={plan} />
          <p className="workflow-plan-total">
            {message('workflows.total')}{' '}
            <span className="workflow-plan-total-amount">{totalLabel(plan)}</span>
            <span className="workflow-plan-eta">{etaLabel(plan)}</span>
          </p>
          <label className="workflow-skip-approvals" htmlFor="workflow-skip-approvals">
            <input
              id="workflow-skip-approvals"
              type="checkbox"
              checked={skipApprovals}
              onChange={(event) => setSkipApprovals(event.target.checked)}
            />
            <span>{message('workflows.skipApprovals')}</span>
          </label>
          <button
            type="button"
            className="workflow-approve-button"
            disabled={busy}
            onClick={() => void approve()}
          >
            {message('workflows.approveTotal').replace('{total}', totalLabel(plan))}
          </button>
        </div>
      )}
    </aside>
  );
}
