// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The community-skill install route (F-SKL-03, TRD-13 §7). These cases drive the
// HTTP boundary: a clean dropped skill installs and lands under the data dir; a
// dropped skill carrying an executable script is refused with the exact message
// and nothing is written.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../../../server/http', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../server/http')>();
  return {
    ...original,
    requireSession: async () => ({ user: { id: 'owner' }, session: { id: 'session' } }),
  };
});

import { POST } from './route';

const SKILL_MD = `---
name: acme-helper
description: A community skill for testing the installer. Use when a test needs a valid skill.
license: MIT
metadata:
  version: 1.0.0
  kilnry:
    version: 1.0.0
---

# acme-helper

A short body.
`;

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'kilnry-skill-route-'));
  process.env.KILNRY_DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.KILNRY_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function post(body: unknown): Promise<Response> {
  return POST(
    new Request('http://127.0.0.1:3123/api/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/skills/install (F-SKL-03)', () => {
  it('installs a clean dropped skill under the data directory', async () => {
    const response = await post({ files: [{ path: 'SKILL.md', content: SKILL_MD }] });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { ok: boolean; name?: string };
    expect(result.ok).toBe(true);
    expect(result.name).toBe('acme-helper');
    expect(existsSync(join(dataDir, 'skills', 'acme-helper', 'SKILL.md'))).toBe(true);
  }, 30_000);

  it('refuses a dropped skill with an executable script and writes nothing', async () => {
    const response = await post({
      files: [
        { path: 'SKILL.md', content: SKILL_MD },
        { path: 'scripts/run.py', content: 'print(1)' },
      ],
    });
    expect(response.status).toBe(422);
    const result = (await response.json()) as {
      ok: boolean;
      issues: Array<{ rule: string; message: string }>;
    };
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('does not run skill scripts'))).toBe(true);
    expect(existsSync(join(dataDir, 'skills', 'acme-helper'))).toBe(false);
  }, 30_000);
});
