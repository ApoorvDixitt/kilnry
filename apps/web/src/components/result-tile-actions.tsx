'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import {
  Copy,
  FolderInput,
  FolderOpen,
  Pencil,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { message } from '../lib/messages';

export interface TileCapabilities {
  reveal: boolean;
}

export interface ResultTileActionHandlers {
  onUsePrompt?: () => void;
  onUseReference?: () => void;
  onOpenLibrary?: () => void;
  onRerun?: () => void;
  onCopyPath?: () => void;
  onCopyParams?: () => void;
  onReveal?: () => void;
  onMove?: () => void;
  onDelete?: () => void;
  onRetry?: () => void;
  onEditPrompt?: () => void;
  onCopyError?: () => void;
}

// Decide, for a re-run, whether the new price differs enough from the original to
// warrant an explicit confirmation (the design threshold is ten per cent).
export function rerunNeedsConfirm(originalUsd: number, nextUsd: number): boolean {
  if (originalUsd <= 0) return nextUsd > 0;
  return Math.abs(nextUsd - originalUsd) / originalUsd > 0.1;
}

export function ResultTileActions({
  status,
  capabilities,
  handlers,
}: {
  status: 'completed' | 'failed' | 'moderated';
  capabilities: TileCapabilities;
  handlers: ResultTileActionHandlers;
}): React.ReactNode {
  if (status === 'failed') {
    return (
      <div className="result-actions" role="group" aria-label={message('create.actions.row')}>
        <button type="button" onClick={handlers.onRetry}>
          <RotateCcw aria-hidden size={14} strokeWidth={1.75} />
          {message('create.actions.retry')}
        </button>
        <button type="button" onClick={handlers.onEditPrompt}>
          <Pencil aria-hidden size={14} strokeWidth={1.75} />
          {message('create.actions.editPrompt')}
        </button>
        <button type="button" onClick={handlers.onCopyError}>
          <TriangleAlert aria-hidden size={14} strokeWidth={1.75} />
          {message('create.actions.copyError')}
        </button>
      </div>
    );
  }

  return (
    <div className="result-actions" role="group" aria-label={message('create.actions.row')}>
      <button type="button" data-shortcut="u" onClick={handlers.onUsePrompt}>
        <Sparkles aria-hidden size={14} strokeWidth={1.75} />
        {message('create.actions.usePrompt')}
      </button>
      <button type="button" data-shortcut="f" onClick={handlers.onUseReference}>
        <Copy aria-hidden size={14} strokeWidth={1.75} />
        {message('create.actions.useReference')}
      </button>
      <button type="button" onClick={handlers.onOpenLibrary}>
        <FolderOpen aria-hidden size={14} strokeWidth={1.75} />
        {message('create.actions.openLibrary')}
      </button>
      <button type="button" data-shortcut="r" onClick={handlers.onRerun}>
        <RefreshCw aria-hidden size={14} strokeWidth={1.75} />
        {message('create.actions.rerun')}
      </button>
      <button type="button" onClick={handlers.onCopyPath}>
        <Copy aria-hidden size={14} strokeWidth={1.75} />
        {message('create.actions.copyPath')}
      </button>
      <button type="button" onClick={handlers.onCopyParams}>
        <Copy aria-hidden size={14} strokeWidth={1.75} />
        {message('create.actions.copyParams')}
      </button>
      {capabilities.reveal ? (
        <button type="button" onClick={handlers.onReveal}>
          <FolderOpen aria-hidden size={14} strokeWidth={1.75} />
          {message('create.actions.reveal')}
        </button>
      ) : null}
      <button type="button" onClick={handlers.onMove}>
        <FolderInput aria-hidden size={14} strokeWidth={1.75} />
        {message('create.actions.move')}
      </button>
      <button type="button" className="result-action-danger" onClick={handlers.onDelete}>
        <Trash2 aria-hidden size={14} strokeWidth={1.75} />
        {message('create.actions.delete')}
      </button>
    </div>
  );
}
