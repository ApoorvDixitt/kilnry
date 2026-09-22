'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useState } from 'react';
import { message } from '../lib/messages';

export type JobStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'moderated';

export interface JobRow {
  id: string;
  status: string;
  prompt?: string | null;
  model?: string | null;
  modelId?: string | null;
  provider?: string | null;
  providerId?: string | null;
  source?: string | null;
  estimateUsd?: string | null;
  actualUsd?: string | null;
  stepLabel?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  providerRequestId?: string | null;
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

// A failed job whose provider request was submitted but never answered in time:
// its stored provider request id lets the user check the provider's status
// without resubmitting (S-11, F-JOB-04).
export function isAmbiguousTimeout(row: JobRow): boolean {
  return row.status === 'failed' && row.errorCode === 'TIMEOUT' && Boolean(row.providerRequestId);
}

// Whole minutes elapsed between a failed job's start and finish, for the copy
// "No answer from {provider} after {minutes} min."
export function timeoutMinutes(row: JobRow): number {
  const start = row.startedAt ? Date.parse(row.startedAt) : Date.parse(row.createdAt);
  const end = row.finishedAt ? Date.parse(row.finishedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.floor((end - start) / 60_000);
}

// The provider a job ran against, for the failed-row and retry copy.
export function providerName(row: JobRow): string {
  return row.provider ?? row.providerId ?? 'the provider';
}

// The failed-row explanation for an ambiguous timeout, naming the provider and
// the minutes waited (PRD-21 S-11).
export function timeoutRowText(row: JobRow): string {
  return message('jobs.timeoutRow')
    .replace('{provider}', providerName(row))
    .replace('{minutes}', String(timeoutMinutes(row)));
}

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
  onCheck,
  onOpen,
}: {
  rows: JobRow[];
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onCheck?: (id: string) => void;
  onOpen?: (id: string) => void;
}): React.ReactNode {
  const [retrying, setRetrying] = useState<JobRow | null>(null);
  return (
    <>
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
            const ambiguous = isAmbiguousTimeout(row);
            return (
              <tr key={row.id} data-status={row.status} onClick={() => onOpen?.(row.id)}>
                <td>
                  <span className={`status-pill status-${row.status}`}>{statusLabel(row.status)}</span>
                </td>
                <td className="jobs-prompt">
                  {row.prompt?.slice(0, 60) ?? row.stepLabel ?? '—'}
                  {ambiguous ? (
                    <span className="jobs-timeout-note" role="note">
                      {timeoutRowText(row)}
                    </span>
                  ) : null}
                </td>
                <td className="jobs-model">{row.model ?? row.modelId ?? '—'}</td>
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
                  {ambiguous && onCheck ? (
                    <button
                      type="button"
                      className="jobs-check-status"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCheck(row.id);
                      }}
                    >
                      {message('jobs.checkStatus')}
                    </button>
                  ) : null}
                  {actions.canRetry ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        // A failed timeout may still be running at the provider,
                        // so Retry asks the user to check first (S-11); other
                        // failures retry directly.
                        if (isAmbiguousTimeout(row)) setRetrying(row);
                        else onRetry(row.id);
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
      {retrying ? (
        <div className="jobs-retry-dialog" role="dialog" aria-label={message('jobs.retryConfirmTitle')}>
          <div className="jobs-retry-card">
            <h3>{message('jobs.retryConfirmTitle')}</h3>
            <p className="jobs-retry-body">
              {message('jobs.retryConfirmBody').replace('{provider}', providerName(retrying))}
            </p>
            <div className="jobs-retry-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  onCheck?.(retrying.id);
                  setRetrying(null);
                }}
              >
                {message('jobs.retryConfirmCheck').replace('{provider}', providerName(retrying))}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onRetry(retrying.id);
                  setRetrying(null);
                }}
              >
                {message('jobs.retryConfirmProceed')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setRetrying(null)}>
                {message('jobs.retryConfirmCancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
