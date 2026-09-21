'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileText, Music, Play } from 'lucide-react';
import { message } from '../lib/messages';
import type { AssetListItem, AssetSort } from '../lib/composer-types';

const TILE_MIN = 180;
const GAP = 8;

// How many tiles fit across a row for a given container width, holding tiles
// between 160 and 220 px as the design requires.
export function columnsForWidth(width: number, min: number = TILE_MIN): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width + GAP) / (min + GAP)));
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function TypeGlyph({ item }: { item: AssetListItem }): React.ReactNode {
  if (item.kind === 'video' || item.kind === 'video_edit') {
    return (
      <span className="asset-glyph">
        <Play aria-hidden size={12} strokeWidth={2} />
        {item.duration_s ? `0:${String(Math.round(item.duration_s)).padStart(2, '0')}` : null}
      </span>
    );
  }
  if (item.kind === 'audio') {
    return (
      <span className="asset-glyph">
        <Music aria-hidden size={12} strokeWidth={2} />
      </span>
    );
  }
  if (item.kind === 'document') {
    return (
      <span className="asset-glyph">
        <FileText aria-hidden size={12} strokeWidth={2} />
      </span>
    );
  }
  return null;
}

function AssetTile({
  item,
  onOpen,
  selected,
  onToggleSelect,
}: {
  item: AssetListItem;
  onOpen: (id: string) => void;
  selected?: boolean | undefined;
  onToggleSelect?: ((id: string) => void) | undefined;
}): React.ReactNode {
  const [scrub, setScrub] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isVideo = item.kind === 'video' || item.kind === 'video_edit';

  function enter(): void {
    if (!isVideo || prefersReducedMotion()) return;
    timer.current = setTimeout(() => setScrub(true), 300);
  }
  function leave(): void {
    if (timer.current) clearTimeout(timer.current);
    setScrub(false);
  }

  return (
    <div className={`asset-tile-wrap${selected ? ' is-selected' : ''}`}>
      {onToggleSelect ? (
        <input
          type="checkbox"
          className="asset-select"
          checked={selected ?? false}
          aria-label={`Select ${item.path.split('/').at(-1)}`}
          onChange={() => onToggleSelect(item.id)}
        />
      ) : null}
      <button
        type="button"
        className={`asset-tile${item.sidecar_ok ? '' : ' is-orphan'}`}
        data-kind={item.kind}
        aria-label={item.path.split('/').at(-1) ?? item.id}
        draggable
        onDragStart={(event) => {
          // Chat's attachment tray reads either payload (F-CHT-05).
          event.dataTransfer.setData(
            'application/x-kilnry-asset',
            JSON.stringify({ asset_id: item.id, path: item.path, kind: item.kind }),
          );
          event.dataTransfer.setData('text/plain', item.id);
          event.dataTransfer.effectAllowed = 'copy';
        }}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onClick={() => onOpen(item.id)}
      >
        <img
          src={scrub ? `/api/sprite/${item.id}` : `/api/thumb/${item.id}`}
          alt=""
          loading="lazy"
          className="asset-thumb"
        />
        <TypeGlyph item={item} />
      </button>
    </div>
  );
}

export function AssetGrid({
  assets,
  sort,
  view,
  selected,
  onSortChange,
  onViewChange,
  onOpen,
  onToggleSelect,
}: {
  assets: AssetListItem[];
  sort: AssetSort;
  view: 'grid' | 'list';
  selected?: ReadonlySet<string>;
  onSortChange: (sort: AssetSort) => void;
  onViewChange: (view: 'grid' | 'list') => void;
  onOpen: (id: string) => void;
  onToggleSelect?: (id: string) => void;
}): React.ReactNode {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const columns = view === 'list' ? 1 : columnsForWidth(width);
  const rowCount = Math.ceil(assets.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (view === 'list' ? 52 : TILE_MIN + GAP),
    overscan: 8,
  });

  const measuredRef = useMemo(
    () => (node: HTMLDivElement | null) => {
      if (node) setWidth(node.clientWidth);
    },
    [],
  );

  return (
    <div className="asset-grid-wrap">
      <div className="asset-toolbar">
        <label className="asset-sort">
          {message('library.grid.sort')}
          <select value={sort} onChange={(event) => onSortChange(event.target.value as AssetSort)}>
            <option value="newest">{message('library.grid.sortNewest')}</option>
            <option value="oldest">{message('library.grid.sortOldest')}</option>
            <option value="name">{message('library.grid.sortName')}</option>
            <option value="cost">{message('library.grid.sortCost')}</option>
            <option value="duration">{message('library.grid.sortDuration')}</option>
          </select>
        </label>
        <span className="asset-count">
          {message('library.grid.count').replace('{n}', String(assets.length))}
        </span>
        <div className="asset-view-toggle" role="group">
          <button
            type="button"
            aria-pressed={view === 'grid'}
            className={view === 'grid' ? 'is-on' : ''}
            onClick={() => onViewChange('grid')}
          >
            {message('library.grid.viewGrid')}
          </button>
          <button
            type="button"
            aria-pressed={view === 'list'}
            className={view === 'list' ? 'is-on' : ''}
            onClick={() => onViewChange('list')}
          >
            {message('library.grid.viewList')}
          </button>
        </div>
      </div>

      <div className="asset-scroll" ref={scrollRef}>
        <div ref={measuredRef} className="asset-measure" />
        <div className="asset-virtual" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const start = virtualRow.index * columns;
            const rowItems = assets.slice(start, start + columns);
            return (
              <div
                key={virtualRow.key}
                className={view === 'list' ? 'asset-row' : 'asset-tile-row'}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                  ...(view === 'grid' ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : {}),
                }}
              >
                {rowItems.map((item) =>
                  view === 'list' ? (
                    <button
                      key={item.id}
                      type="button"
                      className="asset-list-row"
                      onClick={() => onOpen(item.id)}
                    >
                      <span className="asset-list-name">{item.path.split('/').at(-1)}</span>
                      <span className="asset-list-cell">{item.kind}</span>
                      <span className="asset-list-cell">{item.provider_id ?? '—'}</span>
                      <span className="asset-list-cell" data-money="true">
                        {item.actual_usd ? `$${item.actual_usd.toFixed(2)}` : '—'}
                      </span>
                    </button>
                  ) : (
                    <AssetTile
                      key={item.id}
                      item={item}
                      onOpen={onOpen}
                      selected={selected?.has(item.id) ?? false}
                      onToggleSelect={onToggleSelect}
                    />
                  ),
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
