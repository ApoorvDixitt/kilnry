// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError } from '@kilnry/core';
import { synthesizeSpeech } from '@kilnry/providers';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  provider: z.string(),
  voice_id: z.string(),
  text: z.string().max(200).optional(),
});

const SAMPLE = 'Hello from Kilnry. This is how this voice sounds.';

// Preview a voice (F-VOI-01). When an ElevenLabs key is connected, the route
// synthesises a short sample with the chosen voice and returns it inline as a
// data URI the Voices tab can play. Other providers' previews arrive with their
// own synthesis paths; until then the route says so plainly rather than
// pretending. The sample text is short and fixed, so a preview costs a few
// cents at most.
export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = Body.parse(await request.json());
    if (body.provider !== 'elevenlabs')
      throw new KilnryError(
        'NO_PROVIDER',
        `Previews for ${body.provider} voices arrive with that provider's synthesis path. Connect an ElevenLabs key to preview ElevenLabs voices now.`,
      );
    const services = await runtimeServices();
    const key = await services.keyStore.get('elevenlabs');
    if (!key)
      throw new KilnryError('NO_PROVIDER', 'Connect an ElevenLabs key in Settings › Providers to preview.');
    const audio = await synthesizeSpeech({
      key,
      voice_id: body.voice_id,
      text: body.text ?? SAMPLE,
    });
    const base64 = Buffer.from(audio.bytes).toString('base64');
    return NextResponse.json({ mime: audio.mime, audio_data_uri: `data:${audio.mime};base64,${base64}` });
  } catch (error) {
    return errorResponse(error);
  }
}
