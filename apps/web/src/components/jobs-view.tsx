'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import { JobsTable, filterJobs, type JobRow, type JobTab } from './jobs-table';
import { WAITING_FOR_NETWORK } from './offline-logic';

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
  const [offline, setOffline] = useState(false);
  const [resumed, setResumed] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetch('/api/jobs')
      .then((response) => response.json() as Promise<{ jobs: JobRow[] }>)
      .then((body) => setRows(body.jobs))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Offline resilience (F-JOB-05): show the OfflineBar while the network is
  // down; on reconnect, ask the engine to resume owed jobs — it re-polls each
  // running job by its provider request id before any resubmission — and show
  // "Back online. Resumed N jobs."
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOffline(!window.navigator.onLine);
    const goOffline = (): void => setOffline(true);
    const goOnline = (): void => {
      setOffline(false);
      void apiFetch('/api/jobs/resume', { method: 'POST' })
        .then((response) => (response.ok ? (response.json() as Promise<{ resumed: number }>) : null))
        .then(async (body) => {
          if (body && body.resumed > 0) {
            const { resumedToast } = await import('./offline-logic');
            setResumed(resumedToast(body.resumed));
          }
          load();
        })
        .catch(() => undefined);
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
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
      const row = rows.find((each) => each.id === id);
      const confirmed = Number(row?.estimateUsd ?? row?.actualUsd ?? 0);
      void apiFetch(`/api/jobs/${id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed_cost_usd: Number.isFinite(confirmed) ? confirmed : 0 }),
      }).then(load);
    },
    [load, rows],
  );
  const check = useCallback(
    (id: string) => {
      void apiFetch(`/api/jobs/${id}/check`, { method: 'POST' }).then(load);
    },
    [load],
  );
  const cancel = useCallback(
    (id: string) => {
      void apiFetch(`/api/jobs/${id}/cancel`, { method: 'POST' }).then(load);
    },
    [load],
  );

  const shown = useMemo(() => {
    const filtered = filterJobs(rows, tab);
    if (!offline) return filtered;
    // While offline, queued jobs are waiting for the network to return.
    return filtered.map((row) =>
      row.status === 'queued' ? { ...row, stepLabel: WAITING_FOR_NETWORK } : row,
    );
  }, [rows, tab, offline]);

  return (
    <section className="jobs-view">
      {offline ? (
        <p className="offline-bar" role="status">
          {message('jobs.offlineBar')}
        </p>
      ) : null}
      {resumed ? (
        <p className="jobs-resumed" role="status" onAnimationEnd={() => setResumed(null)}>
          {resumed}
        </p>
      ) : null}
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
        <JobsTable rows={shown} onRetry={retry} onCancel={cancel} onCheck={check} />
      )}
    </section>
  );
}
