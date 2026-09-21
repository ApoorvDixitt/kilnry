// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The @ picker a preset drawer shows for a character or element slot (F-PRE-02).
// It reuses the composer's mention endpoint (F-CRE-02) so the same characters,
// props, environments and styles are offered in the same order, and it restricts
// the list to the kinds the slot declares (PRD-09 §2: "@ picker restricted to
// kind"). The slot's value is one @handle, never a free-typed identifier.

import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from '../lib/messages';
import type { MentionSuggestion } from './composer-mentions-logic';

// The kinds the mention endpoint understands. A slot that names no kinds asks for
// a character by default, matching the composer's own picker.
const DEFAULT_KINDS = ['character'];

export function PresetSlotPicker({
  id,
  value,
  kinds,
  placeholder,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  value: string;
  kinds?: string[];
  placeholder: string;
  invalid: boolean;
  describedBy?: string;
  onChange: (handle: string) => void;
}): React.ReactNode {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const kindList = kinds && kinds.length > 0 ? kinds : DEFAULT_KINDS;
  const kindParam = kindList.join(',');

  const refresh = useCallback(
    (text: string) => {
      const params = new URLSearchParams({ q: text, kinds: kindParam, limit: '8' });
      void fetch(`/api/characters/mentions?${params.toString()}`)
        .then((response) =>
          response.ok ? (response.json() as Promise<{ items: MentionSuggestion[] }>) : null,
        )
        .then((body) => setSuggestions(body?.items ?? []))
        .catch(() => setSuggestions([]));
    },
    [kindParam],
  );

  useEffect(() => {
    if (!open) return;
    refresh(query);
  }, [open, query, refresh]);

  // A click outside the picker closes the suggestion list.
  useEffect(() => {
    function onDocumentClick(event: MouseEvent): void {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  function accept(handle: string): void {
    onChange(`@${handle}`);
    setOpen(false);
    setQuery('');
  }

  function clear(): void {
    onChange('');
    setOpen(true);
  }

  return (
    <div className="preset-slot-picker" ref={box}>
      {value ? (
        <span className="preset-slot-chip">
          <span className="preset-slot-chip-handle">{value}</span>
          <button
            type="button"
            className="preset-slot-chip-clear"
            aria-label={message('presets.pickClear')}
            onClick={clear}
          >
            ×
          </button>
        </span>
      ) : (
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          aria-autocomplete="list"
          aria-describedby={describedBy}
          className="preset-field-control"
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
      )}
      {open && !value && suggestions.length > 0 ? (
        <ul className="preset-slot-suggestions" role="listbox">
          {suggestions.map((item) => (
            <li key={`${item.handle}-${item.version}`} role="option" aria-selected={false}>
              <button type="button" className="preset-slot-suggestion" onClick={() => accept(item.handle)}>
                <span className="preset-slot-suggestion-name">{item.display_name}</span>
                <span className="preset-slot-suggestion-handle">@{item.handle}</span>
                <span className="preset-slot-suggestion-kind">{item.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
