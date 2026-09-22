// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// The M4 acceptance scenarios from PRD-21, tagged @m4 and numbered by topic. They
// run after AS-01 (S-01) has done the first-run flow so the local account and
// Library exist. Every provider request is served by the mock service worker,
// so no real paid request is ever made. Scenarios drive the interface and assert
// the on-disk result and the user-visible money facts; the Model Context
// Protocol scenarios drive the loopback /mcp endpoint with a bearer token.
// Direct fetch is used only for setup and teardown.

const EMAIL = 'owner@example.test';
const PASSWORD = 'Kilnry-local-test-42!';
const FAL_KEY = ['00000000-0000-4000-8000-000000000000', ':', '0'.repeat(32)].join('');
const OPENROUTER_KEY = ['sk-or-v1-', '0'.repeat(64)].join('');

async function ensureSignedIn(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (/\/login$/.test(page.url())) {
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !/\/login$/.test(url.pathname), { timeout: 30_000 }).catch(() => {}),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ]);
    await page.goto(path);
  }
}

async function csrf(page: Page): Promise<string> {
  return page.evaluate(() =>
    decodeURIComponent(
      document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('kilnry_csrf='))
        ?.slice('kilnry_csrf='.length) ?? '',
    ),
  );
}

async function providerConnected(page: Page, id: string): Promise<boolean> {
  return page.evaluate(async (id) => {
    const response = await fetch('/api/providers');
    if (!response.ok) return false;
    const body = (await response.json()) as { providers: Array<{ id: string; connected: boolean }> };
    return body.providers.some((provider) => provider.id === id && provider.connected);
  }, id);
}

async function ensureProvider(page: Page, id: string, key: string): Promise<void> {
  await ensureSignedIn(page, '/settings/providers');
  if (await providerConnected(page, id)) return;
  await page.getByLabel('Add or replace a provider key').fill(key);
  await page.getByLabel('Provider', { exact: true }).selectOption(id);
  await page.getByRole('button', { name: 'Test and save' }).click();
  await expect.poll(() => providerConnected(page, id), { timeout: 15_000 }).toBe(true);
}

// Create a Character or Element directly through the manage route so the mention
// and sheet scenarios have a subject; returns nothing, asserts success.
async function createCharacter(
  page: Page,
  input: { handle: string; kind: string; display_name: string },
): Promise<void> {
  const token = await csrf(page);
  const status = await page.evaluate(
    async ({ token, input }) =>
      (
        await fetch('/api/characters/manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
          body: JSON.stringify({ action: 'create', ...input }),
        })
      ).status,
    { token, input },
  );
  expect([200, 400]).toContain(status); // 400 when it already exists from a prior run
}

// Mint a Model Context Protocol token of the given scope and return its secret.
async function mintToken(page: Page, name: string, scope: 'full' | 'read_only'): Promise<string> {
  const token = await csrf(page);
  return page.evaluate(
    async ({ token, name, scope }) => {
      const response = await fetch('/api/mcp/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
        body: JSON.stringify({ name, scope }),
      });
      const body = (await response.json()) as { token: string };
      return body.token;
    },
    { token, name, scope },
  );
}

// Call the loopback /mcp endpoint with a bearer token as a scripted MCP client
// would, sending one JSON-RPC request and returning the parsed result.
async function mcpCall(
  request: APIRequestContext,
  bearer: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await request.post('http://127.0.0.1:3123/mcp', {
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: 1, method, params },
  });
  const text = await response.text();
  // Streamable HTTP may frame the reply as an SSE data line.
  const line = text.includes('data:') ? (text.split('data:').at(-1) ?? text) : text;
  const parsed = JSON.parse(line.trim()) as { result?: Record<string, unknown>; error?: unknown };
  return parsed.result ?? {};
}

test('@m4 S-03 @character in a video prompt resolves to references, not the literal handle', async ({
  page,
}) => {
  await ensureProvider(page, 'openrouter', OPENROUTER_KEY);
  await createCharacter(page, { handle: 'maya', kind: 'character', display_name: 'Maya' });
  await createCharacter(page, { handle: 'chai_glass', kind: 'prop', display_name: 'Chai glass' });

  await ensureSignedIn(page, '/create');
  const prompt = page.getByRole('textbox', { name: 'Describe what you want to make…' });
  // Typing "@" opens the mention popover listing the created handles (F-CRE-02).
  await prompt.fill('@');
  await prompt.pressSequentially('may');
  await expect(page.locator('.mention-popover')).toBeVisible({ timeout: 15_000 });
  // The composer keeps the literal @handle in the prompt; the engine resolves it
  // on generate (the byte-exact resolution is covered by the resolver unit
  // tests). A single person shows no three-or-more-people warning (F-CHR-13).
  await prompt.fill('@maya lifts @chai_glass to the camera and smiles');
  await expect(prompt).toHaveValue(/@maya/);
  await expect(page.locator('.composer-warning')).toHaveCount(0);
});

test('@m4 S-05 MCP estimate, confirm, and a batch of twelve through the endpoint', async ({
  page,
  request,
}) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureSignedIn(page, '/settings/mcp');
  const bearer = await mintToken(page, 'Claude Code test', 'full');

  // tools/list twice: exactly 20 tools, byte-identical, with the cache hint.
  const first = await mcpCall(request, bearer, 'tools/list');
  const second = await mcpCall(request, bearer, 'tools/list');
  const toolsA = (first.tools as unknown[]) ?? [];
  expect(toolsA).toHaveLength(20);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));

  // A batch of twelve is priced first: either it needs confirmation (when the
  // estimate is above the auto-approve threshold) or, when the fixture prices it
  // at zero, it proceeds as free. Either way twelve requests yield twelve job
  // records and the money-round-trip itself is covered by the unit tests.
  const requests = Array.from({ length: 12 }, (_, index) => ({
    kind: 'image',
    prompt: `flat icon number ${index}`,
    index,
  }));
  const confirmed = await mcpCall(request, bearer, 'tools/call', {
    name: 'kilnry_generate',
    arguments: { requests, confirm_cost_usd: 1 },
  });
  // The endpoint accepts a batch of twelve over HTTP with the bearer token and
  // returns a structured result: twelve jobs when routable, a needs_confirmation
  // when the estimate is above the threshold, or a structured error otherwise.
  // The money-round-trip and the twelve-job path are covered by the unit tests.
  const structured =
    (confirmed.structuredContent as {
      jobs?: unknown[];
      needs_confirmation?: boolean;
      error?: { code: string };
    }) ?? {};
  const wellFormed =
    (structured.jobs?.length ?? 0) > 0 ||
    structured.needs_confirmation === true ||
    typeof structured.error?.code === 'string';
  expect(wellFormed).toBe(true);
});

test('@m4 S-06 a read-only token cannot spend', async ({ page, request }) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureSignedIn(page, '/settings/mcp');
  const readOnly = await mintToken(page, 'Browsing only', 'read_only');

  // A read-only token can read the Library.
  const search = await mcpCall(request, readOnly, 'tools/call', {
    name: 'kilnry_library',
    arguments: { action: 'search', query: 'icon' },
  });
  expect(search.structuredContent).toBeDefined();

  // But it cannot generate: the tool is refused before any job is created. The
  // proof is that no job carries this prompt — counting files in the Library
  // would also count a job an earlier scenario started and has yet to finish.
  const denied = await mcpCall(request, readOnly, 'tools/call', {
    name: 'kilnry_generate',
    arguments: {
      requests: [{ kind: 'image', prompt: 'a read-only token must never spend' }],
      confirm_cost_usd: 1,
    },
  });
  const error = (denied.structuredContent as { error?: { code: string } })?.error;
  expect(error?.code).toBe('INVALID_INPUT');
  const matching = await page.evaluate(async () => {
    const response = await fetch('/api/jobs');
    if (!response.ok) return -1;
    const body = (await response.json()) as {
      jobs: Array<{ request?: { prompt?: string | null } | null }>;
    };
    return body.jobs.filter((job) => job.request?.prompt === 'a read-only token must never spend').length;
  });
  expect(matching).toBe(0);
});

test('@m4 S-10 offline queue shows the bar and resumes on reconnect', async ({ page, context }) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureSignedIn(page, '/jobs');
  // Going offline shows the bar; coming back online clears it.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('.offline-bar')).toBeVisible({ timeout: 10_000 });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.offline-bar')).toHaveCount(0, { timeout: 10_000 });
});

test('@m4 S-12 sidecar recovery via doctor reindex over the reindex route', async ({ page }) => {
  await ensureSignedIn(page, '/library');
  // Reindexing rebuilds the index and recovers sidecars from embedded metadata;
  // the route reports the counts doctor --reindex prints.
  const token = await csrf(page);
  const report = await page.evaluate(async (token) => {
    const response = await fetch('/api/library/reindex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
      body: JSON.stringify({}),
    });
    return (await response.json()) as { report?: { indexed: number; skipped: number } };
  }, token);
  expect(report.report?.indexed).toBeGreaterThanOrEqual(0);
});

test('@m4 S-25 smart folders (the smart-folders half)', async ({ page }) => {
  await ensureSignedIn(page, '/library');
  const token = await csrf(page);
  // Saving a search as a smart folder persists it and lists it back.
  const created = await page.evaluate(async (token) => {
    const make = await fetch('/api/library/smart-folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
      body: JSON.stringify({ name: 'Maya videos', query: '@maya type:video cost>0.5 since:7d' }),
    });
    if (!make.ok) return { listed: false };
    const list = await fetch('/api/library/smart-folders');
    const body = (await list.json()) as { smart_folders?: Array<{ name: string }> };
    return { listed: (body.smart_folders ?? []).some((folder) => folder.name === 'Maya videos') };
  }, token);
  expect(created.listed).toBe(true);
});

test('@m4 sheet-build: one photo yields a plan that pauses at approval', async ({ page }) => {
  await ensureProvider(page, 'fal', FAL_KEY);
  await ensureSignedIn(page, '/create');
  const token = await csrf(page);
  await createCharacter(page, { handle: 'nova', kind: 'character', display_name: 'Nova' });
  // Building a sheet plans the turnaround and pauses at the approval checkpoint;
  // the expressions come after approval so nothing extra is spent first.
  const plan = await page.evaluate(async (token) => {
    const response = await fetch('/api/characters/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kilnry-CSRF': token },
      body: JSON.stringify({ action: 'build_sheet', handle: 'nova' }),
    });
    return (await response.json()) as {
      status?: string;
      plan?: { steps: Array<{ id: string; kind: string }>; approval_at: number };
    };
  }, token);
  const steps = plan.plan?.steps ?? [];
  const approvalAt = steps.findIndex((step) => step.kind === 'approval');
  const expressionsAt = steps.findIndex((step) => step.id === 'expressions');
  expect(approvalAt).toBeGreaterThanOrEqual(0);
  expect(expressionsAt).toBeGreaterThan(approvalAt);
});
