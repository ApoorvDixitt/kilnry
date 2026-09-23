// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Read the spend ledger grouped by one dimension for the Budget page's ledger
// view (F-PRV-05). It reads the spend_ledger record of what finished jobs cost
// and groups it by provider, model, folder, character or day, heaviest first.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { spendLedgerGrouped, type LedgerGroupBy } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GroupBy = z.enum(['provider', 'model', 'folder', 'character', 'day']);

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession();
    const url = new URL(request.url);
    const parsed = GroupBy.safeParse(url.searchParams.get('group_by'));
    const groupBy: LedgerGroupBy = parsed.success ? parsed.data : 'provider';
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const to = toParam ? new Date(toParam) : new Date();
    const from = fromParam ? new Date(fromParam) : new Date(to.getFullYear(), to.getMonth(), 1);
    const services = await runtimeServices();
    const groups = await spendLedgerGrouped(services.database, { from, to, group_by: groupBy });
    return NextResponse.json({ group_by: groupBy, groups });
  } catch (error) {
    return errorResponse(error);
  }
}
