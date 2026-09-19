'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useState } from 'react';
import { FolderClosed, FolderPlus, Inbox, Trash2 } from 'lucide-react';
import { message } from '../lib/messages';

export interface FolderNode {
  name: string;
  path: string;
  pinned?: 'inbox' | 'trash';
}

function iconFor(node: FolderNode): React.ReactNode {
  if (node.pinned === 'inbox') return <Inbox aria-hidden size={15} strokeWidth={1.75} />;
  if (node.pinned === 'trash') return <Trash2 aria-hidden size={15} strokeWidth={1.75} />;
  return <FolderClosed aria-hidden size={15} strokeWidth={1.75} />;
}

export function FolderTree({
  folders,
  selected,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  folders: FolderNode[];
  selected: string;
  onSelect: (path: string) => void;
  onCreate?: (name: string) => void;
  onRename?: (path: string, name: string) => void;
  onDelete?: (path: string) => void;
}): React.ReactNode {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function commitRename(path: string, value: string): void {
    setRenaming(null);
    const name = value.trim();
    if (name) onRename?.(path, name);
  }

  function commitCreate(value: string): void {
    setCreating(false);
    const name = value.trim();
    if (name) onCreate?.(name);
  }

  return (
    <nav className="folder-tree" aria-label={message('library.treeLabel')}>
      <div className="folder-tree-head">
        <span>{message('library.treeLabel')}</span>
        <button
          type="button"
          className="folder-tree-add"
          aria-label={message('library.newFolder')}
          onClick={() => setCreating(true)}
        >
          <FolderPlus aria-hidden size={15} strokeWidth={1.75} />
        </button>
      </div>
      <ul role="tree">
        {folders.map((node) => (
          <li key={node.path} role="treeitem" aria-selected={selected === node.path}>
            {renaming === node.path ? (
              <input
                autoFocus
                className="folder-tree-rename"
                defaultValue={node.name}
                aria-label={message('library.rename')}
                onBlur={(event) => commitRename(node.path, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitRename(node.path, event.currentTarget.value);
                  if (event.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <button
                type="button"
                className={`folder-tree-item${selected === node.path ? ' is-selected' : ''}`}
                onClick={() => onSelect(node.path)}
                onDoubleClick={() => {
                  if (!node.pinned) setRenaming(node.path);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'F2' && !node.pinned) {
                    event.preventDefault();
                    setRenaming(node.path);
                  }
                  if ((event.key === 'Backspace' || event.key === 'Delete') && !node.pinned) {
                    event.preventDefault();
                    onDelete?.(node.path);
                  }
                }}
              >
                {iconFor(node)}
                <span className="folder-tree-name">{node.name}</span>
              </button>
            )}
          </li>
        ))}
        {creating ? (
          <li>
            <input
              autoFocus
              className="folder-tree-rename"
              aria-label={message('library.newFolderName')}
              placeholder={message('library.newFolderName')}
              onBlur={(event) => commitCreate(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitCreate(event.currentTarget.value);
                if (event.key === 'Escape') setCreating(false);
              }}
            />
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
