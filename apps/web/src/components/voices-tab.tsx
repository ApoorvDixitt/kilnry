'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useEffect, useMemo, useState } from 'react';
import { message } from '../lib/messages';
import { VOICE_FILTER_PROVIDERS, filterVoiceRows, type VoiceRow } from './voices-tab-logic';

export function VoicesTab(): React.ReactNode {
  const [rows, setRows] = useState<VoiceRow[] | null>(null);
  const [provider, setProvider] = useState('');
  const [note, setNote] = useState<string>();

  useEffect(() => {
    void fetch('/api/voices')
      .then((response) => response.json() as Promise<{ voices: VoiceRow[] }>)
      .then((body) => setRows(body.voices))
      .catch(() => setRows([]));
  }, []);

  const visible = useMemo(() => (rows ? filterVoiceRows(rows, provider, '') : []), [rows, provider]);

  return (
    <div className="voices-tab" data-testid="voices-tab">
      <div className="characters-filters">
        <label className="characters-sort">
          {message('characters.voices.filterProvider')}
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="">{message('characters.voices.allProviders')}</option>
            {VOICE_FILTER_PROVIDERS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows && visible.length === 0 ? (
        <p className="muted voices-empty">{message('characters.voices.empty')}</p>
      ) : (
        <table className="voices-table">
          <thead>
            <tr>
              <th aria-label={message('characters.voices.play')} />
              <th>{message('characters.voices.colName')}</th>
              <th>{message('characters.voices.colProvider')}</th>
              <th>{message('characters.voices.colLanguage')}</th>
              <th>{message('characters.voices.colGender')}</th>
              <th>{message('characters.voices.colTags')}</th>
              <th>{message('characters.voices.colPrice')}</th>
              <th>{message('characters.voices.colType')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((voice) => (
              <tr key={`${voice.provider}:${voice.voice_id}`} data-testid="voice-row">
                <td>
                  <button
                    type="button"
                    className="voices-play"
                    aria-label={message('characters.voices.play')}
                    title={message('characters.voices.previewUnavailable')}
                    onClick={() => setNote(message('characters.voices.previewUnavailable'))}
                  >
                    ▶
                  </button>
                </td>
                <td>{voice.name}</td>
                <td>{voice.provider}</td>
                <td>{voice.language}</td>
                <td>{voice.gender}</td>
                <td className="voices-tags">
                  {voice.tags.map((tag) => (
                    <span key={tag} className="character-tag">
                      {tag}
                    </span>
                  ))}
                </td>
                <td data-money="true">{voice.price_label}</td>
                <td>
                  {voice.is_clone
                    ? message('characters.voices.typeClone')
                    : message('characters.voices.typePreset')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note ? (
        <p className="muted voices-note" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}
