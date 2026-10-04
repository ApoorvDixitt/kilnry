// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDiagnosticsFiles, diagnosticsZipName } from './diagnostics.js';

const dirs: string[] = [];
afterEach(() => {
  // Staging dirs are OS temp; left for the OS to reap. No action needed.
  dirs.length = 0;
});

function stageDataDir(logLine: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kilnry-diag-test-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'logs'), { recursive: true });
  writeFileSync(join(dir, 'logs', 'kilnry.log'), logLine, 'utf8');
  return dir;
}

describe('diagnostics bundle (F-SET-11)', () => {
  it('contains no stored key prefix and no generation prompt value', () => {
    const key = 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef';
    const dataDir = stageDataDir(
      `{"level":"info","msg":"generate","prompt":"a cat astronaut, cinematic","model":"flux"}\n` +
        `{"level":"info","Authorization":"Bearer ${key}"}\n`,
    );
    const files = buildDiagnosticsFiles({
      dataDir,
      doctor: { checks: [{ id: 'node.version', status: 'pass' }] },
      config: { data_dir: dataDir, provider_keys: { fal: key }, library_root: '/home/u/Kilnry' },
      snapshotAges: [{ model: 'fal:flux', fetched_at: '2026-01-01T00:00:00.000Z' }],
    });
    const blob = Object.values(files).join('\n');

    // The acceptance: no string matching any stored key prefix, no prompt value.
    expect(blob).not.toContain('sk-or-v1-0123456789abcdef');
    expect(blob).not.toContain('a cat astronaut, cinematic');
    // The prompt key is kept but its value is redacted.
    expect(files['logs/kilnry.log']).toContain('[redacted-prompt]');
    // The non-secret facts survive so the bundle is useful.
    expect(blob).toContain('/home/u/Kilnry');
    expect(blob).toContain('fal:flux');
    expect(files['doctor.json']).toContain('node.version');
  });

  it('names the zip by date', () => {
    expect(diagnosticsZipName(new Date('2026-10-05T12:00:00Z'))).toBe('diagnostics-2026-10-05.zip');
  });
});
