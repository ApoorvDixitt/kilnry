// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { listProviders } from '@kilnry/core';
import { adapters } from '@kilnry/providers';
import { errorResponse, requireSession } from '../../../server/http';
import { runtimeServices } from '../../../server/runtime';

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    return NextResponse.json({ providers: await listProviders(services.database, adapters) });
  } catch (error) {
    return errorResponse(error);
  }
}
