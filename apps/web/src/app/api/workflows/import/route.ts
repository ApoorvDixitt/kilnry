// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Import a workflow from pasted or dropped YAML (F-WFL-06). The YAML is validated
// through the same validator the kilnry workflows validate command uses, so a
// file that would fail the command is refused here with the same rule messages;
// a valid file is written to the user's workflow folder and appears in the
// catalogue.

import { NextResponse } from 'next/server';
import { loadConfig } from '@kilnry/core';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../server/http';
import { importWorkflow } from '../../../../server/workflows';

const ImportInput = z.object({ yaml: z.string().min(1).max(262_144), file_name: z.string().optional() });

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = ImportInput.parse(await request.json());
    const config = await loadConfig();
    const result = importWorkflow(config.data_dir, body.yaml, body.file_name);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return errorResponse(error);
  }
}
