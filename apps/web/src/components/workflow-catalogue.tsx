// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The workflow catalogue (F-WFL-01). One row per workflow with its cost range,
// how many steps it runs, the capabilities it needs, and a Run button that opens
// the intake drawer. The list is generated from the shipped and user YAML files.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from '../lib/messages';
import { WorkflowIntakeDrawer } from './workflow-intake-drawer';

export interface WorkflowCatalogueRowData {
  id: string;
  name: string;
  category: string;
  description: string;
  requires: string[];
  cost_range?: { min_usd: number; max_usd: number };
  input_count: number;
}

const CATEGORY_TABS = [
  { id: 'all', key: 'workflows.category.all' },
  { id: 'ads', key: 'workflows.category.ads' },
  { id: 'characters', key: 'workflows.category.characters' },
  { id: 'video', key: 'workflows.category.video' },
  { id: 'audio', key: 'workflows.category.audio' },
  { id: 'image', key: 'workflows.category.image' },
  { id: 'utility', key: 'workflows.category.utility' },
] as const;

/** The cost line a row shows: a range when the workflow declares a budget. */
export function costLabel(row: WorkflowCatalogueRowData): string {
  if (!row.cost_range) return message('workflows.costUnknown');
  return message('workflows.costRange')
    .replace('{min}', row.cost_range.min_usd.toFixed(2))
    .replace('{max}', row.cost_range.max_usd.toFixed(2));
}

/** The rows one tab shows, filtered by the search box. */
export function visibleWorkflows(
  rows: WorkflowCatalogueRowData[],
  tab: string,
  query: string,
): WorkflowCatalogueRowData[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (tab !== 'all' && row.category !== tab) return false;
    if (needle === '') return true;
    return [row.name, row.category, row.description].join(' ').toLowerCase().includes(needle);
  });
}

export function WorkflowCatalogueRow({
  row,
  onRun,
}: {
  row: WorkflowCatalogueRowData;
  onRun: (row: WorkflowCatalogueRowData) => void;
}): React.ReactNode {
  return (
    <article className="workflow-row" data-workflow-id={row.id}>
      <div className="workflow-row-head">
        <h3 className="workflow-name">{row.name}</h3>
        <span className="workflow-category">{row.category}</span>
      </div>
      <p className="workflow-description">{row.description}</p>
      <div className="workflow-row-meta">
        <span className="workflow-cost">{costLabel(row)}</span>
        <span className="workflow-duration">
          {message('workflows.durationLabel').replace('{count}', String(row.input_count))}
        </span>
        {row.requires.length > 0 ? (
          <span className="workflow-needs">
            {message('workflows.needsLabel').replace('{capabilities}', row.requires.join(', '))}
          </span>
        ) : null}
      </div>
      <div className="workflow-row-actions">
        <button type="button" className="workflow-run-button" onClick={() => onRun(row)}>
          {message('workflows.run')}
        </button>
      </div>
    </article>
  );
}

export function WorkflowCatalogue({ initial }: { initial?: WorkflowCatalogueRowData[] }): React.ReactNode {
  const [rows, setRows] = useState<WorkflowCatalogueRowData[]>(initial ?? []);
  const [tab, setTab] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<WorkflowCatalogueRowData | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/workflows');
      if (!response.ok) return;
      const body = (await response.json()) as { workflows?: WorkflowCatalogueRowData[] };
      setRows(body.workflows ?? []);
    } catch {
      // A failed refresh leaves the list as it was.
    }
  }, []);

  useEffect(() => {
    if (initial !== undefined) return;
    void reload();
  }, [initial, reload]);

  const shown = useMemo(() => visibleWorkflows(rows, tab, query), [rows, tab, query]);

  return (
    <section className="workflow-screen">
      <header className="workflow-header">
        <h1 className="workflow-title">{message('workflows.title')}</h1>
        <div className="workflow-tabs" role="tablist" aria-label={message('workflows.title')}>
          {CATEGORY_TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className="workflow-tab"
              onClick={() => setTab(entry.id)}
            >
              {message(entry.key)}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="workflow-search"
          value={query}
          placeholder={message('workflows.searchPlaceholder')}
          aria-label={message('workflows.searchLabel')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>

      {shown.length === 0 ? (
        <p className="workflow-empty">
          {rows.length === 0
            ? message('workflows.emptyAll')
            : message('workflows.empty').replace('{category}', tab)}
        </p>
      ) : (
        <div className="workflow-list">
          {shown.map((row) => (
            <WorkflowCatalogueRow key={row.id} row={row} onRun={setChosen} />
          ))}
        </div>
      )}

      {chosen === null ? null : (
        <WorkflowIntakeDrawer workflowId={chosen.id} name={chosen.name} onClose={() => setChosen(null)} />
      )}
    </section>
  );
}
