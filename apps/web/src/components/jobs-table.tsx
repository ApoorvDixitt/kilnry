'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { message } from '../lib/messages';

export type JobStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'moderated';

export interface JobRow {
  id: string;
  status: string;
  prompt?: string | null;
  model?: string | null;
  provider?: string | null;
  source?: string | null;
  estimateUsd?: string | null;
  actualUsd?: string | null;
  stepLabel?: string | null;
  createdAt: string;
  errorMessage?: string | null;
}

export type JobTab = 'all' | 'running' | 'queued' | 'waiting' | 'failed' | 'done' | 'blocked';

const TAB_STATUS: Record<Exclude<JobTab, 'all'>, JobStatus> = {
  running: 'running',
  queued: 'queued',
  waiting: 'waiting',
  failed: 'failed',
  done: 'completed',
  blocked: 'moderated',
};

// Whether a job may be retried (a failed, terminal error) or cancelled (still in
// flight). Moderated jobs are not retried here — they route to Edit prompt.
export function jobActions(status: string): { canRetry: boolean; canCancel: boolean } {
  return {
    canRetry: status === 'failed',
    canCancel: status === 'queued' || status === 'running' || status === 'waiting',
  };
}

export function filterJobs(rows: JobRow[], tab: JobTab): JobRow[] {
  if (tab === 'all') return rows;
  return rows.filter((row) => row.status === TAB_STATUS[tab]);
}

// The cost cell: an estimate carries the approximate marker until the job is
// terminal, a moderated job reads "refunded" unless it was billed for compute.
export function costCell(row: JobRow): string {
  const terminal = ['completed', 'failed', 'cancelled', 'moderated'].includes(row.status);
  if (row.status === 'moderated' && (!row.actualUsd || Number(row.actualUsd) === 0)) {
    return `$0.00 · ${message('jobs.refunded')}`;
  }
  const amount = terminal ? row.actualUsd : row.estimateUsd;
  if (amount === null || amount === undefined) return '—';
  const value = `$${Number(amount).toFixed(2)}`;
  return terminal ? value : `≈ ${value}`;
}

function statusLabel(status: string): string {
  const known: JobStatus[] = [
    'queued',
    'running',
    'waiting',
    'completed',
    'failed',
    'cancelled',
    'moderated',
  ];
  return known.includes(status as JobStatus) ? message(`jobs.status.${status}`) : status;
}

export function JobsTable({
  rows,
  onRetry,
  onCancel,
  onOpen,
}: {
  rows: JobRow[];
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onOpen?: (id: string) => void;
}): React.ReactNode {
  return (
    <table className="jobs-table">
      <thead>
        <tr>
          <th>{message('jobs.colStatus')}</th>
          <th>{message('jobs.colPrompt')}</th>
          <th>{message('jobs.colModel')}</th>
          <th>{message('jobs.colCost')}</th>
          <th aria-label="actions" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const actions = jobActions(row.status);
          return (
            <tr key={row.id} data-status={row.status} onClick={() => onOpen?.(row.id)}>
              <td>
                <span className={`status-pill status-${row.status}`}>{statusLabel(row.status)}</span>
              </td>
              <td className="jobs-prompt">{row.prompt?.slice(0, 60) ?? row.stepLabel ?? '—'}</td>
              <td className="jobs-model">{row.model ?? '—'}</td>
              <td className="jobs-cost" data-money="true">
                {costCell(row)}
              </td>
              <td className="jobs-actions">
                {actions.canCancel ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCancel(row.id);
                    }}
                  >
                    {message('jobs.cancel')}
                  </button>
                ) : null}
                {actions.canRetry ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRetry(row.id);
                    }}
                  >
                    {message('jobs.retry')}
                  </button>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
