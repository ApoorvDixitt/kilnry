// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { embedMetadata, readEmbeddedMetadata, type EmbeddedPayload } from './index.js';
import { writePngMetadata } from './png-itxt.js';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function payload(
  generation: unknown = { prompt: 'metadata fixture', model: 'fixture/model' },
): EmbeddedPayload {
  return {
    kilnry: 1,
    asset_id: '01J00000000000000000000000',
    library_id: '01J00000000000000000000001',
    created_at: '2026-09-19T00:00:00.000Z',
    source: 'ui',
    kind: 'image',
    generation,
    lineage: { made_from: [] },
  };
}

function minimalGlb(): Buffer {
  const encoded = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scenes: [] }), 'utf8');
  const length = Math.ceil(encoded.length / 4) * 4;
  const output = Buffer.alloc(20 + length, 0x20);
  output.write('glTF', 0, 'ascii');
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  encoded.copy(output, 20);
  return output;
}

describe('embedded metadata formats', () => {
  it('round-trips XMP in JPEG and Kilnry extras in GLB', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-metadata-formats-'));
    roots.push(root);
    const jpeg = join(root, 'asset.jpg');
    await sharp(tinyPng).jpeg({ quality: 100 }).toFile(jpeg);
    expect(await embedMetadata(jpeg, 'image/jpeg', payload())).toMatchObject({
      embedded: true,
      adjustment: 'xmp_embed_reencoded',
    });
    expect(await readEmbeddedMetadata(jpeg, 'image/jpeg')).toMatchObject({
      payload: { asset_id: '01J00000000000000000000000', generation: { prompt: 'metadata fixture' } },
    });

    const glb = join(root, 'asset.glb');
    writeFileSync(glb, minimalGlb());
    expect(await embedMetadata(glb, 'model/gltf-binary', payload())).toEqual({ embedded: true });
    expect(await readEmbeddedMetadata(glb, 'model/gltf-binary')).toMatchObject({
      payload: { asset_id: '01J00000000000000000000000', generation: { model: 'fixture/model' } },
    });
  });

  it('reduces oversized embedded payloads in the canonical order', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-metadata-limit-'));
    roots.push(root);
    const image = join(root, 'large.png');
    writeFileSync(image, tinyPng);
    await embedMetadata(
      image,
      'image/png',
      payload({
        prompt: 'p'.repeat(80_000),
        params: { extra: { debug: 'x'.repeat(70_000) } },
        medias: [{ role: 'reference', label: 'label'.repeat(1000) }],
      }),
    );
    const recovered = (await readEmbeddedMetadata(image, 'image/png')).payload as {
      generation?: { prompt?: string; params?: { extra?: unknown }; truncated?: boolean };
    };
    expect(Buffer.byteLength(JSON.stringify(recovered))).toBeLessThanOrEqual(65_536);
    expect(recovered.generation?.params?.extra).toBeUndefined();
    expect(recovered.generation?.prompt?.endsWith('…')).toBe(true);
    expect(recovered.generation?.truncated).toBe(true);
  });

  it('recovers A1111 and ComfyUI prompt metadata when no Kilnry payload exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-metadata-import-'));
    roots.push(root);
    const a1111 = join(root, 'a1111.png');
    writeFileSync(
      a1111,
      writePngMetadata(
        tinyPng,
        undefined,
        'a ceramic kiln\nNegative prompt: smoke\nSteps: 20, Seed: 42, Model: kiln-v1',
      ),
    );
    expect(await readEmbeddedMetadata(a1111, 'image/png')).toMatchObject({
      payload: {
        generation: {
          prompt: 'a ceramic kiln',
          negative_prompt: 'smoke',
          seed: 42,
          model: 'kiln-v1',
          recovered_from: 'png:tEXt:parameters',
        },
      },
    });

    const comfy = join(root, 'comfy.png');
    writeFileSync(
      comfy,
      writePngMetadata(tinyPng, undefined, undefined, {
        prompt: JSON.stringify({
          '1': { class_type: 'CLIPTextEncode', inputs: { text: 'a warm studio kiln' } },
          '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'kiln-model.safetensors' } },
        }),
      }),
    );
    expect(await readEmbeddedMetadata(comfy, 'image/png')).toMatchObject({
      payload: {
        generation: {
          prompt: 'a warm studio kiln',
          model: 'kiln-model.safetensors',
          recovered_from: 'png:tEXt:comfy',
        },
      },
    });
    expect(readFileSync(comfy).subarray(0, 8)).toEqual(tinyPng.subarray(0, 8));
  });
});
