// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import * as z from 'zod';
import { KilnryError } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';

const Body = z.object({
  provider: z.string(),
  voice_id: z.string(),
  text: z.string().max(200).optional(),
});

// Preview a voice (F-VOI-01). Speech synthesis runs through the text-to-speech
// adapters, which arrive in the next milestone; until then the tab lists and
// prices every voice and this route reports plainly that previews are not yet
// available rather than pretending to synthesise.
export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    Body.parse(await request.json());
    throw new KilnryError('NO_PROVIDER', 'Voice previews arrive with the text-to-speech adapters.');
  } catch (error) {
    return errorResponse(error);
  }
}
