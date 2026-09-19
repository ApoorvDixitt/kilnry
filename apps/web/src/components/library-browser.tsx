'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import type { AssetDetail, AssetListItem, AssetSort, MetadataPatch } from '../lib/composer-types';
import { FolderTree, type FolderNode } from './folder-tree';
import { AssetGrid } from './asset-grid';
import { InspectorDrawer } from './inspector-drawer';

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? message('library.unreachableTitle'));
  return body;
}

export function LibraryBrowser(): React.ReactNode {
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [selected, setSelected] = useState('inbox');
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [sort, setSort] = useState<AssetSort>('newest');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AssetListItem[] | null>(null);
  const [error, setError] = useState<string>();

  const openInspector = useCallback(async (id: string) => {
    try {
      const body = await json<{ asset: AssetDetail }>(await fetch(`/api/library/asset/${id}`));
      setDetail(body.asset);
    } catch {
      setDetail(null);
    }
  }, []);

  const patchAsset = useCallback(
    async (id: string, patch: MetadataPatch) => {
      await apiFetch(`/api/library/asset/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      await openInspector(id);
    },
    [openInspector],
  );

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

  // Run a search whenever the query changes; an empty query returns to the
  // folder listing.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setSearchResults(null);
      return;
    }
    const handle = setTimeout(() => {
      void fetch(`/api/library/search?q=${encodeURIComponent(term)}`)
        .then((response) => json<{ assets: AssetListItem[] }>(response))
        .then((body) => setSearchResults(body.assets))
        .catch(() => setSearchResults([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const shownAssets = searchResults ?? assets;

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
        <input
          type="search"
          className="library-search"
          value={query}
          placeholder={message('library.searchPlaceholder')}
          aria-label={message('library.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        {shownAssets.length === 0 ? (
          <p className="library-empty">
            {searchResults !== null ? message('library.searchNoResults') : message('library.emptyGrid')}
          </p>
        ) : (
          <AssetGrid
            assets={shownAssets}
            sort={sort}
            view={view}
            onSortChange={setSort}
            onViewChange={changeView}
            onOpen={(id) => void openInspector(id)}
          />
        )}
      </div>
      {detail ? (
        <InspectorDrawer
          detail={detail}
          onPatch={(patch) => void patchAsset(detail.id, patch)}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </section>
  );
}
