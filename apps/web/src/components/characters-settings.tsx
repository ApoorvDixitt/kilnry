'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Settings › Characters (F-CHR-12, PRD-07 §13): the opt-in "Consistency check
// (local, free)". Off by default. Turning it on the first time downloads the
// face models and runtime to ~/.kilnry/models with a progress line and a
// checksum check (O-03); after that, scoring runs on this machine only.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

interface Status {
  enabled: boolean;
  installed: boolean;
  download_bytes: number;
  progress: {
    phase: 'idle' | 'downloading' | 'installed' | 'failed';
    received: number;
    total: number;
    error?: string;
  };
}

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function CharactersSettings(): React.ReactNode {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const load = useCallback(async (): Promise<Status> => {
    const response = await fetch('/api/settings/consistency');
    const body = (await response.json()) as Status & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? message('settings.characters.failed'));
    setStatus(body);
    return body;
  }, []);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : message('settings.characters.failed')),
    );
  }, [load]);

  // Follow the download until it finishes or fails.
  const downloading = status?.progress.phase === 'downloading';
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => {
      void load().catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : message('settings.characters.failed')),
      );
    }, 500);
    return () => clearInterval(timer);
  }, [downloading, load]);

  async function change(enabled: boolean): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const response = await apiFetch('/api/settings/consistency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const body = (await response.json()) as Status & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? message('settings.characters.failed'));
      setStatus(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.characters.failed'));
    } finally {
      setPending(false);
    }
  }

  const size = formatMegabytes(status?.download_bytes ?? 0);
  return (
    <section className="settings-panel characters-settings">
      <h2>{message('settings.characters.title')}</h2>
      <div className="consistency-setting">
        <div className="consistency-setting-head">
          <h3 id="consistency-title">{message('settings.characters.consistencyTitle')}</h3>
          {status?.enabled ? (
            <button
              type="button"
              role="switch"
              aria-checked="true"
              aria-labelledby="consistency-title"
              className="consistency-switch is-on"
              disabled={pending}
              onClick={() => void change(false)}
            >
              {message('settings.characters.on')}
            </button>
          ) : null}
        </div>
        <p>{message('settings.characters.consistencyBody')}</p>
        <p className="consistency-note">{message('settings.characters.faceOnly')}</p>

        {status && !status.enabled && !downloading ? (
          <div className="consistency-enable">
            <button
              type="button"
              className="btn primary consistency-enable-button"
              disabled={pending}
              onClick={() => void change(true)}
            >
              {message('settings.characters.enable')}
            </button>
            <p className="consistency-size">
              {status.installed
                ? message('settings.characters.alreadyDownloaded')
                : message('settings.characters.downloadSize').replace('{size}', size)}
            </p>
          </div>
        ) : null}

        {downloading && status ? (
          <p className="consistency-progress" role="status">
            {message('settings.characters.downloading')
              .replace('{received}', formatMegabytes(status.progress.received))
              .replace('{total}', formatMegabytes(status.progress.total))}
          </p>
        ) : null}

        {status?.enabled ? (
          <p className="consistency-ready" role="status">
            {message('settings.characters.ready')}
          </p>
        ) : null}

        {status?.progress.phase === 'failed' ? (
          <p className="form-error" role="alert">
            {status.progress.error ?? message('settings.characters.failed')}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
