'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import { JobsTable, filterJobs, type JobRow, type JobTab } from './jobs-table';

const TABS: JobTab[] = ['all', 'running', 'queued', 'waiting', 'failed', 'done', 'blocked'];

const TAB_LABEL: Record<JobTab, string> = {
  all: 'jobs.tabAll',
  running: 'jobs.tabRunning',
  queued: 'jobs.tabQueued',
  waiting: 'jobs.tabWaiting',
  failed: 'jobs.tabFailed',
  done: 'jobs.tabDone',
  blocked: 'jobs.tabBlocked',
};

export function JobsView(): React.ReactNode {
  const [rows, setRows] = useState<JobRow[]>([]);
  const [tab, setTab] = useState<JobTab>('all');

  const load = useCallback(() => {
    void fetch('/api/jobs')
      .then((response) => response.json() as Promise<{ jobs: JobRow[] }>)
      .then((body) => setRows(body.jobs))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates: any job event from the server refreshes the table so status,
  // step label and cost move without a manual reload.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events');
    const refresh = (): void => load();
    source.addEventListener('message', refresh);
    source.addEventListener('error', () => source.close());
    return () => source.close();
  }, [load]);

  const retry = useCallback(
    (id: string) => {
      void apiFetch(`/api/jobs/${id}/retry`, { method: 'POST' }).then(load);
    },
    [load],
  );
  const cancel = useCallback(
    (id: string) => {
      void apiFetch(`/api/jobs/${id}/cancel`, { method: 'POST' }).then(load);
    },
    [load],
  );

  const shown = useMemo(() => filterJobs(rows, tab), [rows, tab]);

  return (
    <section className="jobs-view">
      <div className="jobs-tabs" role="tablist" aria-label={message('jobs.title')}>
        {TABS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            className={tab === option ? 'is-on' : ''}
            onClick={() => setTab(option)}
          >
            {message(TAB_LABEL[option])}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="jobs-empty">
          {rows.length === 0 ? message('jobs.empty') : message('jobs.filteredEmpty')}
        </p>
      ) : (
        <JobsTable rows={shown} onRetry={retry} onCancel={cancel} />
      )}
    </section>
  );
}
