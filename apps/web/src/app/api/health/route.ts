// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { appVersion, isNetworkOnline } from '@kilnry/core';
import { runtimeStatus, runtimeWorkerStatus, startRuntime } from '../../../server/runtime';

// The answer carries the observed network state (F-117), so it must never be
// served from a cache.
export const dynamic = 'force-dynamic';

const startedAt = Date.now();

export async function GET(): Promise<Response> {
  try {
    await startRuntime();
  } catch {
    const status = runtimeStatus();
    return NextResponse.json({ ok: false, db: 'error', stage: status.stage }, { status: 503 });
  }
  const status = runtimeStatus();
  if (status.stage !== 'ready') return NextResponse.json({ ok: false, stage: status.stage }, { status: 503 });
  return NextResponse.json({
    ok: true,
    // appVersion() reads @kilnry/core's package.json through createRequire; the
    // production-build smoke asserts this equals that file, proving appVersion
    // survives @kilnry/core being bundled via transpilePackages (F-CHR-14).
    version: appVersion(),
    uptime_s: Math.floor((Date.now() - startedAt) / 1000),
    db: 'ok',
    worker: runtimeWorkerStatus(),
    // The observed network state (PRD-15 §Offline, D-70): the OfflineBar on
    // every page reads this, not navigator.onLine, which only shows the bar
    // early and never changes a job (F-117).
    online: isNetworkOnline(),
    ready_at: status.readyAt,
  });
}
