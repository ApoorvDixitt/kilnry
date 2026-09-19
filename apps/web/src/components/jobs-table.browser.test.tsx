// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobsTable, costCell, filterJobs, jobActions, type JobRow } from './jobs-table';

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
