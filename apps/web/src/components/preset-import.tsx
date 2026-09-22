// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// Adding a preset (F-PRE-04). A dropped file or a pasted address is checked and
// shown before anything is written, so an unreadable file says what is wrong
// instead of appearing as a broken card, and an address is only fetched when the
// user asks for it. When the identifier is already installed the dialog asks
// whether to replace it or keep both rather than deciding for the user.

import { useState } from 'react';
import { message } from '../lib/messages';
import { apiFetch } from '../lib/api-client';

export interface ImportIssue {
  level: string;
  rule: string;
  message: string;
  path?: string;
}

export interface ImportPreview {
  id: string;
  name: string;
  category: string;
  description: string;
  kind: string;
  model: string;
  indicative_cost_usd?: number;
  slots: Array<{ name: string; type: string; label: string; required: boolean }>;
  prompt: string;
  license: string;
  author?: string;
}

export interface ImportResult {
  valid: boolean;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  collides?: boolean;
  preset?: ImportPreview;
  added?: string;
}

/** How an issue reads in the dialog: the rule it broke, then what to fix. */
export function issueLine(issue: ImportIssue): string {
  return issue.path === undefined || issue.path === ''
    ? `${issue.rule}: ${issue.message}`
    : `${issue.rule} at ${issue.path}: ${issue.message}`;
}

/** Whether the Add button may be pressed. */
export function canAdd(result: ImportResult | null): boolean {
  return result !== null && result.valid && result.errors.length === 0 && result.added === undefined;
}

/** Whether the dialog must ask about a name that is already taken. */
export function mustChoose(result: ImportResult | null): boolean {
  return canAdd(result) && result?.collides === true;
}

const copy = {
  title: message('presets.importTitle'),
  dropHint: message('presets.importDropHint'),
  urlLabel: message('presets.importUrlLabel'),
  urlPlaceholder: message('presets.importUrlPlaceholder'),
  fetch: message('presets.importFetch'),
  add: message('presets.importAdd'),
  replace: message('presets.importReplace'),
  keepBoth: message('presets.importKeepBoth'),
  cancel: message('presets.importCancel'),
  invalid: message('presets.importInvalid'),
  schema: message('presets.importSchema'),
  collides: message('presets.importCollides'),
  added: message('presets.importAdded'),
  failed: message('presets.importFailed'),
  folder: message('presets.importFolder'),
};

async function post(body: Record<string, unknown>): Promise<ImportResult> {
  const response = await apiFetch('/api/presets/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(copy.failed);
  return (await response.json()) as ImportResult;
}

export function PresetImport({
  presetsPath,
  onAdded,
}: {
  presetsPath?: string;
  onAdded?: () => void;
}): React.ReactNode {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [over, setOver] = useState(false);

  async function preview(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      setResult(await post({ action: 'preview', ...body }));
    } catch {
      setFailure(copy.failed);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  async function add(onCollision: 'replace' | 'keep_both'): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      const body: Record<string, unknown> = { action: 'add', on_collision: onCollision };
      if (text !== undefined) body.json = text;
      else body.url = url;
      const added = await post(body);
      setResult(added);
      if (added.added !== undefined) onAdded?.();
    } catch {
      setFailure(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  async function onDrop(event: React.DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const contents = await file.text();
    setText(contents);
    setUrl('');
    await preview({ json: contents });
  }

  return (
    <section className="preset-import" aria-label={copy.title}>
      <div
        className={`preset-import-drop${over ? ' is-over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => void onDrop(event)}
      >
        <p className="preset-import-hint">{copy.dropHint}</p>
        <div className="preset-import-url">
          <input
            type="url"
            className="preset-field-control"
            aria-label={copy.urlLabel}
            placeholder={copy.urlPlaceholder}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setText(undefined);
            }}
          />
          <button
            type="button"
            className="preset-secondary-button"
            disabled={busy || !url.startsWith('https://')}
            onClick={() => void preview({ url })}
          >
            {copy.fetch}
          </button>
        </div>
        {presetsPath === undefined ? null : (
          <p className="preset-import-folder">{copy.folder.replace('{path}', presetsPath)}</p>
        )}
      </div>

      {failure === undefined ? null : (
        <p className="preset-import-error" role="alert">
          {failure}
        </p>
      )}

      {result === null ? null : result.added !== undefined ? (
        <p className="preset-import-added" role="status">
          {copy.added.replace('{id}', result.added)}
        </p>
      ) : !result.valid || result.errors.length > 0 ? (
        <div className="preset-import-invalid" role="alert">
          <p className="preset-import-error">{copy.invalid}</p>
          <ul className="preset-import-issues">
            {result.errors.map((issue) => (
              <li key={`${issue.rule}-${issue.message}`}>{issueLine(issue)}</li>
            ))}
          </ul>
          <a className="preset-import-schema" href="https://docs.kilnry.app/schemas/preset-1.json">
            {copy.schema}
          </a>
        </div>
      ) : (
        <div className="preset-import-preview">
          <h3 className="preset-import-name">{result.preset?.name}</h3>
          <p className="preset-import-meta">{`${result.preset?.category} · ${result.preset?.model}`}</p>
          <p className="preset-import-meta">{result.preset?.description}</p>
          <p className="preset-import-slots">
            {(result.preset?.slots ?? []).map((slot) => slot.label).join(' · ')}
          </p>
          <pre className="preset-import-prompt">{result.preset?.prompt}</pre>
          {result.warnings.map((issue) => (
            <p className="preset-import-warning" key={`${issue.rule}-${issue.message}`}>
              {issueLine(issue)}
            </p>
          ))}
          {mustChoose(result) ? (
            <>
              <p className="preset-import-warning">
                {copy.collides.replace('{id}', result.preset?.id ?? '')}
              </p>
              <div className="preset-import-actions">
                <button
                  type="button"
                  className="preset-secondary-button"
                  disabled={busy}
                  onClick={() => void add('replace')}
                >
                  {copy.replace}
                </button>
                <button
                  type="button"
                  className="preset-secondary-button"
                  disabled={busy}
                  onClick={() => void add('keep_both')}
                >
                  {copy.keepBoth}
                </button>
              </div>
            </>
          ) : (
            <div className="preset-import-actions">
              <button
                type="button"
                className="preset-secondary-button"
                disabled={busy || !canAdd(result)}
                onClick={() => void add('replace')}
              >
                {copy.add}
              </button>
              <button type="button" className="preset-secondary-button" onClick={() => setResult(null)}>
                {copy.cancel}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
