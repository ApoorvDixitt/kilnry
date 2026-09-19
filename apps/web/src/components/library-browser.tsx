'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import { FolderTree, type FolderNode } from './folder-tree';

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? message('library.unreachableTitle'));
  return body;
}

export function LibraryBrowser(): React.ReactNode {
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [selected, setSelected] = useState('inbox');
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const body = await json<{ folders: FolderNode[] }>(await fetch('/api/library/folders'));
      setFolders(body.folders);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('library.unreachableTitle'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(async (url: string, body: string) => {
    try {
      const parsed = await json<{ folders: FolderNode[] }>(
        await apiFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
      );
      setFolders(parsed.folders);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('library.unreachableTitle'));
    }
  }, []);

  if (error) {
    return (
      <section className="library-unreachable">
        <h2>{message('library.unreachableTitle')}</h2>
        <p>{message('library.unreachableBody')}</p>
      </section>
    );
  }

  return (
    <section className="library-browser">
      <FolderTree
        folders={folders}
        selected={selected}
        onSelect={setSelected}
        onCreate={(name) => void mutate('/api/library/folders', JSON.stringify({ parent: '', name }))}
        onRename={(path, name) =>
          void mutate('/api/library/folders/op', JSON.stringify({ op: 'rename', folder: path, name }))
        }
        onDelete={(path) =>
          void mutate('/api/library/folders/op', JSON.stringify({ op: 'delete', folder: path }))
        }
      />
      <div className="library-grid-area">
        <p className="library-empty">{message('library.emptyGrid')}</p>
      </div>
    </section>
  );
}
