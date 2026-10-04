// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The About page's data (F-SET-11). GET returns the version and build facts and
// the Sustainable Use License summary. POST { action: 'notices' } returns the
// third-party inventory generated from pnpm-lock.yaml; POST { action:
// 'diagnostics' } returns a redacted snapshot that carries no keys and no
// prompts (PRD-16 §11 acceptance). Everything is read locally; nothing is sent.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { aboutInfo, loadConfig, parseLockfilePackages, redact } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../server/http';

const Body = z.object({ action: z.enum(['notices', 'diagnostics']) });

// The lockfile sits at the monorepo root. In a packaged build it is bundled
// beside the server; walk up from the cwd to the first pnpm-lock.yaml.
async function readLockfile(): Promise<string> {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const text = await readFile(join(dir, 'pnpm-lock.yaml'), 'utf8').catch(() => '');
    if (text) return text;
    dir = join(dir, '..');
  }
  return '';
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
      return NextResponse.json({ packages: parseLockfilePackages(await readLockfile()) });
    }
    // Redacted diagnostics: the config with every secret masked. The config
    // holds no provider keys (they live in the encrypted store) and no prompts,
    // and redact() masks anything secret-shaped, so the snapshot carries neither.
    const config = loadConfig();
    return NextResponse.json({
      diagnostics: {
        info: aboutInfo(),
        config: redact(config),
        note: 'The diagnostics contain no keys and no prompts. They list file paths and model names.',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
