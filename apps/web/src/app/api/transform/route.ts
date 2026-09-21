// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError, type Capability } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../server/http';
import { ensureRuntimeEngine } from '../../../server/runtime';

const Body = z.object({
  op: z.enum([
    'upscale_image',
    'upscale_video',
    'bg_remove',
    'reframe',
    'outpaint',
    'lipsync',
    'dubbing',
    'voice_change',
    'transcribe',
  ]),
  source: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  confirm_cost_usd: z.number().optional(),
  estimate_only: z.boolean().optional(),
  client_request_id: z.string().optional(),
});

// The transform operations backed by a routable, seeded capability. Dubbing and
// voice change have no capability in the registry yet (F-CRE-11, TRD-10 §3.2).
const CAPABILITY_FOR: Partial<Record<string, Capability>> = {
  upscale_image: 'upscale_image',
  upscale_video: 'upscale_video',
  bg_remove: 'bg_remove',
  reframe: 'reframe_image',
  outpaint: 'outpaint',
  lipsync: 'lipsync',
  transcribe: 'stt',
};

const KIND_FOR: Record<string, 'image' | 'video' | 'audio'> = {
  upscale_video: 'video',
  lipsync: 'video',
  transcribe: 'audio',
};

// Run a provider-billed transform on one Library asset (F-CRE-11). It estimates
// through the same engine the composer uses and only spends after a confirmed
// cost; the output is written next to the source with its lineage.
export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = Body.parse(await request.json());
    const capability = CAPABILITY_FOR[body.op];
    if (!capability) {
      throw new KilnryError('NO_PROVIDER', 'Dubbing and voice change arrive in a later milestone.');
    }
    const engine = await ensureRuntimeEngine();
    const canonical = {
      kind: KIND_FOR[body.op] ?? 'image',
      capability,
      prompt: body.op,
      params: body.params ?? {},
      medias: [{ role: 'source', asset_id: body.source }],
      count: 1,
      injections: [],
      target_folder: 'inbox',
      source: 'ui',
    };
    const priced = await engine.estimate(canonical as never, {});
    const usd = priced.estimate.authoritative_usd ?? priced.estimate.estimate_usd;
    if (body.estimate_only) {
      return NextResponse.json({ estimate: priced.estimate, estimate_usd: usd });
    }
    const result = await engine.createJob({
      request: canonical as never,
      ...(body.confirm_cost_usd === undefined ? {} : { confirmed_cost_usd: body.confirm_cost_usd }),
      confirmed_by: 'user',
      ...(body.client_request_id === undefined ? {} : { client_request_id: body.client_request_id }),
    });
    return NextResponse.json({ jobs: [result], total_estimate_usd: result.estimate.estimate_usd });
  } catch (error) {
    return errorResponse(error);
  }
}
