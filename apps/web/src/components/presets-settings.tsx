'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Settings › Presets tab (F-SET-06, PRD-16 §6). It lists every installed
// preset with an enable toggle — a disabled preset is hidden from the Create
// grid — and imports a preset from a URL through the existing import route.

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

interface PresetRow {
  id: string;
  name: string;
  category: string;
  description: string;
  enabled: boolean;
  user_disabled?: boolean;
  issue?: string;
  source: string;
}

export function PresetsSettings(): React.ReactNode {
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  function refresh(): void {
    // ?all=1 includes disabled presets so they can be re-enabled here.
    void fetch('/api/presets?all=1')
      .then((response) => (response.ok ? (response.json() as Promise<{ presets: PresetRow[] }>) : null))
      .then((body) => {
        if (body) setPresets(body.presets);
      });
  }

  useEffect(refresh, []);

  async function toggle(preset: PresetRow): Promise<void> {
    setPending(true);
    try {
      // A preset is on unless the owner disabled it; toggling flips that.
      const nextEnabled = preset.user_disabled === true;
      await apiFetch(`/api/presets/${encodeURIComponent(preset.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      refresh();
    } finally {
      setPending(false);
    }
  }

  async function importFromUrl(): Promise<void> {
    if (url.trim() === '') return;
    setPending(true);
    setStatus('');
    try {
      const response = await apiFetch('/api/presets/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { message?: string };
      };
      if (response.ok && body.ok !== false) {
        setUrl('');
        setStatus(message('settings.presetsTab.imported'));
        refresh();
      } else {
        setStatus(body.error?.message ?? message('settings.presetsTab.importFailed'));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="settings-panel" aria-label={message('settings.presetsTab.title')}>
      <h2>{message('settings.presetsTab.title')}</h2>
      <p className="settings-hint">{message('settings.presetsTab.intro')}</p>

      <div className="presets-import">
        <label htmlFor="preset-url">{message('settings.presetsTab.importLabel')}</label>
        <div className="presets-import-row">
          <input
            id="preset-url"
            type="url"
            value={url}
            placeholder={message('settings.presetsTab.importPlaceholder')}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button type="button" onClick={() => void importFromUrl()} disabled={pending || url.trim() === ''}>
            {message('settings.presetsTab.import')}
          </button>
        </div>
        {status !== '' ? <p className="settings-status">{status}</p> : null}
      </div>

      {presets.length === 0 ? (
        <p className="settings-empty">{message('settings.presetsTab.empty')}</p>
      ) : (
        <ul className="presets-list">
          {presets.map((preset) => (
            <li key={preset.id} className="presets-row" data-preset-id={preset.id}>
              <div className="presets-row-main">
                <span className="presets-name">{preset.name}</span>
                <span className="presets-category">{preset.category}</span>
                {preset.issue ? (
                  <span className="presets-invalid">{message('settings.presetsTab.invalid')}</span>
                ) : null}
              </div>
              <p className="presets-description">{preset.description}</p>
              <label className="presets-toggle">
                <input
                  type="checkbox"
                  checked={preset.user_disabled !== true}
                  disabled={pending}
                  onChange={() => void toggle(preset)}
                />
                <span>{message('settings.presetsTab.enabled')}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
