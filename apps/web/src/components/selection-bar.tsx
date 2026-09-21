'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { RotateCcw, Trash2, X } from 'lucide-react';
import { message } from '../lib/messages';

const LABELS: Array<{ value: string; token: string }> = [
  { value: 'red', token: 'var(--danger)' },
  { value: 'amber', token: 'var(--warning)' },
  { value: 'green', token: 'var(--success)' },
  { value: 'blue', token: 'var(--info)' },
];

export function SelectionBar({
  count,
  inTrash,
  onDelete,
  onRestore,
  onClear,
  onTag,
  onLabel,
  onExport,
}: {
  count: number;
  inTrash: boolean;
  onDelete: () => void;
  onRestore: () => void;
  onClear: () => void;
  onTag?: (tag: string) => void;
  onLabel?: (label: string | null) => void;
  onExport?: () => void;
}): React.ReactNode {
  if (count === 0) return null;
  return (
    <div
      className="selection-bar"
      role="toolbar"
      aria-label={message('library.selection.count').replace('{n}', String(count))}
    >
      <span className="selection-count">
        {message('library.selection.count').replace('{n}', String(count))}
      </span>
      <span className="selection-spacer" />
      {!inTrash && onTag ? (
        <button
          type="button"
          onClick={() => {
            const tag = window.prompt(message('library.selection.tagPrompt'))?.trim().toLowerCase();
            if (tag && /^[a-z0-9_-]{1,32}$/.test(tag)) onTag(tag);
          }}
        >
          {message('library.selection.tag')}
        </button>
      ) : null}
      {!inTrash && onLabel
        ? LABELS.map((label) => (
            <button
              key={label.value}
              type="button"
              className="selection-label-dot"
              style={{ color: label.token }}
              aria-label={`${message('library.selection.label')} ${label.value}`}
              title={label.value}
              onClick={() => onLabel(label.value)}
            >
              ●
            </button>
          ))
        : null}
      {!inTrash && onExport ? (
        <button type="button" onClick={onExport}>
          {message('library.selection.export')}
        </button>
      ) : null}
      {inTrash ? (
        <button type="button" onClick={onRestore}>
          <RotateCcw aria-hidden size={14} strokeWidth={1.75} />
          {message('library.selection.restore')}
        </button>
      ) : (
        <button type="button" className="selection-danger" onClick={onDelete}>
          <Trash2 aria-hidden size={14} strokeWidth={1.75} />
          {message('library.selection.delete')}
        </button>
      )}
      <button
        type="button"
        className="selection-clear"
        aria-label={message('library.selection.clear')}
        onClick={onClear}
      >
        <X aria-hidden size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
