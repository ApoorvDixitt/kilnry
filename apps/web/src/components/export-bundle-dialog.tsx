// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The export bundle dialog (F-LIB-14, PRD-06 §15). It offers the format, sidecar,
// metadata, provenance-label, lineage, manifest and rename options, then posts to
// the export route which writes stripped or labelled copies into the bundle and
// never modifies the originals.

import { useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import {
  defaultExportState,
  exportRequest,
  showsC2paNote,
  type ExportDialogState,
} from './export-bundle-logic';

export function ExportBundleDialog({
  assetIds,
  onClose,
}: {
  assetIds: string[];
  onClose: () => void;
}): React.ReactNode {
  const [state, setState] = useState<ExportDialogState>(defaultExportState());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  const [error, setError] = useState<string>();

  function set<K extends keyof ExportDialogState>(key: K, value: ExportDialogState[K]): void {
    setState((prior) => ({ ...prior, [key]: value }));
  }

  function run(): void {
    if (busy || assetIds.length === 0) return;
    setBusy(true);
    setError(undefined);
    void apiFetch('/api/library/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exportRequest(assetIds, state)),
    })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((body: { error?: { message?: string } }) => {
              throw new Error(body.error?.message ?? message('library.export.failed'));
            }),
      )
      .then((body: { bundle: { bundle_path: string } }) => setDone(body.bundle.bundle_path))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : message('library.export.failed')),
      )
      .finally(() => setBusy(false));
  }

  return (
    <aside className="export-dialog" role="dialog" aria-label={message('library.export.title')}>
      <header className="export-dialog-header">
        <h3>{message('library.export.title')}</h3>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {message('library.export.close')}
        </button>
      </header>

      <label className="export-field">
        {message('library.export.format')}
        <select value={state.format} onChange={(event) => set('format', event.target.value as never)}>
          <option value="zip">{message('library.export.formatZip')}</option>
          <option value="folder">{message('library.export.formatFolder')}</option>
        </select>
      </label>

      <label className="export-field">
        {message('library.export.metadata')}
        <select value={state.metadata} onChange={(event) => set('metadata', event.target.value as never)}>
          <option value="keep">{message('library.export.metadataKeep')}</option>
          <option value="strip">{message('library.export.metadataStrip')}</option>
          <option value="embed_if_missing">{message('library.export.metadataEmbed')}</option>
        </select>
      </label>

      <label className="export-field">
        {message('library.export.provenance')}
        <select value={state.provenance} onChange={(event) => set('provenance', event.target.value as never)}>
          <option value="none">{message('library.export.provNone')}</option>
          <option value="iptc">{message('library.export.provIptc')}</option>
          <option value="c2pa">{message('library.export.provC2pa')}</option>
          <option value="both">{message('library.export.provBoth')}</option>
        </select>
      </label>
      {showsC2paNote(state.provenance) ? (
        <p className="export-note">{message('library.export.c2paNote')}</p>
      ) : null}

      <label className="export-check">
        <input
          type="checkbox"
          checked={state.include_sidecars}
          onChange={(event) => set('include_sidecars', event.target.checked)}
        />
        {message('library.export.sidecars')}
      </label>
      <label className="export-check">
        <input
          type="checkbox"
          checked={state.include_lineage}
          onChange={(event) => set('include_lineage', event.target.checked)}
        />
        {message('library.export.lineage')}
      </label>
      <label className="export-check">
        <input
          type="checkbox"
          checked={state.rename}
          onChange={(event) => set('rename', event.target.checked)}
        />
        {message('library.export.rename')}
      </label>

      {error ? (
        <p className="characters-error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? <p className="export-done">{message('library.export.done').replace('{path}', done)}</p> : null}

      <footer>
        <button className="btn primary" type="button" disabled={busy || assetIds.length === 0} onClick={run}>
          {busy ? message('library.export.exporting') : message('library.export.run')}
        </button>
      </footer>
    </aside>
  );
}
