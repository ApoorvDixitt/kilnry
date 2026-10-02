// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { assets, characterReferences, closeDatabaseState, createDatabase } from '@kilnry/db';
import { addReferences, createCharacter } from '../characters/store.js';
import { ulid } from '../ids.js';
import { scoreAssetConsistency } from './check.js';
import type { FaceEmbedder } from './face.js';

const roots: string[] = [];
const states: Array<ReturnType<typeof createDatabase>> = [];
afterEach(async () => {
  for (const state of states.splice(0)) await closeDatabaseState(state);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// A fixture embedder: the reference reads as one direction and the output as a
// chosen blend, so the expected cosine is known. Never the real model.
function fixtureEmbedder(outputScore: number): FaceEmbedder & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    embed(path: string) {
      calls.push(path);
      if (path.includes('reference')) return Promise.resolve(Float32Array.from([1, 0]));
      return Promise.resolve(Float32Array.from([outputScore, Math.sqrt(1 - outputScore * outputScore)]));
    },
  };
}

async function setup(look?: string): Promise<{
  state: ReturnType<typeof createDatabase>;
  library: string;
  outputId: string;
  outputPath: string;
}> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-consistency-check-'));
  roots.push(root);
  const library = join(root, 'library');
  mkdirSync(join(library, 'inbox'), { recursive: true });
  const state = createDatabase(join(root, 'data'), { memory: true });
  states.push(state);
  await state.ready;
  const head = await createCharacter(state, {
    handle: 'maya',
    kind: 'character',
    display_name: 'Maya',
    appearance: { descriptor: 'a woman', anchors: [], negative_traits: [] },
    ...(look ? { cast_params: { look } } : {}),
  });
  const referenceId = ulid();
  writeFileSync(join(library, 'inbox', 'reference.png'), 'ref');
  await state.db
    .insert(assets)
    .values({ id: referenceId, path: 'inbox/reference.png', kind: 'image', createdAt: new Date() });
  await addReferences(state, head.id, [{ asset_id: referenceId, role: 'face' }]);
  const outputId = ulid();
  const outputPath = join(library, 'inbox', 'out.png');
  writeFileSync(outputPath, 'out');
  writeFileSync(
    `${outputPath}.kilnry.json`,
    JSON.stringify({
      schema_version: 1,
      asset_id: outputId,
      library_id: ulid(),
      file: { name: 'out.png', sha256: '0'.repeat(64), bytes: 3, mime: 'image/png' },
      created_at: '2026-10-02T00:00:00.000Z',
      source: 'ui',
      kind: 'image',
      generation: {
        prompt: '@maya on a rooftop',
        characters: [{ handle: 'maya', version: 1, strategy: 'refs', inputs: [] }],
      },
      lineage: { made_from: [], used_in: [] },
      export: { c2pa: false, iptc_digital_source_type: null },
    }),
  );
  await state.db
    .insert(assets)
    .values({ id: outputId, path: 'inbox/out.png', kind: 'image', createdAt: new Date() });
  return { state, library, outputId, outputPath };
}

describe('consistency check scoring an output (F-CHR-12)', () => {
  it('scores an image against the reference anchor and stores the badge, not the embedding', async () => {
    const { state, library, outputId, outputPath } = await setup('photoreal');
    const embedder = fixtureEmbedder(0.4);
    const score = await scoreAssetConsistency({
      state,
      libraryRoot: library,
      assetId: outputId,
      embedder,
      now: () => new Date('2026-10-02T12:00:00.000Z'),
    });
    expect(score).toEqual({
      model: 'auraface-v1',
      character: '@maya',
      version: 1,
      badge: 'medium',
      min: 0.4,
      mean: 0.4,
      frames: 1,
      computed_at: '2026-10-02T12:00:00.000Z',
    });
    const sidecar = JSON.parse(readFileSync(`${outputPath}.kilnry.json`, 'utf8')) as {
      consistency?: unknown;
    };
    expect(sidecar.consistency).toEqual(score);
    const [row] = await state.db.select().from(assets).where(eq(assets.id, outputId));
    expect(row?.consistency).toEqual(score);
    // The reference embedding is stored once and reused; the sidecar never holds it.
    const [reference] = await state.db.select().from(characterReferences);
    expect(reference?.faceEmbedding?.byteLength).toBe(8);
    expect(JSON.stringify(sidecar)).not.toContain('face_embedding');
    await scoreAssetConsistency({ state, libraryRoot: library, assetId: outputId, embedder });
    expect(embedder.calls.filter((path) => path.includes('reference'))).toHaveLength(1);
  });

  it('finds the Character from the prompt @handle when no injection was recorded', async () => {
    const { state, library, outputId, outputPath } = await setup('photoreal');
    const recorded = JSON.parse(readFileSync(`${outputPath}.kilnry.json`, 'utf8')) as {
      generation: { characters: unknown[] };
    };
    recorded.generation.characters = [];
    writeFileSync(`${outputPath}.kilnry.json`, JSON.stringify(recorded));
    const score = await scoreAssetConsistency({
      state,
      libraryRoot: library,
      assetId: outputId,
      embedder: fixtureEmbedder(0.9),
    });
    expect(score).toMatchObject({ character: '@maya', badge: 'high', min: 0.9 });
  });

  it('does not score a stylised Character', async () => {
    const { state, library, outputId } = await setup('3d-stylised');
    expect(
      await scoreAssetConsistency({
        state,
        libraryRoot: library,
        assetId: outputId,
        embedder: fixtureEmbedder(0.9),
      }),
    ).toBeNull();
  });
});
