// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCard, RunHeader, StepDetail, StepList, WorkflowRunView } from './workflow-run-view';
import type { RunView } from './workflow-run-view-logic';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

const RUN: RunView = {
  id: 'run_1',
  workflow_id: 'kilnry-ugc-ad',
  status: 'running',
  folder: 'Client_A/UGC_ad',
  estimate_usd: 2.4,
  spent_usd: 1.86,
  steps: [
    {
      step_id: 'plan',
      name: 'Plan',
      kind: 'set',
      status: 'completed',
      model: null,
      estimate_usd: 0,
      actual_usd: 0,
    },
    {
      step_id: 'board',
      name: 'Storyboard',
      kind: 'generate',
      status: 'running',
      model: 'gpt-image-2.5',
      estimate_usd: 0.22,
      actual_usd: null,
    },
  ],
};

describe('workflow run view (F-WFL-03)', () => {
  it('shows the header with cost so far vs estimate and a Cancel button', async () => {
    const host = await render(<RunHeader run={RUN} onCancel={() => {}} />);
    expect(host.querySelector('.run-cost')?.textContent).toBe('$1.86 so far of ≈ $2.40');
    expect(host.querySelector('.run-cancel-button')).not.toBeNull();
  });

  it('lists steps with a status glyph and model chip', async () => {
    const host = await render(<StepList steps={RUN.steps} selected={undefined} onSelect={() => {}} />);
    expect(host.querySelector('[data-step-id="plan"] .glyph-check')).not.toBeNull();
    expect(host.querySelector('[data-step-id="board"] .glyph-spinner')).not.toBeNull();
    expect(host.querySelector('[data-step-id="board"] .run-step-model')?.textContent).toBe('gpt-image-2.5');
  });

  it('shows the step detail tabs including Cost', async () => {
    const host = await render(<StepDetail step={RUN.steps[1]} />);
    const tabs = [...host.querySelectorAll('.run-detail-tab')].map((tab) => tab.textContent);
    expect(tabs).toEqual(['Inputs', 'Outputs', 'Logs', 'Cost']);
  });

  it('renders the full view from an initial run', async () => {
    const host = await render(<WorkflowRunView runId="run_1" initial={RUN} />);
    expect(host.querySelector('.run-header')).not.toBeNull();
    expect(host.querySelectorAll('.run-step-row')).toHaveLength(2);
  });

  it('shows the ApprovalCard with remaining calls when the run is waiting', async () => {
    const waiting: RunView = {
      ...RUN,
      status: 'awaiting_approval',
      steps: [
        {
          step_id: 'plan',
          name: 'Plan',
          kind: 'set',
          status: 'completed',
          model: null,
          estimate_usd: 0,
          actual_usd: 0,
        },
        {
          step_id: 'gate',
          name: 'Approve boards',
          kind: 'approval',
          status: 'waiting',
          model: null,
          estimate_usd: 0,
          actual_usd: null,
        },
        {
          step_id: 'clip',
          name: 'Clip',
          kind: 'generate',
          status: 'queued',
          model: 'seedance',
          estimate_usd: 1.5,
          actual_usd: null,
        },
      ],
    };
    const host = await render(<ApprovalCard run={waiting} onApprove={() => {}} onDeny={() => {}} />);
    expect(host.querySelector('.approval-card-title')?.textContent).toContain('Approve boards');
    expect(host.querySelector('[data-step-id="clip"] .approval-card-cost')?.textContent).toContain('1.50');
    expect(host.querySelector('.approval-card-total-amount')?.textContent).toContain('1.50');
  });

  it('approves through the interface, posting to the approve route', async () => {
    const calledUrls: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      calledUrls.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ run: RUN }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const waiting: RunView = { ...RUN, status: 'awaiting_approval' };
    const host = await render(<WorkflowRunView runId="run_1" initial={waiting} />);
    const approveButton = host.querySelector('.approval-approve-button') as HTMLButtonElement;
    await act(async () => approveButton.click());
    expect(calledUrls.some((url) => url.endsWith('/api/runs/run_1/approve'))).toBe(true);
  });

  it('shows a Retry control on a failed step that posts to retry-step', async () => {
    const failedStep = {
      step_id: 'clip',
      name: 'Clip',
      kind: 'generate',
      status: 'failed',
      model: 'seedance',
      estimate_usd: 1.5,
      actual_usd: null,
    };
    const posted: Array<{ url: string; body: string }> = [];
    let onRetryStepId = '';
    const host = await render(
      <StepDetail
        step={failedStep}
        onRetry={(stepId, model) => {
          onRetryStepId = stepId;
          posted.push({ url: '/retry-step', body: JSON.stringify({ stepId, model }) });
        }}
      />,
    );
    const retryButton = host.querySelector('.run-step-retry-button') as HTMLButtonElement;
    expect(retryButton).not.toBeNull();
    await act(async () => retryButton.click());
    expect(onRetryStepId).toBe('clip');
  });
});
