'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useState } from 'react';
import { Database } from 'lucide-react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

export function WorkspaceSettings({ libraryRoot }: { libraryRoot: string }): React.ReactNode {
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  async function reindex(): Promise<void> {
    setStatus(message('settings.workspace.reindexing'));
    setError(undefined);
    try {
      const response = await apiFetch('/api/library/reindex', { method: 'POST' });
      const body = (await response.json()) as {
        report?: { indexed: number; recovered_from_embedded: number };
        error?: { message?: string };
      };
      if (!response.ok || !body.report)
        throw new Error(body.error?.message ?? message('settings.workspace.reindexFailed'));
      setStatus(
        message('settings.workspace.reindexDone')
          .replace('{count}', String(body.report.indexed))
          .replace('{recovered}', String(body.report.recovered_from_embedded)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.workspace.reindexFailed'));
      setStatus(undefined);
    }
  }

  return (
    <div className="settings-content">
      <header className="settings-heading">
        <p>{message('settings.workspace.eyebrow')}</p>
        <h2>{message('settings.workspace.title')}</h2>
        <span>{message('settings.workspace.subtitle')}</span>
      </header>
      <section className="workspace-card">
        <Database size={22} />
        <div>
          <h3>{message('settings.workspace.libraryTitle')}</h3>
          <code>{libraryRoot}</code>
          <p>{message('settings.workspace.libraryBody')}</p>
          <button
            type="button"
            onClick={() => void reindex()}
            disabled={status === message('settings.workspace.reindexing')}
          >
            {message('settings.workspace.reindex')}
          </button>
          {status ? <span className="form-success">{status}</span> : null}
          {error ? <span className="form-error">{error}</span> : null}
        </div>
      </section>
    </div>
  );
}
