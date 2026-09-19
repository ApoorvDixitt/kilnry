// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { runtimeStatus, runtimeWorkerStatus, startRuntime } from '../../../server/runtime';

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
    version: process.env.npm_package_version ?? '0.0.0',
    uptime_s: Math.floor((Date.now() - startedAt) / 1000),
    db: 'ok',
    worker: runtimeWorkerStatus(),
    online: true,
    ready_at: status.readyAt,
  });
}
