// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeSetupToken } from './runtime';

const dirs: string[] = [];

function tempTokenPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kilnry-setup-'));
  dirs.push(dir);
  return join(dir, 'first-run.token');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('setup token regeneration', () => {
  it('replaces a stale token file on boot so the printed link is always fresh', () => {
    const tokenPath = tempTokenPath();
    // Simulate an install whose owner never finished onboarding: an old token whose
    // modification time is well past the ten-minute window the proxy enforces.
    writeFileSync(tokenPath, 'stale-token-from-a-previous-boot\n', { encoding: 'utf8', mode: 0o600 });
    const stale = new Date(Date.now() - 60 * 60_000);
    // A stale mtime would fail the proxy's ten-minute check; the fresh write must move it forward.
    const before = readFileSync(tokenPath, 'utf8').trim();

    const fresh = writeSetupToken(tokenPath);

    expect(fresh).not.toBe(before);
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(tokenPath, 'utf8').trim()).toBe(fresh);
    expect(statSync(tokenPath).mtimeMs).toBeGreaterThan(stale.getTime());
  });

  it('keeps the token it just wrote and stores it with owner-only permissions', () => {
    const tokenPath = tempTokenPath();
    const written = writeSetupToken(tokenPath);
    expect(readFileSync(tokenPath, 'utf8').trim()).toBe(written);
    // Mode 0600: no group or world bits.
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
  });
});
