// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The Library toolbar's "Import folder…" (PRD-06 §2, F-ONB-07). It used to
// re-index the folder already shown, so a folder of renders kept anywhere else
// had no way in (F-125). The dialog takes a path on this computer, the Library
// folder to put it in, and copy or move; a folder already inside the Library is
// indexed where it is.

import { useId, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

export interface PathImportReport {
  imported: number;
  duplicates?: number;
  destination?: string;
  mode?: 'in_place' | 'copy' | 'move';
  errors?: Array<{ path: string; message: string }>;
}

/** The status line after an import: where the files went, and any skipped duplicates. */
export function importSummary(report: PathImportReport): string {
  const lines = [
    message('library.importedInto')
      .replace('{n}', String(report.imported))
      .replace('{folder}', report.destination || 'the Library'),
  ];
  if (report.duplicates && report.duplicates > 0) {
    lines.push(message('library.importDuplicates').replace('{n}', String(report.duplicates)));
  }
  return lines.join(' ');
}

export function ImportFolderDialog({
  defaultInto,
  onDone,
  onClose,
}: {
  defaultInto: string;
  onDone: (summary: string) => void;
  onClose: () => void;
}): React.ReactNode {
  const id = useId();
  const [source, setSource] = useState('');
  const [into, setInto] = useState(defaultInto || 'inbox');
  const [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function run(): Promise<void> {
    setPending(true);
    setError('');
    try {
      const response = await apiFetch('/api/library/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: source.trim(), into: into.trim() || 'inbox', mode }),
      });
      const body = (await response.json()) as { report?: PathImportReport; error?: { message?: string } };
      if (!response.ok || !body.report)
        throw new Error(body.error?.message ?? message('library.unreachableTitle'));
      onDone(importSummary(body.report));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('library.unreachableTitle'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="import-folder-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <h2 id={`${id}-title`}>{message('library.importDialogTitle')}</h2>
        <label htmlFor={`${id}-source`}>{message('library.importSource')}</label>
        <input
          id={`${id}-source`}
          autoFocus
          value={source}
          onChange={(event) => setSource(event.target.value)}
          aria-describedby={`${id}-help`}
        />
        <small id={`${id}-help`}>{message('library.importSourceHelp')}</small>
        <label htmlFor={`${id}-into`}>{message('library.importInto')}</label>
        <input id={`${id}-into`} value={into} onChange={(event) => setInto(event.target.value)} />
        <fieldset>
          <label>
            <input
              type="radio"
              name={`${id}-mode`}
              checked={mode === 'copy'}
              onChange={() => setMode('copy')}
            />
            {message('library.importCopy')}
          </label>
          <label>
            <input
              type="radio"
              name={`${id}-mode`}
              checked={mode === 'move'}
              onChange={() => setMode('move')}
            />
            {message('library.importMove')}
          </label>
        </fieldset>
        {error ? (
          <p className="import-folder-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="import-folder-actions">
          <button type="button" onClick={onClose}>
            {message('library.importCancel')}
          </button>
          <button type="submit" className="btn primary" disabled={pending || source.trim() === ''}>
            {message('library.importRun')}
          </button>
        </div>
      </form>
    </div>
  );
}
