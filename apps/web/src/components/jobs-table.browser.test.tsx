// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobsTable, chargeState, costCell, filterJobs, jobActions, type JobRow } from './jobs-table';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: crypto.randomUUID(),
    status: 'completed',
    prompt: 'a chai glass on marble',
    model: 'Kling 3.0',
    provider: 'fal',
    estimateUsd: '0.84',
    actualUsd: '0.84',
    createdAt: '2026-09-19T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(props: Parameters<typeof JobsTable>[0]): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<JobsTable {...props} />));
  return host;
}

describe('jobActions', () => {
  it('allows retry only on failed and cancel only while in flight', () => {
    expect(jobActions('failed')).toEqual({ canRetry: true, canCancel: false });
    expect(jobActions('running')).toEqual({ canRetry: false, canCancel: true });
    expect(jobActions('queued')).toEqual({ canRetry: false, canCancel: true });
    expect(jobActions('completed')).toEqual({ canRetry: false, canCancel: false });
    expect(jobActions('moderated')).toEqual({ canRetry: false, canCancel: false });
  });
});

describe('costCell', () => {
  it('shows an estimate marker until terminal and the reconciled cost after', () => {
    expect(costCell(job({ status: 'running', estimateUsd: '0.84', actualUsd: null }))).toBe('≈ $0.84');
    expect(costCell(job({ status: 'completed', actualUsd: '0.84' }))).toBe('$0.84');
  });

  it('shows refunded for a moderated job with no charge', () => {
    expect(costCell(job({ status: 'moderated', actualUsd: '0' }))).toBe('$0.00 · refunded');
  });
});

describe('filterJobs', () => {
  it('keeps all jobs on the all tab and maps done to completed', () => {
    const rows = [job({ status: 'completed' }), job({ status: 'failed' }), job({ status: 'running' })];
    expect(filterJobs(rows, 'all')).toHaveLength(3);
    expect(filterJobs(rows, 'done')).toHaveLength(1);
    expect(filterJobs(rows, 'failed')).toHaveLength(1);
    expect(filterJobs(rows, 'blocked')).toHaveLength(0);
  });
});

describe('JobsTable', () => {
  it('shows a cancel button on a running job and calls back', async () => {
    const onCancel = vi.fn();
    const host = await render({
      rows: [job({ status: 'running', id: 'r1' })],
      onRetry: () => {},
      onCancel,
    });
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
    await act(async () => (button as HTMLButtonElement).click());
    expect(onCancel).toHaveBeenCalledWith('r1');
  });

  it('shows a retry button on a failed job and never on a completed one', async () => {
    const host = await render({
      rows: [job({ status: 'failed', id: 'f1' }), job({ status: 'completed', id: 'c1' })],
      onRetry: () => {},
      onCancel: () => {},
    });
    const retries = [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Retry');
    expect(retries).toHaveLength(1);
  });
});

// F-20: a failed row showed the prompt and a Retry button and nothing else — not
// Kilnry's sentence, not the provider's own message, not the code, not whether
// money had been taken (PRD-15:29 and §4).
describe('the failed-row detail (F-JOB-01)', () => {
  it("shows Kilnry's sentence, the provider's message in mono, the code and the charge", async () => {
    const host = await render({
      rows: [
        job({
          status: 'failed',
          errorCode: 'INVALID_INPUT',
          errorMessage:
            "Kilnry couldn't send this: duration 45 s is above Kling 3.0's 15 s maximum. fal (422): duration out of range",
          actualUsd: '0',
        }),
      ],
      onRetry: () => undefined,
      onCancel: () => undefined,
    });
    const detail = host.querySelector('[data-testid="jobs-failed-detail"]')!;
    expect(detail.querySelector('.jobs-failed-sentence')?.textContent).toBe(
      "Kilnry couldn't send this: duration 45 s is above Kling 3.0's 15 s maximum.",
    );
    expect(detail.querySelector('.jobs-failed-provider')?.textContent).toBe(
      'fal (422): duration out of range',
    );
    expect(detail.querySelector('.jobs-failed-code')?.textContent).toBe('INVALID_INPUT');
    expect(detail.querySelector('.jobs-failed-charge')?.textContent).toBe('Not charged');
    expect(detail.querySelector('[data-action="edit"]')).not.toBeNull();
  });

  it('offers the actions PRD-15 §4 names for each code', async () => {
    const cases: Array<[string, string[]]> = [
      ['NOT_FOUND', ['locate', 'anotherModel']],
      ['NO_PROVIDER', ['addKey']],
      ['BUDGET_EXCEEDED', ['raiseCap']],
      ['RATE_LIMITED', ['retry', 'lowerConcurrency']],
      ['INSUFFICIENT_FUNDS', ['billing', 'retry']],
      ['PROVIDER_ERROR', ['retry', 'anotherModel', 'copyDetails']],
      ['TIMEOUT', ['checkStatus', 'retry']],
    ];
    for (const [code, expected] of cases) {
      const host = await render({
        rows: [job({ status: 'failed', errorCode: code, errorMessage: 'something went wrong' })],
        onRetry: () => undefined,
        onCancel: () => undefined,
      });
      const actions = [...host.querySelectorAll('.jobs-failed-actions button')].map((button) =>
        button.getAttribute('data-action'),
      );
      expect(actions, code).toEqual(expected);
      await act(async () => root?.unmount());
    }
  });

  it('reports an unknown charge for a timeout and a charge when money was taken', async () => {
    expect(chargeState(job({ status: 'failed', errorCode: 'TIMEOUT', actualUsd: '0' }))).toBe('unknown');
    expect(chargeState(job({ status: 'failed', errorCode: 'PROVIDER_ERROR', actualUsd: '0.42' }))).toBe(
      'charged',
    );
    expect(chargeState(job({ status: 'failed', errorCode: 'MODERATION_REJECTED', actualUsd: '0' }))).toBe(
      'no',
    );
  });
});
