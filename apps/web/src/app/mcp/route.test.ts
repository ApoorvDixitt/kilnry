// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-31: TRD-15 §7 limits /mcp to 120 requests a minute per token and answers a
// 429 with Retry-After. The proxy's rate-limit block only covers /api/*, and
// /mcp is not under it, so a client with a valid bearer could hammer the endpoint
// unthrottled. The limit is applied in this route, which is where the token's
// identity is known.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimits } from '../../server/rate-limit';

let handled = 0;

vi.mock('@kilnry/mcp', () => ({
  handleMcpRequest: async () => {
    handled += 1;
    return new Response('{"jsonrpc":"2.0","id":1,"result":{}}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
}));

vi.mock('../../server/mcp', () => ({
  authenticateMcp: async () => ({ id: 'token-under-test', scope: 'full' }),
  isAllowedMcpHost: () => true,
}));

// Everything past the limit is stubbed: the point of this test is the throttle,
// and none of it should be reached once the bucket is empty.
vi.mock('../../server/runtime', () => ({
  runtimeServices: async () => ({ database: {}, keyStore: { get: async () => undefined } }),
  ensureRuntimeEngine: async () => undefined,
}));
vi.mock('../../server/presets', () => ({ presetServices: async () => ({}) }));
vi.mock('../../server/skills', () => ({ skillRoots: async () => ({}) }));
vi.mock('../../server/training', () => ({ trainingRunner: async () => ({}) }));
vi.mock('../../server/voices', () => ({
  voiceCloner: async () => ({}),
  voiceDeleter: async () => ({}),
  voicePreviewer: async () => ({}),
}));
vi.mock('../../server/library-export', () => ({ bundleExporter: async () => ({}) }));
vi.mock('../../server/workflows', () => ({ workflowRunner: async () => ({}) }));
vi.mock('@kilnry/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@kilnry/core')>();
  return { ...original, libraryMarker: async () => null, loadConfig: () => ({}) };
});

import { POST } from './route';

function call(): Promise<Response> {
  return POST(
    new Request('http://127.0.0.1:3123/mcp', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3123',
        Authorization: 'Bearer kiln_fixture',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  );
}

beforeEach(() => {
  resetRateLimits();
  handled = 0;
});

afterEach(() => {
  resetRateLimits();
});

describe('POST /mcp (F-MCP-01, TRD-15 §7)', () => {
  it('answers 429 with Retry-After past 120 requests a minute for one token', async () => {
    for (let call_index = 1; call_index <= 120; call_index += 1) {
      const response = await call();
      expect(response.status, `call ${call_index}`).toBe(200);
    }
    const refused = await call();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0);
    // The refused request never reached the protocol handler.
    expect(handled).toBe(120);
  }, 60_000);
});
