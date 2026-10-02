// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Acceptance-harness stand-ins for the consistency check (F-CHR-12). The real
// download is ~391 MB and the real model never runs in CI, so the harness
// serves small fixture files at fixture addresses, pinned by their own sha256
// so the installer's download, checksum and extraction path still runs, and
// scores with a fixture embedder. No real face embedding appears here.

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { http, HttpResponse } from 'msw';
import type { ConsistencyManifest, FaceEmbedder } from '@kilnry/core';

const BASE = 'https://fixtures.kilnry.test/consistency';

function tgz(entries: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512, 0);
    header.write(`package/${name}`, 0, 'utf8');
    header.write('0000644\0', 100);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
}

const files: Record<string, Buffer> = {
  recognizer: Buffer.from('kilnry fixture recognizer — not a model'),
  detector: Buffer.from('kilnry fixture detector — not a model'),
  runtime: tgz({
    'package.json': '{"name":"onnxruntime-node-fixture"}',
    'dist/index.js': 'module.exports = {};',
  }),
  'runtime-common': tgz({ 'package.json': '{"name":"onnxruntime-common-fixture"}' }),
};

const targets: Record<string, string> = {
  recognizer: 'auraface/glintr100.onnx',
  detector: 'auraface/scrfd_10g_bnkps.onnx',
  runtime: 'onnxruntime/node_modules/onnxruntime-node',
  'runtime-common': 'onnxruntime/node_modules/onnxruntime-common',
};

export function consistencyFixtureManifest(): ConsistencyManifest {
  return {
    version: 'fixture-auraface-v1',
    downloads: Object.entries(files).map(([id, bytes]) => ({
      id,
      kind: id.startsWith('runtime') ? 'npm' : 'file',
      url: `${BASE}/${id}`,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      target: targets[id]!,
    })),
  };
}

export const consistencyFixtureHandlers = Object.entries(files).map(([id, bytes]) =>
  http.get(`${BASE}/${id}`, () =>
    HttpResponse.arrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  ),
);

// Every face reads as the same direction, so a scored output is "high".
export function fixtureFaceEmbedder(): FaceEmbedder {
  return { embed: () => Promise.resolve(Float32Array.from([1, 0, 0, 0])) };
}
