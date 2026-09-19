// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { checklistStatus } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    const status = await checklistStatus(services.database);
    return NextResponse.json({ checklist: status });
  } catch (error) {
    return errorResponse(error);
  }
}
