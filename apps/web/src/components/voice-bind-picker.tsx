'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Voice-tab control that binds an existing provider-preset voice (or a stored
// clone) to a Character (F-CHR-08). It lists the voices from GET /api/voices and
// binds the chosen one through the manage route's bind action. It is its own
// component so it can be rendered and driven in a browser test without the rest
// of the Character detail screen.

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

interface VoiceOption {
  provider: string;
  voice_id: string;
  name: string;
}

export function VoiceBindPicker({
  handle,
  onBound,
}: {
  handle: string;
  onBound?: (item: unknown) => void;
}): React.ReactNode {
  const [options, setOptions] = useState<VoiceOption[]>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    void fetch('/api/voices')
      .then((response) => (response.ok ? (response.json() as Promise<{ voices?: VoiceOption[] }>) : null))
      .then((body) => setOptions(body?.voices ?? []))
      .catch(() => setOptions([]));
  }, []);

  function bind(): void {
    if (selected === '') return;
    const [provider, ...rest] = selected.split(':');
    const voiceId = rest.join(':');
    const option = options.find((v) => v.provider === provider && v.voice_id === voiceId);
    void apiFetch('/api/voices/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'bind',
        handle,
        preset_provider: provider,
        preset_voice_id: voiceId,
        ...(option ? { preset_name: option.name } : {}),
      }),
    })
      .then((response) => (response.ok ? (response.json() as Promise<{ item?: unknown }>) : null))
      .then((body) => {
        if (body?.item) onBound?.(body.item);
      })
      .catch(() => undefined);
  }

  return (
    <div className="character-voice-picker">
      <label>
        {message('characters.detail.bindPreset')}
        <select
          className="character-voice-select"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">{message('characters.detail.bindPresetPlaceholder')}</option>
          {options.map((voice) => (
            <option key={`${voice.provider}:${voice.voice_id}`} value={`${voice.provider}:${voice.voice_id}`}>
              {voice.name} · {voice.provider}
            </option>
          ))}
        </select>
      </label>
      <button className="btn character-voice-bind" type="button" disabled={selected === ''} onClick={bind}>
        {message('characters.detail.bind')}
      </button>
    </div>
  );
}
