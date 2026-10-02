// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { eq } from 'drizzle-orm';
import { KilnryError, type Capability } from '@kilnry/core';
import { assets } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../server/http';
import { ensureRuntimeEngine, runtimeServices } from '../../../server/runtime';

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
    'image_to_3d',
  ]),
  source: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  confirm_cost_usd: z.number().optional(),
  estimate_only: z.boolean().optional(),
  client_request_id: z.string().optional(),
});

// The transform operations backed by a routable, seeded capability. Dubbing and
// voice change route to text-to-speech-capability models the registry tags, so
// they carry the tts capability and a tag constraint (F-CRE-11, TRD-07 §1).
const CAPABILITY_FOR: Partial<Record<string, Capability>> = {
  upscale_image: 'upscale_image',
  upscale_video: 'upscale_video',
  bg_remove: 'bg_remove',
  reframe: 'reframe_image',
  outpaint: 'outpaint',
  lipsync: 'lipsync',
  dubbing: 'tts',
  voice_change: 'tts',
  transcribe: 'stt',
  image_to_3d: '3d',
};

// Image → 3D offers Trellis as the default and Hunyuan3D v3 as premium
// (PRD-05 §15); the panel's choice pins the route to that fal model.
const THREE_D_MODEL: Record<string, string> = {
  trellis: 'fal/fal-ai/trellis',
  hunyuan3d: 'fal/fal-ai/hunyuan3d-v3/image-to-3d',
};

// Dubbing and voice change are tts models distinguished by a registry tag; the
// route pins the specific model and passes the tag so the router picks it.
const TRANSFORM_TAG: Record<string, string> = {
  dubbing: 'dubbing',
  voice_change: 'voice_change',
};
const TRANSFORM_MODEL: Record<string, string> = {
  dubbing: 'dubbing_v2',
  voice_change: 'voice_changer',
};

const KIND_FOR: Record<string, 'image' | 'video' | 'audio' | '3d'> = {
  upscale_video: 'video',
  lipsync: 'video',
  dubbing: 'audio',
  voice_change: 'audio',
  transcribe: 'audio',
  image_to_3d: '3d',
};

// The media role the source takes for each operation. A lip-sync or upscale reads
// the source as a video, transcription, dubbing and voice change read it as
// audio, and the image operations take it as the reference to work from.
const SOURCE_ROLE: Record<string, 'video' | 'audio' | 'reference'> = {
  upscale_video: 'video',
  lipsync: 'video',
  dubbing: 'audio',
  voice_change: 'audio',
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
      throw new KilnryError('NO_PROVIDER', `The ${body.op} operation has no routable capability.`);
    }
    const engine = await ensureRuntimeEngine();
    // The panel's own inputs — the audio to speak and how long the clip is — become
    // a media input and a duration, which is what the estimator and the adapters
    // read. Whatever else it sent travels as provider extras.
    const supplied = { ...(body.params ?? {}) };
    const audio = typeof supplied.audio === 'string' ? supplied.audio.trim() : '';
    const clipSeconds = typeof supplied.clip_seconds === 'number' ? supplied.clip_seconds : undefined;
    const aspectRatio = typeof supplied.aspect_ratio === 'string' ? supplied.aspect_ratio : undefined;
    delete supplied.audio;
    delete supplied.clip_seconds;
    delete supplied.aspect_ratio;
    // Dubbing and voice change pin the tagged text-to-speech model so the adapter
    // runs the right endpoint (F-CRE-11).
    const pinnedModel = TRANSFORM_MODEL[body.op];
    if (pinnedModel) supplied.model = pinnedModel;
    const tag = TRANSFORM_TAG[body.op];
    const constraints: Record<string, unknown> = tag ? { tags: [tag] } : {};
    // Image → 3D: the panel's model choice pins the fal route, and the GLB is
    // written in the source image's folder (PRD-05 §15).
    let targetFolder = 'inbox';
    if (body.op === 'image_to_3d') {
      const choice = typeof supplied.model3d === 'string' ? supplied.model3d : 'trellis';
      delete supplied.model3d;
      const pinned = THREE_D_MODEL[choice];
      if (!pinned) throw new KilnryError('INVALID_INPUT', `Unknown 3D model ${choice}.`);
      constraints.pinned_model = pinned;
      const services = await runtimeServices();
      const [row] = await services.database.db
        .select({ folderPath: assets.folderPath })
        .from(assets)
        .where(eq(assets.id, body.source))
        .limit(1);
      if (!row) throw new KilnryError('NOT_FOUND', 'The source image is not in the Library.');
      if (row.folderPath) targetFolder = row.folderPath;
    }
    const medias: Array<{ role: string; asset_id: string }> = [
      { role: SOURCE_ROLE[body.op] ?? 'reference', asset_id: body.source },
    ];
    if (body.op === 'lipsync' && audio !== '') medias.push({ role: 'audio', asset_id: audio });
    const canonical = {
      kind: KIND_FOR[body.op] ?? 'image',
      capability,
      prompt: body.op,
      params: {
        ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
        ...(clipSeconds === undefined || clipSeconds <= 0 ? {} : { duration_s: clipSeconds }),
        ...(Object.keys(supplied).length === 0 ? {} : { extra: supplied }),
      },
      medias,
      count: 1,
      injections: [],
      target_folder: targetFolder,
      source: 'ui',
    };
    const priced = await engine.estimate(canonical as never, constraints as never);
    const usd = priced.estimate.authoritative_usd ?? priced.estimate.estimate_usd;
    if (body.estimate_only) {
      return NextResponse.json({ estimate: priced.estimate, estimate_usd: usd });
    }
    const result = await engine.createJob({
      request: canonical as never,
      constraints: constraints as never,
      ...(body.confirm_cost_usd === undefined ? {} : { confirmed_cost_usd: body.confirm_cost_usd }),
      confirmed_by: 'user',
      ...(body.client_request_id === undefined ? {} : { client_request_id: body.client_request_id }),
    });
    return NextResponse.json({ jobs: [result], total_estimate_usd: result.estimate.estimate_usd });
  } catch (error) {
    return errorResponse(error);
  }
}
