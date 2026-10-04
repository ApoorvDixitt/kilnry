// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Serve the bundled LICENSE.md so "Read licence" opens the licence that ships
// with this build, with no egress to github.com (F-SET-11 acceptance, F-NFR-02).

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorResponse, requireSession } from '../../../../server/http';

async function readLicense(): Promise<string> {
  const candidates = [join(process.cwd(), 'LICENSE.md')];
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    candidates.push(join(dir, 'LICENSE.md'));
    dir = dirname(dir);
  }
  for (const path of candidates) {
    const text = await readFile(path, 'utf8').catch(() => '');
    if (text) return text;
  }
  return '';
}

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const text = await readLicense();
    return new Response(text || 'LICENSE.md was not found in this build.', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
