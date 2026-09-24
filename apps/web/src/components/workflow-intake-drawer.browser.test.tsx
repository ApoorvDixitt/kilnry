// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanChecklist, WorkflowIntakeDrawer } from './workflow-intake-drawer';
import type { PlanView } from './workflow-intake-drawer-logic';

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

const PLAN: PlanView = {
  workflow_id: 'kilnry-ugc-ad',
  total_estimate_usd: 3.85,
  eta_s: 60,
  steps: [
    {
      step_id: 'board',
      name: 'Storyboard',
      kind: 'generate',
      model: 'gpt-image-2.5',
      estimate_usd: 0.22,
      eta_s: 10,
    },
    {
      step_id: 'approve',
      name: 'Approve boards',
      kind: 'approval',
      estimate_usd: 0,
      eta_s: 0,
      approval: true,
    },
  ],
  warnings: [],
};

describe('workflow intake drawer (F-WFL-02)', () => {
  it('renders the plan checklist with per-step model and cost', async () => {
    const host = await render(<PlanChecklist plan={PLAN} />);
    expect(host.querySelector('[data-step-id="board"] .plan-step-model')?.textContent).toBe('gpt-image-2.5');
    expect(host.querySelector('[data-step-id="board"] .plan-step-cost')?.textContent).toBe('$0.22');
    expect(host.querySelector('[data-step-id="approve"] .plan-step-approval')).not.toBeNull();
  });

  it('loads the workflow inputs, prices a plan and shows Approve with the total', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/workflows/kilnry-ugc-ad')) {
        return new Response(
          JSON.stringify({
            workflow: {
              id: 'kilnry-ugc-ad',
              name: 'UGC ad',
              description: 'A creator ad.',
              inputs: {
                type: 'object',
                required: ['duration_s'],
                properties: { duration_s: { type: 'integer', default: 15, 'x-kilnry': { widget: 'chips' } } },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/plan')) {
        return new Response(JSON.stringify({ run_id: 'run_1', plan: PLAN }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = await render(
      <WorkflowIntakeDrawer workflowId="kilnry-ugc-ad" name="UGC ad" onClose={() => {}} />,
    );
    // The input field loads from the schema.
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector('#wf-input-duration_s')).not.toBeNull();

    // Preview the plan.
    const planButton = host.querySelector('.workflow-plan-button') as HTMLButtonElement;
    await act(async () => planButton.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector('.workflow-approve-button')?.textContent).toContain('$3.85');
  });
});
