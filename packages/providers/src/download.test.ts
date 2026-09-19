// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdapterContext, ProviderResult } from '@kilnry/core';
import { downloadOutputs } from './download.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('provider output download', () => {
  it('streams to a durable partial file and resumes with Range after a broken body', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-download-'));
    roots.push(root);
    const expected = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    let call = 0;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        expect(new Headers(init?.headers).has('range')).toBe(false);
        let sent = false;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (!sent) {
                  sent = true;
                  controller.enqueue(expected.slice(0, 4));
                  return;
                }
                controller.error(new Error('fixture connection reset'));
              },
            }),
            {
              status: 200,
              headers: { 'Accept-Ranges': 'bytes', 'Content-Type': 'image/png' },
            },
          ),
        );
      }
      expect(new Headers(init?.headers).get('range')).toBe('bytes=4-');
      return Promise.resolve(
        new Response(expected.slice(4), {
          status: 206,
          headers: { 'Accept-Ranges': 'bytes', 'Content-Type': 'image/png' },
        }),
      );
    });
    const context: AdapterContext = {
      key: 'fixture',
      fetch: fetchMock,
      signal: new AbortController().signal,
      temp_dir: root,
      log: () => undefined,
    };
    const result: ProviderResult = { outputs: [{ kind: 'image', url: 'https://media.example/output' }] };
    const downloaded = await downloadOutputs('fal', result, context);
    expect(call).toBe(2);
    expect(downloaded[0]?.bytes).toBeUndefined();
    expect(downloaded[0]?.path).toBe(join(root, 'output-0.part'));
    expect(readFileSync(downloaded[0]!.path!)).toEqual(Buffer.from(expected));
  });
});
