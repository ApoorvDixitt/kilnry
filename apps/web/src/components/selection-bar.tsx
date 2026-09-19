'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { RotateCcw, Trash2, X } from 'lucide-react';
import { message } from '../lib/messages';

export function SelectionBar({
  count,
  inTrash,
  onDelete,
  onRestore,
  onClear,
}: {
  count: number;
  inTrash: boolean;
  onDelete: () => void;
  onRestore: () => void;
  onClear: () => void;
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
