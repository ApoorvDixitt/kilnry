'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// How a streamed message turns into cards (F-CHT-03, TRD-11 §11).
//
// A tool call is a ToolCallCard: collapsed to the tool's name, a one-line summary
// of its arguments and its state, expandable to the full arguments and result.
// Consecutive calls of the same tool are grouped and counted, so three images in
// a row read as one line rather than three.
//
// A call that needs the user's approval is an ApprovalCard: a distinct surface
// with an accent left border, never a floating bar. It names every planned call
// with its model, count and cost, puts the total in bold, and offers Approve,
// Edit plan and Deny. Approving posts the approval back through the same
// estimate-confirm-generate path the composer uses, so the cost the user saw is
// the cost that is confirmed.

import { useCallback, useEffect, useState } from 'react';
import { message } from '../lib/messages';

/** One planned call as the approval card lists it. */
export interface PlannedCall {
  kind: string;
  model: string;
  count: number;
  estimate_usd: number;
}

export type ToolCallState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error'
  | 'approval-requested'
  | 'denied';

function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** A one-line description of what a call was asked to do. */
export function summariseArguments(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  for (const key of ['action', 'task', 'op', 'query', 'prompt', 'name', 'capability', 'kind']) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') {
      return value.length > 90 ? `${value.slice(0, 89)}…` : value;
    }
  }
  if (Array.isArray(record['requests'])) {
    const first = record['requests'][0] as Record<string, unknown> | undefined;
    const prompt = typeof first?.['prompt'] === 'string' ? first['prompt'] : '';
    return prompt.length > 90 ? `${prompt.slice(0, 89)}…` : prompt;
  }
  return '';
}

function stateLabel(state: ToolCallState): string {
  switch (state) {
    case 'input-streaming':
      return message('chat.toolPending');
    case 'input-available':
      return message('chat.toolRunning');
    case 'output-available':
      return message('chat.toolDone');
    case 'output-error':
      return message('chat.toolFailed');
    case 'denied':
      return message('chat.toolDenied');
    case 'approval-requested':
      return message('chat.toolRunning');
  }
}

export interface ToolCallCardProps {
  toolName: string;
  state: ToolCallState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  /** How many consecutive calls of this tool were grouped into this card. */
  count?: number;
}

export function ToolCallCard({
  toolName,
  state,
  input,
  output,
  errorText,
  count = 1,
}: ToolCallCardProps): React.ReactNode {
  const [open, setOpen] = useState(false);
  const summary =
    output && typeof output === 'object' && typeof (output as { _summary?: unknown })._summary === 'string'
      ? (output as { _summary: string })._summary
      : summariseArguments(input);

  return (
    <article className={`chat-tool-card is-${state}`}>
      <button
        type="button"
        className="chat-tool-head"
        aria-expanded={open}
        aria-label={open ? message('chat.toolCollapse') : message('chat.toolExpand')}
        onClick={() => setOpen(!open)}
      >
        <span className="chat-tool-kind">{message('chat.toolLabel')}</span>
        <code className="chat-tool-name">{toolName}</code>
        {count > 1 ? (
          <span className="chat-tool-count">{message('chat.toolCount').replace('{n}', String(count))}</span>
        ) : null}
        <span className="chat-tool-summary">{summary}</span>
        <span className="chat-tool-state">{stateLabel(state)}</span>
      </button>
      {open ? (
        <div className="chat-tool-body">
          <h4>{message('chat.toolArguments')}</h4>
          <pre>{JSON.stringify(input ?? {}, null, 2)}</pre>
          {errorText === undefined ? null : (
            <p className="chat-tool-error" role="alert">
              {errorText}
            </p>
          )}
          {output === undefined ? null : (
            <>
              <h4>{message('chat.toolResult')}</h4>
              <pre>{JSON.stringify(output, null, 2)}</pre>
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}

export interface ApprovalCardProps {
  toolName: string;
  calls: PlannedCall[];
  totalUsd: number;
  /** The session threshold the checkbox would set. */
  autoApproveUsd?: number;
  onApprove: (options: { autoApproveBelowUsd?: number }) => void;
  onDeny: () => void;
  onEdit?: () => void;
  /** Enables the Enter and Escape shortcuts; the newest card owns them. */
  active?: boolean;
}

export function ApprovalCard({
  toolName,
  calls,
  totalUsd,
  autoApproveUsd,
  onApprove,
  onDeny,
  onEdit,
  active = true,
}: ApprovalCardProps): React.ReactNode {
  const [autoApprove, setAutoApprove] = useState(false);

  const approve = useCallback(() => {
    onApprove(
      autoApprove && typeof autoApproveUsd === 'number' ? { autoApproveBelowUsd: autoApproveUsd } : {},
    );
  }, [autoApprove, autoApproveUsd, onApprove]);

  // Approve on Enter, deny on Escape (wireframes §11).
  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Enter') {
        event.preventDefault();
        approve();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onDeny();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, approve, onDeny]);

  return (
    <article className="chat-approval-card">
      <h3>
        {calls.length > 1
          ? message('chat.approvalTitle')
          : message('chat.approvalSingle').replace('{tool}', toolName)}
      </h3>
      {calls.length === 0 ? null : (
        <table className="chat-approval-table">
          <thead>
            <tr>
              <th scope="col">{message('chat.approvalColumnCall')}</th>
              <th scope="col">{message('chat.approvalColumnModel')}</th>
              <th scope="col">{message('chat.approvalColumnCount')}</th>
              <th scope="col">{message('chat.approvalColumnCost')}</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call, index) => (
              <tr key={`${call.kind}-${index}`}>
                <td>{call.kind}</td>
                <td>{call.model}</td>
                <td>{call.count}</td>
                <td>
                  {call.estimate_usd === 0 ? message('chat.approvalUnpriced') : money(call.estimate_usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="chat-approval-total">
        <span>{message('chat.approvalTotal')}</span>
        <strong>{money(totalUsd)}</strong>
      </p>
      <div className="chat-approval-actions">
        <button type="button" className="chat-primary" onClick={approve}>
          {message('chat.approvalApprove')} <kbd>{message('chat.approvalApproveHint')}</kbd>
        </button>
        {onEdit ? (
          <button type="button" className="chat-secondary-button" onClick={onEdit}>
            {message('chat.approvalEdit')}
          </button>
        ) : null}
        <button type="button" className="chat-secondary-button" onClick={onDeny}>
          {message('chat.approvalDeny')} <kbd>{message('chat.approvalDenyHint')}</kbd>
        </button>
      </div>
      {typeof autoApproveUsd === 'number' ? (
        <label className="chat-approval-auto">
          <input
            type="checkbox"
            checked={autoApprove}
            onChange={(event) => setAutoApprove(event.target.checked)}
          />
          <span>{message('chat.approvalAutoApprove').replace('{amount}', autoApproveUsd.toFixed(2))}</span>
        </label>
      ) : null}
    </article>
  );
}

/**
 * Group consecutive calls of the same tool so a run of three reads as one line
 * with a count (TRD-11 §11). A call awaiting approval is never grouped: it needs
 * its own card and its own answer.
 */
export function groupToolCalls<T extends { toolName: string; state: ToolCallState }>(
  parts: T[],
): Array<{ head: T; count: number }> {
  const groups: Array<{ head: T; count: number }> = [];
  for (const part of parts) {
    const last = groups[groups.length - 1];
    const groupable = part.state !== 'approval-requested' && last?.head.state !== 'approval-requested';
    if (last && groupable && last.head.toolName === part.toolName) {
      last.count += 1;
      continue;
    }
    groups.push({ head: part, count: 1 });
  }
  return groups;
}
