// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Spend-ledger CSV export (F-PRV-05). It writes one comma-separated row per job
// for a period to <Library>/.kilnry/exports/spend_<from>_<to>.csv, UTF-8, with
// the fixed PRD-14 §6 columns and actual costs to four decimals, and returns the
// path plus the CSV text so the page can offer a download.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError, loadConfig, spendLedgerCsv, spendLedgerEntries } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../../server/http';
import { runtimeServices } from '../../../../../server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = Body.parse(await request.json().catch(() => ({})));
    const to = body.to ? new Date(body.to) : new Date();
    const from = body.from ? new Date(body.from) : new Date(to.getFullYear(), to.getMonth(), 1);
    const config = loadConfig();
    if (!config.library_root)
      throw new KilnryError('NOT_FOUND', 'Set a Library root before exporting the spend ledger.');
    const services = await runtimeServices();
    const rows = await spendLedgerEntries(services.database, { from, to });
    const csv = spendLedgerCsv(rows);
    const exportsDir = join(config.library_root, '.kilnry', 'exports');
    await mkdir(exportsDir, { recursive: true, mode: 0o700 });
    const name = `spend_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.csv`;
    const path = join(exportsDir, name);
    await writeFile(path, csv, { encoding: 'utf8', mode: 0o600 });
    return NextResponse.json({ path, rows: rows.length, csv });
  } catch (error) {
    return errorResponse(error);
  }
}
