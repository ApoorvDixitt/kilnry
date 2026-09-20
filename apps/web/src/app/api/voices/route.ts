// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { listVoices, type VoiceFilter } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../server/http';
import { runtimeServices } from '../../../server/runtime';

// List voices for the Voices tab (F-VOI-01): the shipped provider presets merged
// with the user's cloned voices, filtered by provider, language, gender or type.
export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession();
    const params = new URL(request.url).searchParams;
    const filter: VoiceFilter = {
      ...(params.get('provider') ? { provider: params.get('provider')! } : {}),
      ...(params.get('language') ? { language: params.get('language')! } : {}),
      ...(params.get('gender') ? { gender: params.get('gender')! } : {}),
      ...(params.get('type') === 'preset' || params.get('type') === 'clone'
        ? { type: params.get('type') as 'preset' | 'clone' }
        : {}),
      ...(params.get('q') ? { query: params.get('q')! } : {}),
    };
    const services = await runtimeServices();
    const items = await listVoices(services.database, filter);
    return NextResponse.json({ voices: items });
  } catch (error) {
    return errorResponse(error);
  }
}
