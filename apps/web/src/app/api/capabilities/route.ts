// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { currentSession } from '../../../server/session';

export async function GET(): Promise<Response> {
  const session = await currentSession();
  if (!session)
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'authentication required' } },
      { status: 401 },
    );
  const docker = process.env.KILNRY_DOCKER === '1';
  return NextResponse.json({
    reveal: !docker,
    native_picker: !docker && process.platform === 'darwin',
    notifications: false,
    ollama: { detected: false },
    ffmpeg: { status: 'missing' },
    docker,
    platform: process.platform,
    lan: process.env.KILNRY_LAN === '1',
  });
}
