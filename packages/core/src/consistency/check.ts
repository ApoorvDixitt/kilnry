// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Score one finished output against the Character it was made with (F-CHR-12,
// PRD-07 §13). Runs locally after the job completes, costs nothing, and writes
// only the badge summary to the asset's sidecar and index row; the embeddings
// stay in character_references.face_embedding and are never logged.

import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { and, eq, isNull } from 'drizzle-orm';
import type { DatabaseState } from '@kilnry/db';
import { assets, characterReferences, characterVersions, characters } from '@kilnry/db';
import { lookupHandle } from '../characters/store.js';
import { resolveInRoot } from '../library/containment.js';
import { readSidecar, writeSidecar } from '../library/sidecar.js';
import type { FaceEmbedder } from './face.js';
import {
  centroid,
  cosine,
  embeddingFromBytes,
  embeddingToBytes,
  summarise,
  type ConsistencyScore,
} from './score.js';

const execFileAsync = promisify(execFile);

// Stylised and non-human Characters are not scored (PRD-07 §13).
const NON_FACE_LOOKS = new Set(['anime-2d', '3d-stylised', 'game-concept', 'claymation']);
const NON_FACE_TAGS = new Set(['look:3d', 'creature', 'non-human']);

export function faceCheckApplies(character: { kind: string; tags: string[] | null; look: unknown }): boolean {
  if (character.kind !== 'character') return false;
  if ((character.tags ?? []).some((tag) => NON_FACE_TAGS.has(tag))) return false;
  return !(typeof character.look === 'string' && NON_FACE_LOOKS.has(character.look));
}

// Sample a video at one frame per second into still images.
async function sampleFrames(video: string, directory: string): Promise<string[]> {
  await execFileAsync(
    process.env.KILNRY_FFMPEG ?? 'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-i',
      video,
      '-vf',
      'fps=1',
      join(directory, 'frame-%04d.png'),
    ],
    { maxBuffer: 1024 * 1024 },
  );
  return (await readdir(directory))
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => join(directory, name));
}

async function anchorFor(
  state: DatabaseState,
  libraryRoot: string,
  embedder: FaceEmbedder,
  characterId: string,
  version: number,
): Promise<Float32Array | null> {
  const references = await state.db
    .select()
    .from(characterReferences)
    .where(and(eq(characterReferences.characterId, characterId), eq(characterReferences.version, version)));
  const embeddings: Float32Array[] = [];
  for (const reference of references) {
    if (reference.faceEmbedding) {
      embeddings.push(embeddingFromBytes(reference.faceEmbedding));
      continue;
    }
    const [asset] = await state.db
      .select({ path: assets.path })
      .from(assets)
      .where(and(eq(assets.id, reference.assetId), isNull(assets.trashedAt)))
      .limit(1);
    if (!asset) continue;
    const file = await resolveInRoot(libraryRoot, asset.path);
    const embedding = await embedder.embed(file.abs);
    if (!embedding) continue;
    await state.db
      .update(characterReferences)
      .set({ faceEmbedding: embeddingToBytes(embedding) })
      .where(eq(characterReferences.id, reference.id));
    embeddings.push(embedding);
  }
  return embeddings.length === 0 ? null : centroid(embeddings);
}

// On enable, every reference image of a face Character gets its embedding
// stored (PRD-07 §13), so the first score does not pay for it. Returns how many
// were embedded; references with no detectable face stay empty.
export async function embedCharacterReferences(options: {
  state: DatabaseState;
  libraryRoot: string;
  embedder: FaceEmbedder;
}): Promise<number> {
  const { state, libraryRoot, embedder } = options;
  const rows = await state.db
    .select({ id: characterReferences.id, path: assets.path, kind: characters.kind, tags: characters.tags })
    .from(characterReferences)
    .innerJoin(characters, eq(characters.id, characterReferences.characterId))
    .innerJoin(assets, eq(assets.id, characterReferences.assetId))
    .where(and(isNull(characterReferences.faceEmbedding), isNull(assets.trashedAt)));
  let embedded = 0;
  for (const row of rows) {
    if (!faceCheckApplies({ kind: row.kind, tags: row.tags, look: undefined })) continue;
    const file = await resolveInRoot(libraryRoot, row.path);
    const embedding = await embedder.embed(file.abs);
    if (!embedding) continue;
    await state.db
      .update(characterReferences)
      .set({ faceEmbedding: embeddingToBytes(embedding) })
      .where(eq(characterReferences.id, row.id));
    embedded += 1;
  }
  return embedded;
}

// Compute and store the consistency score for one asset. Returns the stored
// summary, or null when there is nothing to score (no Character in the request,
// a non-face Character, no face in the references or in the output).
export async function scoreAssetConsistency(options: {
  state: DatabaseState;
  libraryRoot: string;
  assetId: string;
  embedder: FaceEmbedder;
  now?: () => Date;
}): Promise<ConsistencyScore | null> {
  const { state, libraryRoot, embedder } = options;
  const [row] = await state.db.select().from(assets).where(eq(assets.id, options.assetId)).limit(1);
  if (!row || (row.kind !== 'image' && row.kind !== 'video')) return null;
  const file = await resolveInRoot(libraryRoot, row.path);
  const sidecar = await readSidecar(file.abs);
  if (!sidecar.ok) return null;
  const generation = sidecar.value.generation as { characters?: unknown; prompt?: unknown } | null;
  const injected = generation?.characters;
  // The Character comes from the recorded injection; Create does not resolve
  // mentions into injections yet, so a prompt's first @handle stands in.
  const mentioned =
    typeof generation?.prompt === 'string'
      ? /(?:^|\s)@([a-z0-9_]{2,40})\b/i.exec(generation.prompt)?.[1]
      : undefined;
  const injection = ((Array.isArray(injected) ? injected[0] : undefined) ??
    (mentioned ? { handle: mentioned } : undefined)) as { handle?: string; version?: number } | undefined;
  if (!injection?.handle) return null;
  const head = await lookupHandle(state, injection.handle);
  if (!head) return null;
  const [character] = await state.db.select().from(characters).where(eq(characters.id, head.id)).limit(1);
  if (!character) return null;
  const handle = character.handle;
  const version = injection.version ?? character.currentVersion;
  const [versionRow] = await state.db
    .select({ castParams: characterVersions.castParams })
    .from(characterVersions)
    .where(and(eq(characterVersions.characterId, character.id), eq(characterVersions.version, version)))
    .limit(1);
  const look = versionRow?.castParams?.look;
  if (!faceCheckApplies({ kind: character.kind, tags: character.tags, look })) return null;
  const anchor = await anchorFor(state, libraryRoot, embedder, character.id, version);
  if (!anchor) return null;

  const scores: number[] = [];
  if (row.kind === 'image') {
    const embedding = await embedder.embed(file.abs);
    if (embedding) scores.push(cosine(anchor, embedding));
  } else {
    const directory = await mkdtemp(join(tmpdir(), 'kilnry-consistency-'));
    try {
      for (const frame of await sampleFrames(file.abs, directory)) {
        const embedding = await embedder.embed(frame);
        if (embedding) scores.push(cosine(anchor, embedding));
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  if (scores.length === 0) return null;
  const summary = summarise(scores);
  const score: ConsistencyScore = {
    model: 'auraface-v1',
    character: `@${handle}`,
    version,
    badge: summary.badge,
    min: summary.min,
    mean: summary.mean,
    frames: scores.length,
    computed_at: (options.now ?? (() => new Date()))().toISOString(),
  };
  await writeSidecar(file.abs, { ...sidecar.value, consistency: { ...score } });
  await state.db
    .update(assets)
    .set({ consistency: { ...score } })
    .where(eq(assets.id, options.assetId));
  return score;
}
