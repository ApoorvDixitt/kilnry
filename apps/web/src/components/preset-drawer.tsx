// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The preset use drawer (F-PRE-02). It asks for only what the preset declares,
// shows the exact price before anything is spent, and runs through the same
// estimate-then-generate path the composer uses, so a preset run is an ordinary
// job that happens to remember which preset it came from (D-26).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CostStrip, type BudgetLine, type CostEstimate } from './cost-strip';
import { AttachmentTray } from './attachment-tray';
import { assetIdFromDrag } from './chat-attachment-tray';
import { PresetSlotPicker } from './preset-slot-picker';
import { message } from '../lib/messages';
import { apiFetch } from '../lib/api-client';
import type { Attachment } from '../lib/attachments';
import {
  canChangeModel,
  canRun,
  initialValues,
  missingRequired,
  modelOptions,
  openInCreateQuery,
  paramsSummary,
  runPayload,
  slotRole,
  type DrawerPreset,
  type DrawerSlot,
  type SlotValues,
} from './preset-drawer-logic';

export interface ResolvedPreset {
  prompt: string;
  negative_prompt?: string;
  params: Record<string, unknown>;
  medias: Array<{ role: string; ref: string }>;
  count: number;
  characters: string[];
  missing: string[];
}

const copy = {
  close: message('presets.drawerClose'),
  licence: message('presets.licence'),
  author: message('presets.author'),
  inputs: message('presets.inputs'),
  required: message('presets.required'),
  model: message('presets.model'),
  change: message('presets.change'),
  auto: message('presets.modelAuto'),
  params: message('presets.params'),
  advanced: message('presets.advanced'),
  promptPreview: message('presets.promptPreview'),
  run: message('presets.run'),
  saveCopy: message('presets.saveCopy'),
  openInCreate: message('presets.openInCreate'),
  missingField: message('presets.missingField'),
  running: message('presets.running'),
  pickCharacter: message('presets.pickCharacter'),
};

function fieldId(slot: DrawerSlot): string {
  return `preset-slot-${slot.name}`;
}

/** One field, chosen by the slot type (PRD-09 §2 Inputs). */
export function SlotField({
  slot,
  value,
  invalid,
  onChange,
}: {
  slot: DrawerSlot;
  value: string | number | undefined;
  invalid: boolean;
  onChange: (next: string) => void;
}): React.ReactNode {
  const id = fieldId(slot);
  const describedBy = invalid ? `${id}-error` : undefined;
  const label = (
    <label className="preset-field-label" htmlFor={id}>
      {slot.label}
      {slot.required ? <span className="preset-field-required"> {copy.required}</span> : null}
    </label>
  );
  const help = slot.help === undefined ? null : <p className="preset-field-help">{slot.help}</p>;
  const error = invalid ? (
    <p className="preset-field-error" id={`${id}-error`} role="alert">
      {copy.missingField}
    </p>
  ) : null;

  // A media slot is filled through the attachment tray (PRD-09 §2: "attachment
  // tray with role"). An asset is dragged in from the Library or a public URL is
  // pasted; the tray holds at most one item for the slot's role and the slot's
  // stored value is that attachment's asset id, which is what the resolve and run
  // payloads expect. Adding a new attachment replaces the previous one.
  if (slot.type === 'media') {
    const role = slotRole(slot);
    const current = value === undefined ? '' : String(value);
    const attachments: Attachment[] =
      current === ''
        ? []
        : [
            {
              id: current,
              name: current,
              role,
              kind: 'image',
              pinned: false,
              assetId: current,
            },
          ];
    return (
      <div className={`preset-field${invalid ? ' is-invalid' : ''}`}>
        {label}
        <div
          className="preset-media-drop"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const dropped = assetIdFromDrag(event.dataTransfer);
            if (dropped !== undefined) onChange(dropped);
          }}
        >
          <AttachmentTray
            attachments={attachments}
            limits={[{ role, max: 1 }]}
            onChange={(next) => {
              const last = next[next.length - 1];
              onChange(last?.assetId ?? last?.id ?? '');
            }}
            onImportUrl={(url) => onChange(url)}
          />
        </div>
        {help}
        {error}
      </div>
    );
  }

  // A character or element slot is filled through the @ picker, restricted to the
  // kinds the slot declares (PRD-09 §2: "@ picker restricted to kind").
  if (slot.type === 'character') {
    return (
      <div className={`preset-field${invalid ? ' is-invalid' : ''}`}>
        {label}
        <PresetSlotPicker
          id={id}
          value={value === undefined ? '' : String(value)}
          {...(slot.kinds === undefined ? {} : { kinds: slot.kinds })}
          placeholder={copy.pickCharacter}
          invalid={invalid}
          {...(describedBy === undefined ? {} : { describedBy })}
          onChange={onChange}
        />
        {help}
        {error}
      </div>
    );
  }

  const shared = {
    id,
    'aria-invalid': invalid,
    'aria-describedby': describedBy,
    className: 'preset-field-control',
    value: value === undefined ? '' : String(value),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
  };
  return (
    <div className={`preset-field${invalid ? ' is-invalid' : ''}`}>
      {label}
      {slot.type === 'enum' ? (
        <select {...shared}>
          {(slot.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : slot.type === 'number' ? (
        <input
          {...shared}
          type="number"
          {...(slot.min === undefined ? {} : { min: slot.min })}
          {...(slot.max === undefined ? {} : { max: slot.max })}
        />
      ) : slot.type === 'color' ? (
        <input {...shared} type="color" />
      ) : (
        <textarea
          id={id}
          aria-invalid={invalid}
          className="preset-field-control"
          rows={2}
          value={value === undefined ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {help}
      {error}
    </div>
  );
}

export function PresetDrawer({
  preset,
  onClose,
  budgets = [],
  currentFolder,
}: {
  preset: DrawerPreset;
  onClose: () => void;
  budgets?: BudgetLine[];
  currentFolder?: string;
}): React.ReactNode {
  const [values, setValues] = useState<SlotValues>(() => initialValues(preset));
  // Undefined means the hints decide; a string means the user chose (F-PRE-06).
  const [model, setModel] = useState<string | undefined>(undefined);
  const [advanced, setAdvanced] = useState(false);
  const [resolved, setResolved] = useState<ResolvedPreset | null>(null);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [chosen, setChosen] = useState<{ model: string; reason: string } | null>(null);
  const [anchor, setAnchor] = useState(false);
  const [running, setRunning] = useState(false);
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [copying, setCopying] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const missing = useMemo(() => missingRequired(preset, values), [preset, values]);

  // The server resolves and prices; the drawer never templates or prices itself.
  const refresh = useCallback(
    (nextValues: SlotValues, nextModel: string | undefined) => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        void fetch(`/api/presets/${encodeURIComponent(preset.id)}/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: nextValues,
            ...(nextModel === undefined ? {} : { model: nextModel }),
          }),
        })
          .then((response) => (response.ok ? response.json() : null))
          .then(
            (
              body: {
                resolved?: ResolvedPreset;
                estimate?: CostEstimate | null;
                model?: { model: string; reason: string };
                anchor?: boolean;
              } | null,
            ) => {
              setResolved(body?.resolved ?? null);
              setEstimate(body?.estimate ?? null);
              setChosen(body?.model ?? null);
              setAnchor(body?.anchor === true);
            },
          )
          .catch(() => {
            setResolved(null);
            setEstimate(null);
          });
      }, 150);
    },
    [preset.id],
  );

  useEffect(() => {
    refresh(values, model);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [refresh, values, model]);

  function setSlot(name: string, next: string): void {
    setTouched(true);
    setValues((prior) => ({ ...prior, [name]: next }));
  }

  const overBudget =
    estimate !== null &&
    budgets.some(
      (line) => line.behavior === 'block' && line.cap_usd - line.spent_usd < estimate.estimate_usd,
    );
  const runnable = canRun(preset, values, { estimated: estimate !== null, running, overBudget });
  const priced = estimate === null ? undefined : (estimate.authoritative_usd ?? estimate.estimate_usd);
  // What the run will use: a locked preset keeps its model, otherwise the user's
  // choice, otherwise whatever the hints settled on.
  const effectiveModel = canChangeModel(preset)
    ? (model ?? chosen?.model ?? preset.model.id)
    : preset.model.id;

  async function run(): Promise<void> {
    if (!runnable || resolved === null || priced === undefined) return;
    setRunning(true);
    setFailure(undefined);
    try {
      const response = await apiFetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          runPayload({
            preset,
            model: effectiveModel,
            resolved,
            confirmedCostUsd: priced,
            clientRequestId: crypto.randomUUID(),
            ...(currentFolder === undefined ? {} : { currentFolder }),
          }),
        ),
      });
      if (!response.ok) throw new Error(message('presets.runFailed'));
      onClose();
    } catch {
      setFailure(message('presets.runFailed'));
    } finally {
      setRunning(false);
    }
  }

  // A copy is an ordinary user preset: the same file with a new identifier, so
  // it can be edited without touching the shipped one (F-CRE-12).
  async function saveCopy(): Promise<void> {
    setCopying(true);
    setFailure(undefined);
    try {
      const response = await fetch(`/api/presets/${encodeURIComponent(preset.id)}`);
      if (!response.ok) throw new Error(message('presets.saveFailed'));
      const body = (await response.json()) as { preset?: Record<string, unknown> };
      const source = body.preset;
      if (source === undefined) throw new Error(message('presets.saveFailed'));
      const id = `me.${preset.category}.${preset.id.split('.').pop() ?? 'copy'}`;
      const saved = await apiFetch('/api/presets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: { ...source, id, author: 'me' } }),
      });
      if (!saved.ok) throw new Error(message('presets.saveFailed'));
      const result = (await saved.json()) as { saved: boolean };
      if (!result.saved) setFailure(message('presets.saveFailed'));
    } catch {
      setFailure(message('presets.saveFailed'));
    } finally {
      setCopying(false);
    }
  }

  function openInCreate(): void {
    if (resolved === null) return;
    window.location.href = `/create?${openInCreateQuery({ preset, model: effectiveModel, resolved })}`;
  }

  return (
    <aside className="preset-drawer" role="dialog" aria-label={preset.name}>
      <header className="preset-drawer-header">
        <div>
          <h2 className="preset-drawer-name">{preset.name}</h2>
          <p className="preset-drawer-category">{preset.category}</p>
        </div>
        <button type="button" className="preset-drawer-close" onClick={onClose}>
          {copy.close}
        </button>
      </header>

      <p className="preset-drawer-description">{preset.description}</p>
      <p className="preset-drawer-credits">
        {preset.author === undefined ? null : (
          <span className="preset-drawer-author">{copy.author.replace('{author}', preset.author)}</span>
        )}
        <span className="preset-licence-chip">{copy.licence.replace('{licence}', preset.license)}</span>
      </p>

      <section className="preset-drawer-section">
        <h3 className="preset-drawer-heading">{copy.inputs}</h3>
        {anchor ? <p className="preset-anchor-note">{message('presets.anchorNote')}</p> : null}
        {preset.slots.map((slot) => (
          <SlotField
            key={slot.name}
            slot={slot}
            value={values[slot.name]}
            invalid={touched && missing.includes(slot.name)}
            onChange={(next) => setSlot(slot.name, next)}
          />
        ))}
      </section>

      <section className="preset-drawer-section">
        <h3 className="preset-drawer-heading">{copy.model}</h3>
        {canChangeModel(preset) ? (
          <select
            className="preset-field-control"
            aria-label={copy.change}
            value={effectiveModel}
            onChange={(event) => setModel(event.target.value)}
          >
            {modelOptions(preset).map((option) => (
              <option key={option} value={option}>
                {option === 'auto' ? copy.auto : option}
              </option>
            ))}
          </select>
        ) : (
          <span className="preset-model-chip">{effectiveModel}</span>
        )}
        {model === undefined && chosen !== null && chosen.reason !== 'primary' ? (
          <p className="preset-model-note">
            {chosen.reason === 'auto'
              ? message('presets.hintAuto')
              : message('presets.hintAlternate').replace('{model}', chosen.model)}
          </p>
        ) : null}
      </section>

      <section className="preset-drawer-section">
        <h3 className="preset-drawer-heading">{copy.params}</h3>
        <p className="preset-params-summary">
          {paramsSummary(resolved?.params ?? preset.params, resolved?.count ?? preset.count)}
        </p>
        <button
          type="button"
          className="preset-advanced-toggle"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          {copy.advanced}
        </button>
        {advanced ? (
          <div className="preset-advanced">
            <h4 className="preset-drawer-subheading">{copy.promptPreview}</h4>
            <pre className="preset-prompt-preview">{resolved?.prompt ?? ''}</pre>
            <pre className="preset-params-json">{JSON.stringify(resolved?.params ?? {}, null, 2)}</pre>
          </div>
        ) : null}
      </section>

      <div className="preset-drawer-cost">
        <CostStrip
          estimate={estimate}
          params={{
            count: resolved?.count ?? preset.count,
            duration_s:
              typeof resolved?.params.duration_s === 'number' ? resolved.params.duration_s : undefined,
          }}
          promptChars={(resolved?.prompt ?? '').length}
          budgets={budgets}
        />
      </div>

      {failure === undefined ? null : (
        <p className="preset-drawer-error" role="alert">
          {failure}
        </p>
      )}

      <footer className="preset-drawer-actions">
        <button type="button" className="preset-run-button" disabled={!runnable} onClick={() => void run()}>
          {running
            ? copy.running
            : copy.run.replace('{price}', priced === undefined ? '—' : `$${priced.toFixed(2)}`)}
        </button>
        <button type="button" className="preset-secondary-button" onClick={openInCreate}>
          {copy.openInCreate}
        </button>
        <button
          type="button"
          className="preset-secondary-button"
          disabled={copying}
          title={message('presets.saveCopy2')}
          onClick={() => void saveCopy()}
        >
          {copy.saveCopy}
        </button>
      </footer>
    </aside>
  );
}
