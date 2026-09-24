// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// One workflow, for the intake drawer (F-WFL-02). The drawer needs the whole
// definition — the inputs JSON Schema with its x-kilnry hints and the step list —
// which the catalogue list does not carry.

import { NextResponse } from 'next/server';
import { KilnryError, loadConfig } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { getWorkflow } from '../../../../server/workflows';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { id } = await context.params;
    const config = await loadConfig();
    const entry = getWorkflow(config.data_dir, id);
    if (!entry) throw new KilnryError('NOT_FOUND', `No workflow called ${id} is installed.`);
    return NextResponse.json({ workflow: entry.workflow });
  } catch (error) {
    return errorResponse(error);
  }
}
