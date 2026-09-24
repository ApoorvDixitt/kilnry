// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { RunHeader, StepDetail, StepList, WorkflowRunView } from './workflow-run-view';
import type { RunView } from './workflow-run-view-logic';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
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
});
