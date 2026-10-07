// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The first-run token as the server printed it ("Open this link to finish
// setup: http://127.0.0.1:3123/welcome?t=…"). The token file holds only the
// token's hash (PRD-04:16, F-68), so a scenario reads the printed link from the
// output e2e/serve.ts keeps in .dev/e2e-server.log, waiting for the boot to
// print it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function printedSetupToken(timeoutMs = 30_000): Promise<string> {
  const log = join(process.cwd(), '.dev', 'e2e-server.log');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let text = '';
    try {
      text = readFileSync(log, 'utf8');
    } catch {
      // Not written yet.
    }
    const tokens = [...text.matchAll(/\/welcome\?t=([A-Za-z0-9_-]{20,})/g)].map((match) => match[1]!);
    const last = tokens.at(-1);
    if (last) return last;
    if (Date.now() > deadline)
      throw new Error(`The server printed no setup link in ${log} within ${timeoutMs} ms.`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
