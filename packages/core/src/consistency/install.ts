// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Download-on-enable for the consistency check (F-CHR-12, decision O-03). The
// face models and the ONNX runtime together add far more than O-03's 30 MB
// budget (measured 2026-10-02: onnxruntime-node 1.30.0 is 287 MB installed with
// every platform's binaries; AuraFace-v1 recognition is 261 MB and its detector
// 17 MB), so none of it ships with Kilnry. Turning the check on downloads each
// file to ~/.kilnry/models, verifies its pinned sha256 before use, and keeps
// only this platform's runtime binary. Scoring afterwards makes no network call.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { createGunzip } from 'node:zlib';
import { KilnryError } from '../errors.js';

export interface ConsistencyDownload {
  id: string;
  // A plain file, or an npm package tarball whose wanted entries are extracted.
  kind: 'file' | 'npm';
  url: string;
  bytes: number;
  sha256: string;
  // Relative to <data_dir>/models.
  target: string;
}

export interface ConsistencyManifest {
  version: string;
  downloads: ConsistencyDownload[];
}

const ORT = '1.30.0';

export const CONSISTENCY_MANIFEST: ConsistencyManifest = {
  version: `auraface-v1+onnxruntime-${ORT}`,
  downloads: [
    {
      id: 'recognizer',
      kind: 'file',
      url: 'https://huggingface.co/fal/AuraFace-v1/resolve/main/glintr100.onnx',
      bytes: 260_694_151,
      sha256: 'a7933ea5330113b01c9b60351d8f4c33003f145d8470ac5f0e52ee2effe25c60',
      target: 'auraface/glintr100.onnx',
    },
    {
      id: 'detector',
      kind: 'file',
      url: 'https://huggingface.co/fal/AuraFace-v1/resolve/main/scrfd_10g_bnkps.onnx',
      bytes: 16_923_827,
      sha256: '5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91',
      target: 'auraface/scrfd_10g_bnkps.onnx',
    },
    {
      id: 'runtime',
      kind: 'npm',
      url: `https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-${ORT}.tgz`,
      bytes: 113_507_888,
      sha256: '6e3390d6b783e7be946fad629292799da28d0b42f84856e50d2c1b0383291e75',
      target: 'onnxruntime/node_modules/onnxruntime-node',
    },
    {
      id: 'runtime-common',
      kind: 'npm',
      url: `https://registry.npmjs.org/onnxruntime-common/-/onnxruntime-common-${ORT}.tgz`,
      bytes: 66_795,
      sha256: '7906c439e0d3e0f4048caa23b64cdfadc0f455c377f579ce1ab2a4b778f07d5f',
      target: 'onnxruntime/node_modules/onnxruntime-common',
    },
  ],
};

export interface InstallProgress {
  phase: 'idle' | 'downloading' | 'installed' | 'failed';
  download?: string;
  received: number;
  total: number;
  error?: string;
}

export function consistencyDownloadBytes(manifest: ConsistencyManifest = CONSISTENCY_MANIFEST): number {
  return manifest.downloads.reduce((total, item) => total + item.bytes, 0);
}

function modelsDir(dataDir: string): string {
  return join(dataDir, 'models');
}

function stampPath(dataDir: string): string {
  return join(modelsDir(dataDir), 'consistency.json');
}

// Installed means a stamp for this manifest version exists and every target is
// on disk; a partial or older install counts as not installed.
export async function consistencyInstalled(
  dataDir: string,
  manifest: ConsistencyManifest = CONSISTENCY_MANIFEST,
): Promise<boolean> {
  try {
    const stamp = JSON.parse(await readFile(stampPath(dataDir), 'utf8')) as { version?: string };
    if (stamp.version !== manifest.version) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  for (const item of manifest.downloads) {
    try {
      await stat(join(modelsDir(dataDir), item.target));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  return true;
}

export function runtimeDir(dataDir: string): string {
  return join(modelsDir(dataDir), 'onnxruntime', 'node_modules', 'onnxruntime-node');
}

export function modelPath(dataDir: string, id: 'recognizer' | 'detector'): string {
  const item = CONSISTENCY_MANIFEST.downloads.find((download) => download.id === id)!;
  return join(modelsDir(dataDir), item.target);
}

// Which entries of an npm tarball to keep: the package manifest and its dist,
// and for the runtime only this platform's native binding.
export function keepEntry(
  id: string,
  relative: string,
  platform = process.platform,
  arch = process.arch,
): boolean {
  if (relative === 'package.json' || relative.startsWith('dist/')) return true;
  return id === 'runtime' && relative.startsWith(`bin/napi-v6/${platform}/${arch}/`);
}

export async function installConsistencyModel(options: {
  dataDir: string;
  fetch?: typeof fetch;
  manifest?: ConsistencyManifest;
  onProgress?: (progress: InstallProgress) => void;
}): Promise<void> {
  const manifest = options.manifest ?? CONSISTENCY_MANIFEST;
  const fetcher = options.fetch ?? fetch;
  const total = consistencyDownloadBytes(manifest);
  const root = modelsDir(options.dataDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  let received = 0;
  for (const item of manifest.downloads) {
    const destination = join(root, item.target);
    const partial = `${destination}.part`;
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const response = await fetcher(item.url, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new KilnryError('PROVIDER_ERROR', `Downloading ${item.id} failed with HTTP ${response.status}.`);
    }
    const hash = createHash('sha256');
    const handle = await open(partial, 'w', 0o600);
    let bytes = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        bytes += chunk.byteLength;
        received += chunk.byteLength;
        await handle.write(chunk);
        options.onProgress?.({ phase: 'downloading', download: item.id, received, total });
      }
    } finally {
      await handle.close();
    }
    const digest = hash.digest('hex');
    if (bytes !== item.bytes || digest !== item.sha256) {
      await rm(partial, { force: true });
      throw new KilnryError(
        'INVALID_INPUT',
        `The downloaded ${item.id} did not match its pinned checksum; nothing was installed.`,
      );
    }
    if (item.kind === 'file') {
      await rename(partial, destination);
    } else {
      await rm(destination, { recursive: true, force: true });
      await extractTarGz(partial, destination, (relative) => keepEntry(item.id, relative));
      await rm(partial, { force: true });
    }
  }
  await writeFile(stampPath(options.dataDir), `${JSON.stringify({ version: manifest.version })}\n`, {
    mode: 0o600,
  });
  options.onProgress?.({ phase: 'installed', received, total });
}

function readString(block: Buffer, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

function paxPath(data: Buffer): string | undefined {
  // Records are "<len> key=value\n".
  for (const line of data.toString('utf8').split('\n')) {
    const match = /^\d+ path=(.*)$/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

// A streaming reader for the ustar archives npm publishes, keeping only the
// entries `keep` accepts (paths relative to the leading "package/"), each
// confined to `destination`.
export async function extractTarGz(
  archive: string,
  destination: string,
  keep: (relative: string) => boolean,
): Promise<number> {
  const root = normalize(destination);
  await mkdir(root, { recursive: true, mode: 0o700 });
  let pending: Buffer = Buffer.alloc(0);
  let entry:
    | {
        name: string;
        remaining: number;
        pad: number;
        type: string;
        sink?: Awaited<ReturnType<typeof open>>;
        data?: Buffer[];
      }
    | undefined;
  let nextName: string | undefined;
  let extracted = 0;

  const finish = async (): Promise<void> => {
    if (!entry) return;
    if (entry.sink) {
      await entry.sink.close();
      extracted += 1;
    }
    if (entry.data && (entry.type === 'x' || entry.type === 'L')) {
      const data = Buffer.concat(entry.data);
      nextName = entry.type === 'L' ? readString(data, 0, data.length) : paxPath(data);
    }
    entry = undefined;
  };

  const begin = async (header: Buffer): Promise<void> => {
    const prefix = readString(header, 345, 155);
    const raw = nextName ?? (prefix ? `${prefix}/${readString(header, 0, 100)}` : readString(header, 0, 100));
    nextName = undefined;
    const size = Number.parseInt(readString(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const relative = raw.replace(/^package\//, '');
    entry = { name: relative, remaining: size, pad: (512 - (size % 512)) % 512, type };
    if (type === 'x' || type === 'L') {
      entry.data = [];
      return;
    }
    if ((type === '0' || type === '\0') && keep(relative)) {
      const target = normalize(join(root, relative));
      if (target !== root && !target.startsWith(`${root}${sep}`)) {
        throw new KilnryError('INVALID_INPUT', `The archive entry ${raw} escapes its destination.`);
      }
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      entry.sink = await open(target, 'w', 0o644);
    }
  };

  for await (const chunk of createReadStream(archive).pipe(createGunzip()) as AsyncIterable<Buffer>) {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    for (;;) {
      if (!entry) {
        if (pending.length < 512) break;
        const header = pending.subarray(0, 512);
        pending = pending.subarray(512);
        if (header.every((byte) => byte === 0)) continue;
        await begin(header);
        continue;
      }
      if (entry.remaining > 0) {
        if (pending.length === 0) break;
        const take = Math.min(entry.remaining, pending.length);
        const piece = pending.subarray(0, take);
        if (entry.sink) await entry.sink.write(piece);
        if (entry.data) entry.data.push(Buffer.from(piece));
        entry.remaining -= take;
        pending = pending.subarray(take);
        continue;
      }
      if (pending.length < entry.pad) break;
      pending = pending.subarray(entry.pad);
      await finish();
    }
  }
  if (entry) {
    if (entry.remaining > 0) throw new KilnryError('INVALID_INPUT', 'The archive ended inside an entry.');
    await finish();
  }
  return extracted;
}
