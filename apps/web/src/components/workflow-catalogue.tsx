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
import { capabilityLabel } from '../lib/workflow-copy';
import { WorkflowIntakeDrawer } from './workflow-intake-drawer';

export interface WorkflowCatalogueRowData {
  id: string;
  name: string;
  category: string;
  description: string;
  /** The card's one line in plain words (UX-09); the description is the agent's. */
  summary?: string;
  /** A workflow the user saved, listed under Mine (UX-17). */
  mine?: boolean;
  /** Priced at the default inputs; absent when it cannot be (UX-09). */
  from_usd?: number;
  requires: string[];
  unmet_requires?: string[];
  cost_range?: { min_usd: number; max_usd: number };
  input_count: number;
  step_count: number;
  eta_range?: { min_minutes: number; max_minutes: number };
}

const CATEGORY_TABS = [
  { id: 'all', key: 'workflows.category.all' },
  { id: 'ads', key: 'workflows.category.ads' },
  { id: 'characters', key: 'workflows.category.characters' },
  { id: 'video', key: 'workflows.category.video' },
  { id: 'audio', key: 'workflows.category.audio' },
  { id: 'image', key: 'workflows.category.image' },
  { id: 'utility', key: 'workflows.category.utility' },
  // The save toast says a saved workflow is "in the catalogue under Mine"
  // (PRD-10:196); without this pill it was not (UX-17).
  { id: 'mine', key: 'workflows.category.mine' },
] as const;

/**
 * The cost line a row shows: "from ≈ $x", the workflow priced at its default
 * inputs. It used to read "≈ $0.00 – $14.00" — a zero floor and the budget
 * cap — and a range that starts at $0 is not a price (UX-09). With no honest
 * figure the row says it is priced when you run it.
 */
export function costLabel(row: WorkflowCatalogueRowData): string {
  if (row.from_usd === undefined || row.from_usd <= 0) return message('workflows.costUnknown');
  return message('workflows.costFrom').replace('{amount}', row.from_usd.toFixed(2));
}

/** The step-count and ETA line a row shows (PRD-10 §1). */
export function durationLabel(row: WorkflowCatalogueRowData): string {
  const steps = message('workflows.stepCount').replace('{count}', String(row.step_count));
  if (!row.eta_range) return steps;
  const eta = message('workflows.etaRange')
    .replace('{min}', String(row.eta_range.min_minutes))
    .replace('{max}', String(row.eta_range.max_minutes));
  return `${steps} · ${eta}`;
}

/** The rows one tab shows, filtered by the search box. */
export function visibleWorkflows(
  rows: WorkflowCatalogueRowData[],
  tab: string,
  query: string,
): WorkflowCatalogueRowData[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (tab === 'mine') {
      if (row.mine !== true) return false;
    } else if (tab !== 'all' && row.category !== tab) return false;
    if (needle === '') return true;
    return [row.name, row.category, row.summary ?? '', row.description]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
}

export function WorkflowCatalogueRow({
  row,
  onRun,
}: {
  row: WorkflowCatalogueRowData;
  onRun: (row: WorkflowCatalogueRowData) => void;
}): React.ReactNode {
  const unmet = row.unmet_requires ?? [];
  const dimmed = unmet.length > 0;
  return (
    <article
      className={dimmed ? 'workflow-row is-dimmed' : 'workflow-row'}
      data-workflow-id={row.id}
      tabIndex={0}
      onKeyDown={(event) => {
        // Run via Enter from the focused row (F-WFL-01 keyboard navigation).
        if (event.key === 'Enter' && !dimmed) {
          event.preventDefault();
          onRun(row);
        }
      }}
    >
      <div className="workflow-row-head">
        <h3 className="workflow-name">{row.name}</h3>
        <span className="workflow-category">{message(`workflows.category.${row.category}`)}</span>
      </div>
      <p className="workflow-description">{row.summary ?? row.description}</p>
      <div className="workflow-row-meta">
        <span className="workflow-cost" title={message('workflows.costHover')}>
          {costLabel(row)}
        </span>
        <span className="workflow-duration">{durationLabel(row)}</span>
        {row.requires.length > 0 ? (
          <span className="workflow-needs">
            {row.requires.map((capability) => (
              <span
                key={capability}
                className={unmet.includes(capability) ? 'workflow-cap-chip is-unmet' : 'workflow-cap-chip'}
              >
                {capabilityLabel(capability)}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      {dimmed ? (
        <p className="workflow-needs-note">
          {message('workflows.needsProvider').replace(
            '{capabilities}',
            unmet.map(capabilityLabel).join(', '),
          )}
        </p>
      ) : null}
      <div className="workflow-row-actions">
        <button type="button" className="workflow-run-button" disabled={dimmed} onClick={() => onRun(row)}>
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
            : message('workflows.empty').replace(
                '{category}',
                message(CATEGORY_TABS.find((entry) => entry.id === tab)?.key ?? 'workflows.category.all'),
              )}
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
