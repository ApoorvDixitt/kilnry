// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONSISTENCY_MANIFEST,
  consistencyDownloadBytes,
  consistencyInstalled,
  installConsistencyModel,
  keepEntry,
  type ConsistencyManifest,
} from './install.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// A gzipped ustar archive in npm's "package/" layout.
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

function sha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function serve(files: Record<string, Buffer>): typeof fetch {
  return ((url: string) =>
    Promise.resolve(
      files[url] ? new Response(new Uint8Array(files[url])) : new Response('missing', { status: 404 }),
    )) as unknown as typeof fetch;
}

describe('consistency check download-on-enable (F-CHR-12, O-03)', () => {
  it('pins the real files and reports their total size', () => {
    expect(CONSISTENCY_MANIFEST.downloads.map((item) => item.id)).toEqual([
      'recognizer',
      'detector',
      'runtime',
      'runtime-common',
    ]);
    expect(consistencyDownloadBytes()).toBe(260_694_151 + 16_923_827 + 113_507_888 + 66_795);
    for (const item of CONSISTENCY_MANIFEST.downloads) expect(item.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps only this platform runtime binary from the runtime tarball', () => {
    expect(keepEntry('runtime', 'dist/index.js', 'linux', 'x64')).toBe(true);
    expect(keepEntry('runtime', 'bin/napi-v6/linux/x64/onnxruntime_binding.node', 'linux', 'x64')).toBe(true);
    expect(keepEntry('runtime', 'bin/napi-v6/win32/x64/onnxruntime.dll', 'linux', 'x64')).toBe(false);
    expect(keepEntry('runtime-common', 'bin/napi-v6/linux/x64/x.node', 'linux', 'x64')).toBe(false);
  });

  it('downloads, verifies each checksum, extracts the wanted entries, and stamps the install', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kilnry-consistency-'));
    roots.push(dataDir);
    const model = Buffer.from('fixture model bytes');
    const archive = tgz({
      'package.json': '{"name":"fixture"}',
      'dist/index.js': 'module.exports = 1;',
      [`bin/napi-v6/${process.platform}/${process.arch}/binding.node`]: 'native',
      'bin/napi-v6/other/arch/binding.node': 'other',
    });
    const manifest: ConsistencyManifest = {
      version: 'fixture-1',
      downloads: [
        {
          id: 'recognizer',
          kind: 'file',
          url: 'https://x.test/m',
          bytes: model.length,
          sha256: sha(model),
          target: 'auraface/m.onnx',
        },
        {
          id: 'runtime',
          kind: 'npm',
          url: 'https://x.test/r',
          bytes: archive.length,
          sha256: sha(archive),
          target: 'ort/rt',
        },
      ],
    };
    const progress: string[] = [];
    expect(await consistencyInstalled(dataDir, manifest)).toBe(false);
    await installConsistencyModel({
      dataDir,
      manifest,
      fetch: serve({ 'https://x.test/m': model, 'https://x.test/r': archive }),
      onProgress: (state) => progress.push(state.phase),
    });
    expect(progress.at(-1)).toBe('installed');
    expect(await consistencyInstalled(dataDir, manifest)).toBe(true);
    expect(readFileSync(join(dataDir, 'models/auraface/m.onnx'), 'utf8')).toBe('fixture model bytes');
    expect(readFileSync(join(dataDir, 'models/ort/rt/dist/index.js'), 'utf8')).toBe('module.exports = 1;');
    expect(
      existsSync(join(dataDir, `models/ort/rt/bin/napi-v6/${process.platform}/${process.arch}/binding.node`)),
    ).toBe(true);
    expect(existsSync(join(dataDir, 'models/ort/rt/bin/napi-v6/other'))).toBe(false);
  });

  it('refuses a download whose checksum does not match and installs nothing', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kilnry-consistency-'));
    roots.push(dataDir);
    const manifest: ConsistencyManifest = {
      version: 'fixture-2',
      downloads: [
        {
          id: 'recognizer',
          kind: 'file',
          url: 'https://x.test/m',
          bytes: 3,
          sha256: '0'.repeat(64),
          target: 'auraface/m.onnx',
        },
      ],
    };
    await expect(
      installConsistencyModel({
        dataDir,
        manifest,
        fetch: serve({ 'https://x.test/m': Buffer.from('bad') }),
      }),
    ).rejects.toThrow(/did not match its pinned checksum/);
    expect(existsSync(join(dataDir, 'models/auraface/m.onnx'))).toBe(false);
    expect(existsSync(join(dataDir, 'models/auraface/m.onnx.part'))).toBe(false);
    expect(await consistencyInstalled(dataDir, manifest)).toBe(false);
  });
});
