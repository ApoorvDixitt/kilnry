'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import type { AssetListItem, AssetSort } from '../lib/composer-types';
import { FolderTree, type FolderNode } from './folder-tree';
import { AssetGrid } from './asset-grid';

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? message('library.unreachableTitle'));
  return body;
}

export function LibraryBrowser(): React.ReactNode {
  const router = useRouter();
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [selected, setSelected] = useState('inbox');
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [sort, setSort] = useState<AssetSort>('newest');
  const [view, setView] = useState<'grid' | 'list'>('grid');
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

  // Load the selected folder's assets whenever the folder or sort changes, and
  // remember the grid or list choice per folder across restarts.
  useEffect(() => {
    const stored = window.localStorage.getItem(`kilnry-library-view:${selected}`);
    if (stored === 'grid' || stored === 'list') setView(stored);
    const params = new URLSearchParams({ folder: selected, sort });
    void fetch(`/api/library/assets?${params.toString()}`)
      .then((response) => json<{ assets: AssetListItem[] }>(response))
      .then((body) => setAssets(body.assets))
      .catch(() => setAssets([]));
  }, [selected, sort]);

  function changeView(next: 'grid' | 'list'): void {
    setView(next);
    window.localStorage.setItem(`kilnry-library-view:${selected}`, next);
  }

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
        {assets.length === 0 ? (
          <p className="library-empty">{message('library.emptyGrid')}</p>
        ) : (
          <AssetGrid
            assets={assets}
            sort={sort}
            view={view}
            onSortChange={setSort}
            onViewChange={changeView}
            onOpen={(id) => router.push(`/library/asset/${id}`)}
          />
        )}
      </div>
    </section>
  );
}
