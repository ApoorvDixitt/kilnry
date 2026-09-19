// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { constants } from 'node:fs';
import { access, copyFile, mkdir, open, rename, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { eq } from 'drizzle-orm';
import type { DatabaseState } from '@kilnry/db';
import { assets } from '@kilnry/db';
import {
  createDerivatives,
  embedMetadata,
  extensionForMime,
  probeMedia,
  sniffMime,
  sniffMimeBytes,
  type EmbeddedPayload,
} from '@kilnry/media';
import { ulid } from '../ids.js';
import { indexAsset, kindForMime, sha256File } from '../library/index.js';
import { resolveInRoot } from '../library/containment.js';
import { readSidecar, writeSidecar, type Sidecar } from '../library/sidecar.js';
import type { CanonicalRequest, Estimate, ProviderId } from '../types.js';

export interface FinalizeInput {
  state: DatabaseState;
  dataDir: string;
  libraryRoot: string;
  libraryId: string;
  job: {
    id: string;
    source: string;
    providerId: ProviderId;
    modelId: string;
    providerRequestId: string;
    createdAt: Date;
  };
  request: CanonicalRequest;
  estimate: Estimate;
  actualUsd: number;
  output: { index: number; bytes?: Uint8Array; path?: string; mime: string; sha256: string };
  onStage?: (stage: 'file' | 'sidecar' | 'embedded' | 'database' | 'thumbnail') => void;
}

export interface FinalizedAsset {
  asset_id: string;
  path: string;
  absolute_path: string;
  thumbnail_path?: string;
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return normalized.slice(0, 40) || 'kilnry-output';
}

async function availableName(folder: string, base: string, extension: string): Promise<string> {
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? '' : `-${index}`;
    const candidate = `${base}${suffix}${extension}`;
    try {
      await access(join(folder, candidate));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate;
      throw error;
    }
  }
  throw new Error('Could not allocate a unique output filename after 9,999 attempts.');
}

function sidecarFor(
  input: FinalizeInput,
  assetId: string,
  name: string,
  mime: string,
  sha256: string,
  bytes: number,
): Sidecar {
  return {
    schema_version: 1,
    asset_id: assetId,
    library_id: input.libraryId,
    file: { name, sha256, bytes, mime },
    created_at: new Date().toISOString(),
    source: ['ui', 'chat', 'mcp', 'workflow', 'preset'].includes(input.job.source)
      ? (input.job.source as 'ui' | 'chat' | 'mcp' | 'workflow')
      : 'ui',
    kind: kindForMime(mime),
    generation: {
      prompt: input.request.prompt,
      resolved_prompt: input.request.prompt,
      negative_prompt: input.request.negative_prompt ?? null,
      provider: input.job.providerId,
      model: input.job.modelId,
      params: input.request.params,
      medias: input.request.medias.map((media) => ({
        role: media.role,
        ...(media.asset_id ? { asset_id: media.asset_id } : {}),
      })),
      characters: input.request.injections,
      estimate_usd: input.estimate.estimate_usd,
      ...(input.estimate.authoritative_usd === undefined
        ? {}
        : { authoritative_usd: input.estimate.authoritative_usd }),
      actual_usd: input.actualUsd,
      unit_price: input.estimate.unit_price,
      provider_request_id: input.job.providerRequestId,
      output_index: input.output.index,
      job_id: input.job.id,
      run_id: null,
      step_id: null,
      adjustments: input.estimate.adjustments,
      recovered_from: null,
    },
    lineage: {
      made_from: input.request.medias.flatMap((media) => (media.asset_id ? [media.asset_id] : [])),
      used_in: [],
    },
    tags: input.job.providerId === 'pollinations' ? ['demo'] : [],
    label: null,
    rating: 0,
    user_notes: '',
    consistency: null,
    export: { c2pa: false, iptc_digital_source_type: null },
    trash: null,
  };
}

export async function finalizeOutput(input: FinalizeInput): Promise<FinalizedAsset> {
  await input.state.ready;
  const prior = await input.state.db
    .select({ id: assets.id, path: assets.path })
    .from(assets)
    .where(eq(assets.jobId, input.job.id));
  for (const existing of prior) {
    const resolved = await resolveInRoot(input.libraryRoot, existing.path, { mustExist: true });
    const sidecar = await readSidecar(resolved.abs);
    const outputIndex = sidecar.ok ? sidecar.value.generation?.output_index : undefined;
    if (
      sidecar.ok &&
      (outputIndex === input.output.index || (outputIndex === undefined && input.output.index === 0))
    ) {
      return { asset_id: existing.id, path: existing.path, absolute_path: resolved.abs };
    }
  }

  const target = await resolveInRoot(input.libraryRoot, input.request.target_folder || 'inbox');
  await mkdir(target.abs, { recursive: true, mode: 0o700 });
  const sniffed = input.output.bytes
    ? sniffMimeBytes(input.output.bytes)
    : input.output.path
      ? await sniffMime(input.output.path)
      : 'application/octet-stream';
  const mime = sniffed === 'application/octet-stream' ? input.output.mime : sniffed;
  const extension = extensionForMime(mime);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
  const name = await availableName(
    target.abs,
    `${slug(input.request.prompt)}_${timestamp}_${input.output.index}`,
    extension,
  );
  const absolute = join(/* turbopackIgnore: true */ target.abs, name);
  const partial = `${absolute}.part`;
  if (input.output.path) {
    await copyFile(input.output.path, partial, constants.COPYFILE_EXCL);
    const file = await open(partial, 'r+');
    try {
      await file.sync();
    } finally {
      await file.close();
    }
  } else if (input.output.bytes) {
    const file = await open(partial, 'wx', 0o600);
    try {
      await file.writeFile(input.output.bytes);
      await file.sync();
    } finally {
      await file.close();
    }
  } else {
    throw new Error('Downloaded output has neither a file path nor bytes.');
  }
  await rename(partial, absolute);
  input.onStage?.('file');

  const assetId = ulid();
  let hash = await sha256File(absolute);
  let sidecar = sidecarFor(input, assetId, name, mime, hash, (await stat(absolute)).size);
  await writeSidecar(absolute, sidecar);
  input.onStage?.('sidecar');

  const embeddedPayload: EmbeddedPayload = {
    kilnry: 1,
    asset_id: assetId,
    library_id: input.libraryId,
    created_at: sidecar.created_at,
    source: sidecar.source,
    kind: sidecar.kind,
    generation: sidecar.generation,
    lineage: sidecar.lineage,
  };
  const embedded = await embedMetadata(absolute, mime, embeddedPayload);
  if (embedded.adjustment && sidecar.generation) {
    const adjustments = Array.isArray(sidecar.generation.adjustments)
      ? sidecar.generation.adjustments.filter((entry): entry is string => typeof entry === 'string')
      : [];
    sidecar.generation.adjustments = [...adjustments, embedded.adjustment];
  }
  hash = await sha256File(absolute);
  const finalStats = await stat(/* turbopackIgnore: true */ absolute);
  const probe = await probeMedia(absolute);
  sidecar = {
    ...sidecar,
    file: {
      ...sidecar.file,
      sha256: hash,
      bytes: finalStats.size,
      ...(probe.width === undefined ? {} : { width: probe.width }),
      ...(probe.height === undefined ? {} : { height: probe.height }),
      ...(probe.duration_s === undefined ? {} : { duration_s: probe.duration_s }),
      ...(probe.fps === undefined ? {} : { fps: probe.fps }),
      ...(probe.has_audio === undefined ? {} : { has_audio: probe.has_audio }),
    },
  };
  await writeSidecar(absolute, sidecar);
  input.onStage?.('embedded');

  await indexAsset(input.state, input.libraryRoot, absolute, input.libraryId);
  input.onStage?.('database');

  const derivatives = await createDerivatives({
    source: absolute,
    dataDir: input.dataDir,
    assetId,
    mime,
    ...(probe.duration_s === undefined ? {} : { durationS: probe.duration_s }),
  });
  input.onStage?.('thumbnail');
  return {
    asset_id: assetId,
    path: posix.join(target.rel, name),
    absolute_path: absolute,
    ...(derivatives.thumbnail ? { thumbnail_path: derivatives.thumbnail } : {}),
  };
}
