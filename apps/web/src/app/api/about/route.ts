// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The About page's data (F-SET-11, PRD-16 §11). GET returns the build facts and
// the licence summary. POST { action: 'notices' } reads the generated
// THIRD_PARTY_NOTICES.md (production dependencies with their licences). POST
// { action: 'diagnostics' } writes ~/.kilnry/logs/diagnostics-<date>.zip — the
// doctor report, the redacted config, the last two prompt-scrubbed logs and the
// registry snapshot ages — and returns its path. Everything is read locally.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import {
  aboutInfo,
  buildDiagnosticsFiles,
  diagnosticsZipName,
  loadConfig,
  parseThirdPartyNotices,
} from '@kilnry/core';
import { errorResponse, requireSession } from '../../../server/http';
import { gatherDiagnostics } from '../../../server/about';

const Body = z.object({ action: z.enum(['notices', 'diagnostics']) });

// THIRD_PARTY_NOTICES.md ships beside the server. Try the repo/standalone root
// first (cwd), then walk up from this module so dev and a packaged build agree.
async function readNotices(): Promise<string> {
  const candidates = [join(process.cwd(), 'THIRD_PARTY_NOTICES.md')];
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    candidates.push(join(dir, 'THIRD_PARTY_NOTICES.md'));
    dir = dirname(dir);
  }
  for (const path of candidates) {
    const text = await readFile(path, 'utf8').catch(() => '');
    if (text) return text;
  }
  return '';
}

// Zip a staging folder with the system zip; resolve the written path.
function zipFolder(folder: string, zipPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('zip', ['-r', '-q', zipPath, '.'], { cwd: folder });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    return NextResponse.json({ info: aboutInfo() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = Body.parse(await request.json());
    if (body.action === 'notices') {
      return NextResponse.json({ packages: parseThirdPartyNotices(await readNotices()) });
    }

    // Diagnostics: build the scrubbed file set, stage it, zip into the logs dir.
    const config = loadConfig();
    const diagnostics = await gatherDiagnostics(config);
    const files = buildDiagnosticsFiles(diagnostics);
    const staging = await mkdtemp(join(tmpdir(), 'kilnry-diag-'));
    const zipPath = join(config.data_dir, 'logs', diagnosticsZipName());
    try {
      for (const [name, content] of Object.entries(files)) {
        const target = join(staging, name);
        await writeFile(target, content, 'utf8').catch(async () => {
          // Nested path (logs/<file>): create the directory then retry.
          const { mkdir } = await import('node:fs/promises');
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, content, 'utf8');
        });
      }
      const ok = await zipFolder(staging, zipPath);
      if (!ok) throw new Error('Could not create the diagnostics zip (is `zip` on the PATH?).');
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    return NextResponse.json({
      path: zipPath,
      note: 'The diagnostics zip contains no keys and no prompts. It lists file paths and model names.',
    });
  } catch (error) {
    return errorResponse(error);
  }
}
