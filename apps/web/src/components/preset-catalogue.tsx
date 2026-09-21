// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The preset gallery (F-PRE-01). Nine tabs, a search box that matches name,
// description, tags and model, and a grid of cards. A card says what it costs
// before you open it, and when the key it needs is missing it says so and still
// opens, so the prompt can be read without paying for anything.

import { useEffect, useMemo, useState } from 'react';
import { message } from '../lib/messages';
import { PresetDrawer } from './preset-drawer';
import type { DrawerPreset } from './preset-drawer-logic';

/** The eight categories, in the order the tabs show them, plus All. */
export const PRESET_TABS = [
  { id: 'all', label: 'All' },
  { id: 'ugc', label: 'UGC' },
  { id: 'product_shot', label: 'Product shot' },
  { id: 'motion', label: 'Motion' },
  { id: 'ads', label: 'Ads' },
  { id: 'posters', label: 'Posters' },
  { id: 'camera', label: 'Camera' },
  { id: 'styles', label: 'Styles' },
  { id: 'thumbnails', label: 'Thumbnails' },
] as const;

export interface PresetCardRow {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  kind: string;
  model_label: string;
  model_tooltip: string;
  cost_usd?: number;
  cost_unit: string;
  needs: string[];
  missing_provider?: string;
  price_stale: boolean;
  preview_url?: string;
  enabled: boolean;
  issue?: string;
  path: string;
  source: string;
}

const copy = {
  tabsLabel: message('presets.tabsLabel'),
  tabAll: message('presets.tabAll'),
  searchLabel: message('presets.searchLabel'),
  searchPlaceholder: message('presets.searchPlaceholder'),
  use: message('presets.use'),
  needsKey: message('presets.needsKey'),
  costTooltip: message('presets.costTooltip'),
  costUnknown: message('presets.costUnknown'),
  unitImage: message('presets.unitImage'),
  unitClip: message('presets.unitClip'),
  previewEmpty: message('presets.previewEmpty'),
  emptyTab: message('presets.emptyTab'),
  addHint: message('presets.addHint'),
  invalidUnknown: message('presets.invalidUnknown'),
};

/** The category label a card shows, from the tab list. */
export function categoryLabel(category: string): string {
  return PRESET_TABS.find((tab) => tab.id === category)?.label ?? category;
}

/** The cost line: an indicative figure and its unit, or nothing priced yet. */
export function costLabel(row: PresetCardRow): string {
  if (row.cost_usd === undefined) return copy.costUnknown;
  const unit = row.cost_unit === 'clip' ? copy.unitClip : copy.unitImage;
  return `≈ $${row.cost_usd.toFixed(2)} · ${unit}`;
}

/** Search over the fields PRD-09 §1 lists: name, description, tags and model. */
export function matchesQuery(row: PresetCardRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const haystack = [row.name, row.description, row.model_label, ...row.tags].join(' ').toLowerCase();
  return haystack.includes(needle);
}

/** The rows one tab shows, filtered by the search box. */
export function visiblePresets(rows: PresetCardRow[], tab: string, query: string): PresetCardRow[] {
  return rows.filter((row) => (tab === 'all' || row.category === tab) && matchesQuery(row, query));
}

/** The empty line a filtered tab shows, naming the tab. */
export function emptyLabel(tab: string): string {
  const label = tab === 'all' ? copy.tabAll : categoryLabel(tab);
  return copy.emptyTab.replace('{category}', label.toLowerCase());
}

export function PresetCard({
  row,
  onUse,
  busy = false,
}: {
  row: PresetCardRow;
  onUse: (row: PresetCardRow) => void;
  busy?: boolean;
}): React.ReactNode {
  if (!row.enabled) {
    return (
      <div className="preset-card is-invalid" role="alert">
        <p className="preset-invalid-text">{`${row.id}.json: ${row.issue ?? copy.invalidUnknown}`}</p>
      </div>
    );
  }
  return (
    <article className="preset-card">
      <div className="preset-preview" aria-hidden="true">
        {row.preview_url === undefined ? (
          <span className="preset-preview-empty">{copy.previewEmpty}</span>
        ) : (
          <img alt="" src={row.preview_url} loading="lazy" />
        )}
      </div>
      <h3 className="preset-name">{row.name}</h3>
      <p className="preset-meta" title={row.model_tooltip}>
        {`${categoryLabel(row.category)} · ${row.model_label}`}
      </p>
      <p className="preset-cost" title={copy.costTooltip}>
        {row.price_stale ? <span className="preset-stale-dot" aria-hidden="true" /> : null}
        {costLabel(row)}
      </p>
      <div className="preset-actions">
        {row.missing_provider === undefined ? (
          <span />
        ) : (
          <span className="preset-needs-badge">
            {copy.needsKey.replace('{provider}', row.missing_provider)}
          </span>
        )}
        <button type="button" className="preset-use-button" disabled={busy} onClick={() => onUse(row)}>
          {copy.use}
        </button>
      </div>
    </article>
  );
}

export function PresetCatalogue({ initial }: { initial?: PresetCardRow[] }): React.ReactNode {
  const [rows, setRows] = useState<PresetCardRow[]>(initial ?? []);
  const [tab, setTab] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<DrawerPreset | null>(null);
  const [opening, setOpening] = useState<string>();

  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    void fetch('/api/presets')
      .then((response) => (response.ok ? response.json() : { presets: [] }))
      .then((body: { presets?: PresetCardRow[] }) => {
        if (live) setRows(body.presets ?? []);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [initial]);

  const shown = useMemo(() => visiblePresets(rows, tab, query), [rows, tab, query]);

  function use(row: PresetCardRow): void {
    // A card whose provider is missing sends the user to Providers instead of
    // opening a drawer that could not run (PRD-09 §1 States).
    if (row.missing_provider !== undefined) {
      window.location.href = `/settings/providers?provider=${row.missing_provider}`;
      return;
    }
    setOpening(row.id);
    void fetch(`/api/presets/${encodeURIComponent(row.id)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { preset?: DrawerPreset } | null) => setChosen(body?.preset ?? null))
      .catch(() => setChosen(null))
      .finally(() => setOpening(undefined));
  }

  return (
    <section className="preset-screen">
      <header className="preset-header">
        <div className="preset-tabs" role="tablist" aria-label={copy.tabsLabel}>
          {PRESET_TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className="preset-tab"
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="preset-search"
          value={query}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchLabel}
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>

      {shown.length === 0 ? (
        <p className="preset-empty">{emptyLabel(tab)}</p>
      ) : (
        <div className="preset-body">
          <div className="preset-grid">
            {shown.map((row) => (
              <PresetCard key={row.id} row={row} onUse={use} busy={opening === row.id} />
            ))}
          </div>
          {chosen === null ? null : <PresetDrawer preset={chosen} onClose={() => setChosen(null)} />}
        </div>
      )}

      <footer className="preset-footer">{copy.addHint}</footer>
    </section>
  );
}
