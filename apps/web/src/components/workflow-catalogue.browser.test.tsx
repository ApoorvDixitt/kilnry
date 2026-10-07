// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  costLabel,
  durationLabel,
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
    step_count: 11,
    eta_range: { min_minutes: 3, max_minutes: 12 },
    ...overrides,
  };
}

describe('workflow catalogue (F-WFL-01)', () => {
  // UX-09: the card read "≈ $0.00 – $8.00" — a zero floor and the budget cap.
  // It reads the workflow priced at its default inputs, or says it is priced
  // when you run it; never a range that starts at $0.
  it('shows "from ≈ $x" at the default inputs, and never a range from $0', () => {
    expect(costLabel(row({ from_usd: 2.25 }))).toBe('from ≈ $2.25');
    expect(costLabel(row())).toBe('Priced when you run it');
    expect(costLabel(row())).not.toContain('$0.00');
  });

  it('shows the plain summary, spelled-out capabilities and the category name (UX-09)', async () => {
    const host = await render(
      <WorkflowCatalogue
        initial={[
          row({
            summary: 'One finished 9:16 creator-style ad.',
            description: 'One finished 9:16 creator-style ad (W2, F-WFL-08, PRD-10 §9).',
            requires: ['tts', 'stt'],
            unmet_requires: ['tts'],
          }),
        ]}
      />,
    );
    expect(host.querySelector('.workflow-description')?.textContent).toBe(
      'One finished 9:16 creator-style ad.',
    );
    expect([...host.querySelectorAll('.workflow-cap-chip')].map((chip) => chip.textContent)).toEqual([
      'text-to-speech',
      'speech-to-text',
    ]);
    expect(host.querySelector('.workflow-needs-note')?.textContent).toContain(
      'Needs a provider for text-to-speech.',
    );
    expect(host.querySelector('.workflow-category')?.textContent).toBe('Ads');
  });

  // UX-17: the save toast promises "in the catalogue under Mine", and there was
  // no Mine pill.
  it('lists saved workflows under a Mine pill', async () => {
    const rows = [
      row(),
      row({ id: 'me.bee-thumbnails', name: 'Bee thumbnails', category: 'image', mine: true }),
    ];
    expect(visibleWorkflows(rows, 'mine', '').map((entry) => entry.id)).toEqual(['me.bee-thumbnails']);
    const host = await render(<WorkflowCatalogue initial={rows} />);
    const mine = [...host.querySelectorAll('.workflow-tab')].find((tab) => tab.textContent === 'Mine');
    expect(mine).toBeDefined();
    await act(async () => (mine as HTMLButtonElement).click());
    expect([...host.querySelectorAll('.workflow-name')].map((name) => name.textContent)).toEqual([
      'Bee thumbnails',
    ]);
  });

  it('shows the real step count and an ETA range, not the input count (F-WFL-01)', () => {
    // A workflow with 5 inputs and 11 steps must read as an 11-step workflow with
    // its ETA range, never "5 step workflow".
    const label = durationLabel(row());
    expect(label).toContain('11 step');
    expect(label).not.toContain('5 step');
    expect(label).toContain('3–12 min');
    // A workflow with no spending steps shows just the step count.
    const noEta = row();
    delete (noEta as { eta_range?: unknown }).eta_range;
    noEta.step_count = 2;
    expect(durationLabel(noEta)).toBe('2 step workflow');
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

  it('greys unmet capability chips, dims the row and disables Run without a provider (F-WFL-01)', async () => {
    const host = await render(<WorkflowCatalogue initial={[row({ unmet_requires: ['reference2video'] })]} />);
    const article = host.querySelector('[data-workflow-id="kilnry-ugc-ad"]') as HTMLElement;
    expect(article.classList.contains('is-dimmed')).toBe(true);
    const unmetChip = host.querySelector('.workflow-cap-chip.is-unmet');
    expect(unmetChip?.textContent).toBe('reference-to-video');
    // The met capability keeps a normal chip.
    const metChips = [...host.querySelectorAll('.workflow-cap-chip:not(.is-unmet)')].map(
      (chip) => chip.textContent,
    );
    expect(metChips).toContain('text-to-image');
    expect(host.querySelector('.workflow-needs-note')?.textContent).toContain('reference-to-video');
    expect((host.querySelector('.workflow-run-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('runs the focused row on Enter and carries the cost hover copy (F-WFL-01)', async () => {
    const host = await render(<WorkflowCatalogue initial={[row()]} />);
    const article = host.querySelector('[data-workflow-id="kilnry-ugc-ad"]') as HTMLElement;
    expect(host.querySelector('.workflow-cost')?.getAttribute('title')).toContain(
      'priced before you approve',
    );
    await act(async () => {
      article.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(host.querySelector('.workflow-drawer')).not.toBeNull();
  });
});
