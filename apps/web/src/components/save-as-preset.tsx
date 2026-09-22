// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// Save the composer as a preset (F-CRE-12). The dialog asks for a name and a
// category, then lists every attachment and every mention as a candidate slot.
// Ticking a mention rewrites the prompt scaffold in front of the user, so what
// the preset will render is visible before it is saved.

import { useMemo, useState } from 'react';
import { message } from '../lib/messages';
import { apiFetch } from '../lib/api-client';
import {
  buildPreset,
  canSave,
  candidatesFor,
  nextName,
  SAVE_CATEGORIES,
  scaffoldPrompt,
  uniqueNames,
  type SaveDraft,
  type SlotCandidate,
} from './save-as-preset-logic';

export interface ComposerSnapshot {
  prompt: string;
  model: string;
  kind: string;
  params: Record<string, unknown>;
  count: number;
  medias?: Array<{ role: string; asset_id?: string }>;
  /** A result from this session, offered as the card preview. */
  exampleAssetId?: string;
}

const copy = {
  title: message('presets.saveTitle'),
  name: message('presets.saveName'),
  category: message('presets.saveCategory'),
  description: message('presets.saveDescription'),
  model: message('presets.saveModel'),
  auto: message('presets.saveAuto'),
  slots: message('presets.saveSlots'),
  makeSlot: message('presets.saveMakeSlot'),
  slotName: message('presets.saveSlotName'),
  requiredLabel: message('presets.saveRequired'),
  scaffold: message('presets.saveScaffold'),
  example: message('presets.saveExample'),
  save: message('presets.saveAction'),
  cancel: message('presets.importCancel'),
  saved: message('presets.saveSaved'),
  openPresets: message('presets.saveOpenPresets'),
  failed: message('presets.saveFailed'),
};

export function SaveAsPreset({
  snapshot,
  author = 'me',
  onClose,
}: {
  snapshot: ComposerSnapshot;
  author?: string;
  onClose: () => void;
}): React.ReactNode {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('ugc');
  const [description, setDescription] = useState('');
  const [auto, setAuto] = useState(false);
  const [candidates, setCandidates] = useState<SlotCandidate[]>(() => candidatesFor(snapshot));
  const [useExample, setUseExample] = useState(snapshot.exampleAssetId !== undefined);
  const [scaffold, setScaffold] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<Array<{ rule: string; message: string }>>([]);
  const [saved, setSaved] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();

  // The scaffold follows the ticks until the user edits it by hand.
  const suggested = useMemo(() => scaffoldPrompt(snapshot.prompt, candidates), [snapshot.prompt, candidates]);
  const prompt = scaffold ?? suggested;

  const draft: SaveDraft = {
    name,
    category,
    description,
    kind: snapshot.kind,
    prompt,
    model: auto ? 'auto' : snapshot.model,
    ...(auto ? { model_hint: snapshot.model } : {}),
    params: snapshot.params,
    count: snapshot.count,
    candidates,
    ...(useExample && snapshot.exampleAssetId !== undefined
      ? { example_asset_id: snapshot.exampleAssetId }
      : {}),
  };

  function toggle(index: number, patch: Partial<SlotCandidate>): void {
    setCandidates((prior) =>
      uniqueNames(prior.map((candidate, at) => (at === index ? { ...candidate, ...patch } : candidate))),
    );
  }

  async function save(overwrite: boolean, saveName = name): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    setErrors([]);
    try {
      const response = await apiFetch('/api/presets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: buildPreset({ ...draft, name: saveName }, author), overwrite }),
      });
      if (!response.ok) throw new Error(copy.failed);
      const body = (await response.json()) as {
        saved: boolean;
        id?: string;
        collides?: boolean;
        errors: Array<{ rule: string; message: string }>;
      };
      if (body.saved) {
        setSaved(body.id);
        return;
      }
      if (body.collides === true) {
        // Offer the next free name rather than overwriting silently.
        const suggestion = nextName(saveName);
        setName(suggestion);
        setFailure(message('presets.saveCollides').replace('{name}', saveName).replace('{next}', suggestion));
        return;
      }
      setErrors(body.errors);
    } catch {
      setFailure(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="preset-save" role="dialog" aria-label={copy.title}>
      <header className="preset-drawer-header">
        <h2 className="preset-drawer-name">{copy.title}</h2>
        <button type="button" className="preset-drawer-close" onClick={onClose}>
          {copy.cancel}
        </button>
      </header>

      {saved === undefined ? (
        <>
          <div className="preset-field">
            <label className="preset-field-label" htmlFor="preset-save-name">
              {copy.name}
            </label>
            <input
              id="preset-save-name"
              className="preset-field-control"
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="preset-field">
            <label className="preset-field-label" htmlFor="preset-save-category">
              {copy.category}
            </label>
            <select
              id="preset-save-category"
              className="preset-field-control"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {SAVE_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="preset-field">
            <label className="preset-field-label" htmlFor="preset-save-description">
              {copy.description}
            </label>
            <textarea
              id="preset-save-description"
              className="preset-field-control"
              rows={2}
              maxLength={200}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="preset-field">
            <span className="preset-field-label">{copy.model}</span>
            <label className="preset-save-check">
              <input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} />
              {copy.auto.replace('{model}', snapshot.model)}
            </label>
          </div>

          {candidates.length === 0 ? null : (
            <section className="preset-drawer-section">
              <h3 className="preset-drawer-heading">{copy.slots}</h3>
              {candidates.map((candidate, index) => (
                <div className="preset-save-candidate" key={`${candidate.source}-${candidate.value}`}>
                  <label className="preset-save-check">
                    <input
                      type="checkbox"
                      checked={candidate.chosen}
                      aria-label={`${copy.makeSlot} ${candidate.value}`}
                      onChange={(event) => toggle(index, { chosen: event.target.checked })}
                    />
                    {candidate.source === 'mention' ? `@${candidate.value}` : candidate.value}
                  </label>
                  <input
                    className="preset-field-control preset-save-slot-name"
                    aria-label={`${copy.slotName} ${candidate.value}`}
                    value={candidate.name}
                    disabled={!candidate.chosen}
                    onChange={(event) => toggle(index, { name: event.target.value })}
                  />
                  <label className="preset-save-check">
                    <input
                      type="checkbox"
                      checked={candidate.required}
                      disabled={!candidate.chosen}
                      aria-label={`${copy.requiredLabel} ${candidate.value}`}
                      onChange={(event) => toggle(index, { required: event.target.checked })}
                    />
                    {copy.requiredLabel}
                  </label>
                </div>
              ))}
            </section>
          )}

          <div className="preset-field">
            <label className="preset-field-label" htmlFor="preset-save-scaffold">
              {copy.scaffold}
            </label>
            <textarea
              id="preset-save-scaffold"
              className="preset-field-control preset-save-scaffold"
              rows={4}
              value={prompt}
              onChange={(event) => setScaffold(event.target.value)}
            />
          </div>

          {snapshot.exampleAssetId === undefined ? null : (
            <label className="preset-save-check">
              <input
                type="checkbox"
                checked={useExample}
                onChange={(event) => setUseExample(event.target.checked)}
              />
              {copy.example}
            </label>
          )}

          {errors.map((issue) => (
            <p className="preset-import-error" role="alert" key={`${issue.rule}-${issue.message}`}>
              {`${issue.rule}: ${issue.message}`}
            </p>
          ))}
          {failure === undefined ? null : (
            <p className="preset-import-warning" role="alert">
              {failure}
            </p>
          )}

          <footer className="preset-drawer-actions">
            <button
              type="button"
              className="preset-secondary-button"
              disabled={busy || !canSave(draft)}
              onClick={() => void save(false)}
            >
              {copy.save}
            </button>
          </footer>
        </>
      ) : (
        <p className="preset-import-added" role="status">
          {copy.saved.replace('{id}', saved)} <a href="/presets">{copy.openPresets}</a>
        </p>
      )}
    </aside>
  );
}
