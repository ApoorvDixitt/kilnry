// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The workflow runs list (F-WFL-03). Every run the user has started, newest
// first, with its workflow, status and spend so far.

import { NextResponse } from 'next/server';
import { errorResponse, requireSession } from '../../../server/http';
import { runtimeServices } from '../../../server/runtime';
import { listRuns } from '../../../server/workflows';

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    return NextResponse.json({ runs: await listRuns(services.database) });
  } catch (error) {
    return errorResponse(error);
  }
}
