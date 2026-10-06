// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The observed network state the OfflineBar reads on every page (PRD-15 §Offline,
// D-70). It is the engine's own observation — a provider request that failed to
// reach the network, or one that succeeded — persisted so every route handler
// sees the same answer (F-117). Nothing here probes the network.

import { NextResponse } from 'next/server';
import { networkOfflineSince } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../server/http';
import { runtimeServices } from '../../../server/runtime';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    const offlineSince = await networkOfflineSince(services.database);
    return NextResponse.json({
      online: offlineSince === null,
      ...(offlineSince === null ? {} : { offline_since: offlineSince }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
