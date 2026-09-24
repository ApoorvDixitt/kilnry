// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  costLabel,
  visibleWorkflows,
  WorkflowCatalogue,
  type WorkflowCatalogueRowData,
} from './workflow-catalogue';

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

function row(overrides: Partial<WorkflowCatalogueRowData> = {}): WorkflowCatalogueRowData {
  return {
    id: 'kilnry-ugc-ad',
    name: 'UGC ad',
    category: 'ads',
    description: 'One finished vertical creator-style ad.',
    requires: ['text2image', 'reference2video'],
    cost_range: { min_usd: 0, max_usd: 8 },
    input_count: 5,
    ...overrides,
  };
}

describe('workflow catalogue (F-WFL-01)', () => {
  it('shows a cost range when the workflow declares a budget', () => {
    expect(costLabel(row())).toContain('8.00');
    expect(
      costLabel(row({ cost_range: undefined as unknown as { min_usd: number; max_usd: number } })),
    ).toContain('run');
  });

  it('filters by category tab and by search', () => {
    const rows = [row(), row({ id: 'kilnry-thumbnail', name: 'Thumbnail', category: 'image' })];
    expect(visibleWorkflows(rows, 'image', '')).toHaveLength(1);
    expect(visibleWorkflows(rows, 'all', 'ugc')).toHaveLength(1);
    expect(visibleWorkflows(rows, 'all', 'nothing')).toHaveLength(0);
  });

  it('renders a row per workflow with its Run button', async () => {
    const host = await render(<WorkflowCatalogue initial={[row()]} />);
    expect(host.querySelector('[data-workflow-id="kilnry-ugc-ad"]')).not.toBeNull();
    expect(host.querySelector('.workflow-run-button')?.textContent).toBe('Run');
  });

  it('opens the intake drawer when Run is clicked', async () => {
    const host = await render(<WorkflowCatalogue initial={[row()]} />);
    const runButton = host.querySelector('.workflow-run-button') as HTMLButtonElement;
    await act(async () => runButton.click());
    expect(host.querySelector('.workflow-drawer')).not.toBeNull();
  });
});
