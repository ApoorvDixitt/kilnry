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
  // The jobs route hands back the stored row, where the prompt lives inside the
  // request it was created from.
  request?: { prompt?: string | null } | null;
  model?: string | null;
  modelId?: string | null;
  confirmedBy?: string | null;
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

/**
 * Was money taken? PRD-15 §4's "Charged?" column: a moderated or refused request
 * is not charged, a timeout is unknown, a provider error depends on what the
 * provider says, and anything with a recorded actual was charged.
 */
export function chargeState(row: JobRow): 'no' | 'unknown' | 'charged' {
  const actual = row.actualUsd === null || row.actualUsd === undefined ? 0 : Number(row.actualUsd);
  if (actual > 0) return 'charged';
  if (row.errorCode === 'TIMEOUT' || row.errorCode === 'PROVIDER_ERROR') return 'unknown';
  return 'no';
}

/**
 * The buttons PRD-15 §4 offers for each code. The row always offers Dismiss;
 * these are the ones that differ (F-20).
 */
export function failedActions(
  row: JobRow,
): Array<
  | 'edit'
  | 'locate'
  | 'addKey'
  | 'raiseCap'
  | 'retry'
  | 'lowerConcurrency'
  | 'billing'
  | 'anotherModel'
  | 'copyDetails'
  | 'checkStatus'
> {
  switch (row.errorCode) {
    case 'INVALID_INPUT':
      return ['edit'];
    case 'NOT_FOUND':
      return ['locate', 'anotherModel'];
    case 'NO_PROVIDER':
      return ['addKey'];
    case 'BUDGET_EXCEEDED':
      return ['raiseCap'];
    case 'MODERATION_REJECTED':
      return ['edit', 'anotherModel'];
    case 'RATE_LIMITED':
      return ['retry', 'lowerConcurrency'];
    case 'INSUFFICIENT_FUNDS':
      return ['billing', 'retry'];
    case 'TIMEOUT':
      return ['checkStatus', 'retry'];
    case 'PROVIDER_ERROR':
      return ['retry', 'anotherModel', 'copyDetails'];
    default:
      return ['retry', 'copyDetails'];
  }
}

/**
 * The expanded detail under a failed row (PRD-15:29, F-20): Kilnry's sentence,
 * the provider's own message verbatim in mono, the code, whether money was
 * taken, and the per-code actions. Before this a failed row showed the prompt
 * and a Retry button, so the user learned nothing about what went wrong, what to
 * do, or whether they had paid.
 */
export function FailedRowDetail({
  row,
  onRetry,
  onAction,
}: {
  row: JobRow;
  onRetry?: ((id: string) => void) | undefined;
  onAction?: ((action: string, row: JobRow) => void) | undefined;
}): React.ReactNode {
  const sentence = row.errorMessage ?? message('jobs.failedUnknown');
  // The provider's message is appended behind "<provider> (<status>): " by the
  // provider layer, so the mono line is whatever follows that prefix.
  const providerSplit = /(^|\s)([a-z0-9.-]+ \(\d{3}\)): /i.exec(sentence);
  const kilnrySentence = providerSplit ? sentence.slice(0, providerSplit.index).trim() : sentence;
  const providerLine = providerSplit
    ? `${providerSplit[2]}: ${sentence.slice((providerSplit.index ?? 0) + providerSplit[0].length)}`
    : undefined;
  const charge = chargeState(row);
  return (
    <div className="jobs-failed-detail" data-testid="jobs-failed-detail">
      <p className="jobs-failed-sentence">{kilnrySentence}</p>
      {providerLine ? <code className="jobs-failed-provider">{providerLine}</code> : null}
      <p className="jobs-failed-meta">
        <span className="jobs-failed-code">{row.errorCode ?? 'UNKNOWN'}</span>
        <span className="jobs-failed-charge">{message(`jobs.charge.${charge}`)}</span>
      </p>
      <div className="jobs-failed-actions">
        {failedActions(row).map((action) => (
          <button
            key={action}
            type="button"
            data-action={action}
            onClick={(event) => {
              event.stopPropagation();
              if (action === 'retry') onRetry?.(row.id);
              else onAction?.(action, row);
            }}
          >
            {message(`jobs.action.${action}`)}
          </button>
        ))}
      </div>
    </div>
  );
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

// Who confirmed the spend (TRD-04's confirmed_by): the user answering a card,
// a policy or threshold letting it through, or a Model Context Protocol token.
export function confirmerLabel(confirmedBy: string | null | undefined): string {
  if (confirmedBy === 'user') return message('jobs.confirmedByUser');
  if (confirmedBy === 'auto') return message('jobs.confirmedByAuto');
  if (typeof confirmedBy === 'string' && confirmedBy.startsWith('mcp:')) {
    return message('jobs.confirmedByClient');
  }
  return '—';
}

export function JobsTable({
  rows,
  onRetry,
  onCancel,
  onCheck,
  onOpen,
  onAction,
}: {
  rows: JobRow[];
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  /** A per-code action from a failed row's detail (PRD-15 §4, F-20). */
  onAction?: ((action: string, row: JobRow) => void) | undefined;
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
            <th>{message('jobs.colConfirmedBy')}</th>
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
                  {(row.prompt ?? row.request?.prompt)?.slice(0, 60) ?? row.stepLabel ?? '—'}
                  {ambiguous ? (
                    <span className="jobs-timeout-note" role="note">
                      {timeoutRowText(row)}
                    </span>
                  ) : null}
                  {row.status === 'failed' ? (
                    <FailedRowDetail row={row} onRetry={onRetry} {...(onAction ? { onAction } : {})} />
                  ) : null}
                </td>
                <td className="jobs-model">{row.model ?? row.modelId ?? '—'}</td>
                <td className="jobs-cost" data-money="true">
                  {costCell(row)}
                </td>
                <td className="jobs-confirmer">{confirmerLabel(row.confirmedBy)}</td>
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
