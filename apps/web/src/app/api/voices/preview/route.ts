// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../server/http';
import { voicePreviewer } from '../../../../server/voices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  provider: z.string(),
  voice_id: z.string(),
  text: z.string().max(200).optional(),
});

// Preview a voice (F-VOI-01). The preview is priced through the estimator,
// checked against the budget caps and recorded as one spend-ledger row before
// the sample is synthesised, so even a few-cent preview shows up in the budget.
// The audio is returned inline as a data URI the Voices tab can play. Previews
// for providers without a wired synthesis path return a plain not-available
// message rather than pretending.
export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = Body.parse(await request.json());
    const previewer = await voicePreviewer();
    const result = await previewer.preview({
      provider: body.provider,
      voiceId: body.voice_id,
      ...(body.text ? { text: body.text } : {}),
    });
    const base64 = Buffer.from(result.bytes).toString('base64');
    return NextResponse.json({
      mime: result.mime,
      audio_data_uri: `data:${result.mime};base64,${base64}`,
      estimate_usd: result.estimate_usd,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
