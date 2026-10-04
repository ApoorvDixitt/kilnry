// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// runMediaProcess must return the child's whole stdout. Settling on 'exit'
// loses the tail of a large write because the stdio pipes can still hold data
// when 'exit' fires; this fails if the process settles before 'close'.

import { describe, expect, it } from 'vitest';
import { runMediaProcess } from './process.js';

describe('runMediaProcess', () => {
  it('returns the complete stdout of a 4 MiB write', async () => {
    const result = await runMediaProcess(process.execPath, [
      '-e',
      "process.stdout.write('a'.repeat(4 * 1024 * 1024))",
    ]);
    expect(result.stdout.length).toBe(4194304);
  });

  it('rejects a non-zero exit with the stderr tail', async () => {
    await expect(
      runMediaProcess(process.execPath, ['-e', "process.stderr.write('boom-tail'); process.exit(3)"]),
    ).rejects.toThrow(/exited with 3: boom-tail/);
  });
});
