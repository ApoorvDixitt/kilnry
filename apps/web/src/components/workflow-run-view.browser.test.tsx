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

  // axe aria-progressbar-name (WCAG 4.1.2): the run's progress bar had a value
  // and no name, so the @gate scan failed whenever the header rendered in time
  // (run 37655595787).
  it('names the run progress bar and gives its range', async () => {
    const host = await render(<RunHeader run={RUN} onCancel={() => {}} />);
    const bar = host.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-label')).toBe('1 of 2 steps');
    expect(bar?.getAttribute('aria-valuemin')).toBe('0');
    expect(bar?.getAttribute('aria-valuemax')).toBe('100');
    expect(bar?.getAttribute('aria-valuenow')).toBe('50');
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

  it('renders real content in each of the four StepDetail tabs (F-WFL-03)', async () => {
    const step = {
      step_id: 'board',
      name: 'Storyboard',
      kind: 'generate',
      status: 'completed',
      model: 'gpt-image-2.5',
      estimate_usd: 0.22,
      actual_usd: 0.2,
      inputs: { prompt: 'a rooftop cafe at golden hour', params: { aspect_ratio: '16:9' } },
      outputs: { assets: ['01ASSETONE', '01ASSETTWO'] },
      logs: 'queued\nrunning\ncompleted',
      unit_price: { per_image_usd: 0.2 },
    };
    const host = await render(<StepDetail step={step} />);
    const tab = (label: string): HTMLButtonElement =>
      [...host.querySelectorAll('.run-detail-tab')].find((t) => t.textContent === label) as HTMLButtonElement;

    // Inputs: the rendered prompt is shown, not the literal label.
    await act(async () => tab('Inputs').click());
    expect(host.querySelector('.run-detail-inputs')?.textContent).toContain('a rooftop cafe at golden hour');
    expect(host.querySelector('.run-detail-empty')).toBeNull();

    // Outputs: an AssetCard per produced asset, with a thumbnail.
    await act(async () => tab('Outputs').click());
    const cards = host.querySelectorAll('.run-output-card');
    expect(cards).toHaveLength(2);
    expect(
      host.querySelector('.run-output-card[data-asset-id="01ASSETONE"] img')?.getAttribute('src'),
    ).toContain('/api/thumb/01ASSETONE');

    // Logs: a monospaced pane with a follow-tail toggle.
    await act(async () => tab('Logs').click());
    expect(host.querySelector('.run-logs-pane')?.textContent).toContain('running');
    expect(host.querySelector('.run-logs-follow input[type="checkbox"]')).not.toBeNull();

    // Cost: estimate against actual and the unit price.
    await act(async () => tab('Cost').click());
    const cost = host.querySelector('.run-detail-cost')?.textContent ?? '';
    expect(cost).toContain('0.22');
    expect(cost).toContain('0.20');
    expect(cost).toContain('per_image_usd');
  });

  it('shows an empty note when a tab has no content', async () => {
    const host = await render(<StepDetail step={RUN.steps[1]} />);
    // The running board step has no inputs/outputs/logs in this fixture.
    const inputsTab = [...host.querySelectorAll('.run-detail-tab')].find(
      (t) => t.textContent === 'Inputs',
    ) as HTMLButtonElement;
    await act(async () => inputsTab.click());
    expect(host.querySelector('.run-detail-empty')).not.toBeNull();
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

  it('names both prices and the new run total when a model swap waits for approval (D-61)', async () => {
    const waiting: RunView = {
      ...RUN,
      status: 'awaiting_approval',
      steps: [
        {
          step_id: 'edit',
          name: 'Edit the ad',
          kind: 'generate',
          status: 'waiting',
          model: 'fal-ai/wan/v2.7/edit-video',
          estimate_usd: 0.15,
          actual_usd: null,
          pending_swap: {
            from: 'black-forest-labs/flux-video-edit',
            to: 'fal-ai/wan/v2.7/edit-video',
            planned_usd: 0.15,
            estimate_usd: 0.75,
            run_total_usd: 0.9,
          },
        },
      ],
    };
    const host = await render(<ApprovalCard run={waiting} onApprove={() => {}} onDeny={() => {}} />);
    expect(host.querySelector('[data-testid="approval-swap"]')?.textContent).toBe(
      'Switching to fal-ai/wan/v2.7/edit-video raises this step from ≈ $0.15 to ≈ $0.75. New run total ≈ $0.90.',
    );
  });

  it('renders the waiting step outputs and Edit, Regenerate, Stop actions (F-WFL-04)', async () => {
    const waiting: RunView = {
      ...RUN,
      status: 'awaiting_approval',
      steps: [
        {
          step_id: 'board',
          name: 'Storyboard',
          kind: 'generate',
          status: 'waiting',
          model: 'gpt-image-2.5',
          estimate_usd: 0.22,
          actual_usd: 0.2,
          outputs: { assets: ['01BOARDONE', '01BOARDTWO'] },
        },
      ],
    };
    let edited = '';
    let regenerated = '';
    let stopped = 0;
    const host = await render(
      <ApprovalCard
        run={waiting}
        onApprove={() => {}}
        onDeny={() => {}}
        onEdit={(id) => (edited = id)}
        onRegenerate={(id) => (regenerated = id)}
        onStop={() => (stopped += 1)}
      />,
    );
    // The waiting step's outputs render as zoomable asset cards.
    const cards = host.querySelectorAll('.approval-output-card');
    expect(cards).toHaveLength(2);
    expect(
      host.querySelector('.approval-output-card[data-asset-id="01BOARDONE"] a')?.getAttribute('href'),
    ).toContain('/api/media/01BOARDONE');
    // The three extra actions are present and wired.
    await act(async () => (host.querySelector('.approval-edit-button') as HTMLButtonElement).click());
    expect(edited).toBe('board');
    await act(async () => (host.querySelector('.approval-regenerate-button') as HTMLButtonElement).click());
    expect(regenerated).toBe('board');
    await act(async () => (host.querySelector('.approval-stop-button') as HTMLButtonElement).click());
    expect(stopped).toBe(1);
  });

  it('approves on Enter and denies on Escape from the keyboard (F-WFL-04)', async () => {
    let approved = 0;
    let denied = 0;
    const waiting: RunView = { ...RUN, status: 'awaiting_approval' };
    await render(
      <ApprovalCard run={waiting} onApprove={() => (approved += 1)} onDeny={() => (denied += 1)} />,
    );
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
    expect(approved).toBe(1);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(denied).toBe(1);
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

  it('opens the run header menu with Re-run, Duplicate, Open folder and Export (F33)', async () => {
    let rerunStep = '';
    let duplicated = 0;
    let exported = 0;
    const host = await render(
      <RunHeader
        run={RUN}
        onCancel={() => undefined}
        onRerunFrom={(stepId) => (rerunStep = stepId)}
        onDuplicate={() => (duplicated += 1)}
        onOpenFolder={() => undefined}
        onExportManifest={() => (exported += 1)}
      />,
    );
    const menuButton = host.querySelector('.run-menu-button') as HTMLButtonElement;
    expect(menuButton).not.toBeNull();
    await act(async () => menuButton.click());
    const labels = [...host.querySelectorAll('.run-menu-items [role="menuitem"]')].map(
      (item) => item.textContent,
    );
    expect(labels).toContain('Re-run from step…');
    expect(labels).toContain('Duplicate');
    expect(labels).toContain('Open output folder');
    expect(labels).toContain('Export manifest');

    const exportItem = [...host.querySelectorAll('.run-menu-items [role="menuitem"]')].find(
      (item) => item.textContent === 'Export manifest',
    ) as HTMLButtonElement;
    await act(async () => exportItem.click());
    expect(exported).toBe(1);

    await act(async () => menuButton.click());
    const rerunItem = [...host.querySelectorAll('.run-menu-items [role="menuitem"]')].find(
      (item) => item.textContent === 'Re-run from step…',
    ) as HTMLButtonElement;
    await act(async () => rerunItem.click());
    const pick = host.querySelector('.run-menu-pick [data-step-id="plan"]') as HTMLButtonElement;
    expect(pick).not.toBeNull();
    await act(async () => pick.click());
    expect(rerunStep).toBe('plan');
    expect(duplicated).toBe(0);
  });

  it('reloads the run on a server-sent job event instead of a fixed poll (F32)', async () => {
    // Capture the EventSource the live run opens and the job-event listeners it
    // registers, so the test can push a job.completed and assert the view
    // reloaded — without waiting on any timer.
    const listeners = new Map<string, (event: MessageEvent) => void>();
    let opened = '';
    class FakeEventSource {
      constructor(url: string) {
        opened = url;
      }
      addEventListener(type: string, handler: (event: MessageEvent) => void): void {
        listeners.set(type, handler);
      }
      close(): void {}
    }
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
    const reloadUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        reloadUrls.push(String(input));
        return Promise.resolve(
          new Response(JSON.stringify({ run: { ...RUN, status: 'running' } }), { status: 200 }),
        );
      }),
    );
    const live: RunView = { ...RUN, status: 'running' };
    await render(<WorkflowRunView runId="run_1" initial={live} />);
    // The live run subscribes to the shared event stream.
    expect(opened).toBe('/api/events');
    expect(listeners.has('job.completed')).toBe(true);
    reloadUrls.length = 0;
    // A job finishing pushes an event; the view reloads the run from the server.
    await act(async () => {
      listeners.get('job.completed')!(new MessageEvent('job.completed', { data: '{}' }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(reloadUrls.some((url) => url.endsWith('/api/runs/run_1'))).toBe(true);
  });

  // F-100: the live run keeps one stream for its whole life. The fake mirrors
  // /api/events as the route implements it: a fresh EventSource (no
  // Last-Event-ID) is first sent every buffered event (`eventHub.since(0)`,
  // apps/web/src/app/api/events/route.ts:22), so a job event arrives right after
  // each open. Every reload returns a new run object, as the server does.
  it('keeps one EventSource and at most two run GETs in the first 5 s of a live run (F-100)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    try {
      let constructed = 0;
      class ReplayingEventSource {
        #listeners = new Map<string, Array<(event: MessageEvent) => void>>();
        #closed = false;
        constructor(public url: string) {
          constructed += 1;
          setTimeout(() => {
            if (this.#closed) return;
            for (const handler of this.#listeners.get('open') ?? []) handler(new MessageEvent('open'));
            for (const handler of this.#listeners.get('job.updated') ?? [])
              handler(new MessageEvent('job.updated', { data: '{}' }));
          }, 5);
        }
        addEventListener(type: string, handler: (event: MessageEvent) => void): void {
          this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), handler]);
        }
        close(): void {
          this.#closed = true;
        }
      }
      vi.stubGlobal('EventSource', ReplayingEventSource as unknown as typeof EventSource);
      let runGets = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo | URL) => {
          if (String(input).endsWith('/api/runs/run_1')) runGets += 1;
          return Promise.resolve(
            new Response(JSON.stringify({ run: { ...RUN, status: 'running', steps: [...RUN.steps] } }), {
              status: 200,
            }),
          );
        }),
      );
      const host = await render(<WorkflowRunView runId="run_1" initial={{ ...RUN, status: 'running' }} />);
      for (let elapsed = 0; elapsed < 5000; elapsed += 50) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
      }
      expect(constructed).toBe(1);
      expect(runGets).toBeLessThanOrEqual(2);
      // UX-13: the header says the stream is live.
      expect(host.querySelector('[data-testid="run-stream"]')?.textContent).toBe('Live');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a stalled stream in the header so a view that stopped moving is visible (UX-13)', async () => {
    const host = await render(
      <RunHeader run={{ ...RUN, status: 'running' }} stream="stalled" onCancel={() => {}} />,
    );
    expect(host.querySelector('[data-testid="run-stream"]')?.textContent).toBe(
      'Live updates stopped · checking every 10 s',
    );
    const done = await render(
      <RunHeader run={{ ...RUN, status: 'completed' }} stream="live" onCancel={() => {}} />,
    );
    expect(done.querySelector('[data-testid="run-stream"]')).toBeNull();
  });
});
