// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// D-71c: /api/events frames every event with a name, so a listener subscribes by
// name. The shell's Jobs badge used an unnamed 'message' handler, which never
// fired once — the count froze at whatever it was on mount (the gap task 6
// recorded).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// next/link reads Node's process.env at import; the browser has no process.
vi.hoisted(() => {
  const scope = globalThis as unknown as { process?: { env: Record<string, string> } };
  scope.process ??= { env: {} };
});

// The real module is a Next server/client boundary; the shell only needs the
// current path and a router that does nothing in a unit environment.
vi.mock('next/navigation', () => ({
  __esModule: true,
  default: {},
  usePathname: (): string => '/create',
  useRouter: (): { push: () => void; refresh: () => void } => ({
    push: () => undefined,
    refresh: () => undefined,
  }),
  useSearchParams: (): URLSearchParams => new URLSearchParams(),
}));

const listeners = new Map<string, Array<() => void>>();

class FakeEventSource {
  constructor(public url: string) {}
  addEventListener(type: string, handler: () => void): void {
    listeners.set(type, [...(listeners.get(type) ?? []), handler]);
  }
  close(): void {}
}

let activeJobs = 1;
let jobFetches = 0;

beforeEach(() => {
  listeners.clear();
  activeJobs = 1;
  jobFetches = 0;
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/jobs')) {
      jobFetches += 1;
      return Response.json({
        jobs: Array.from({ length: activeJobs }, (_unused, index) => ({
          id: `job-${index}`,
          status: 'running',
        })),
      });
    }
    if (url.includes('/api/budget')) return Response.json({ budgets: [] });
    return Response.json({});
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function render(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<AppShell>{null}</AppShell>));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  return host;
}

describe('the shell Jobs badge (F-JOB-01, D-71c)', () => {
  it('subscribes to the named job events, not the unnamed message event', async () => {
    await render();
    expect(listeners.has('message')).toBe(false);
    for (const type of ['job.updated', 'job.completed', 'job.failed', 'job.moderated'])
      expect(listeners.has(type), type).toBe(true);
  });

  it('re-reads the job list when a named job event arrives', async () => {
    await render();
    const onMount = jobFetches;
    expect(onMount).toBeGreaterThan(0);
    await act(async () => {
      for (const handler of listeners.get('job.completed') ?? []) handler();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(jobFetches).toBeGreaterThan(onMount);
  });
});
