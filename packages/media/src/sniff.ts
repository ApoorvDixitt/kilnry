// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { open } from 'node:fs/promises';

export function sniffMimeBytes(bytes: Uint8Array): string {
  const value = Buffer.from(bytes);
  if (value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) return 'image/jpeg';
  if (value.subarray(0, 4).toString('ascii') === 'RIFF' && value.subarray(8, 12).toString('ascii') === 'WEBP')
    return 'image/webp';
  if (value.subarray(0, 6).toString('ascii').startsWith('GIF8')) return 'image/gif';
  if (value.subarray(4, 12).toString('ascii').includes('ftyp')) {
    const brand = value.subarray(8, 12).toString('ascii');
    return ['M4A ', 'M4B ', 'M4P '].includes(brand) ? 'audio/mp4' : 'video/mp4';
  }
  if (value.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (value.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac';
  if (value.subarray(0, 3).toString('ascii') === 'ID3' || (value[0] === 0xff && (value[1] ?? 0) >= 0xe0))
    return 'audio/mpeg';
  if (value.subarray(0, 4).toString('ascii') === 'RIFF' && value.subarray(8, 12).toString('ascii') === 'WAVE')
    return 'audio/wav';
  if (value.subarray(0, 4).toString('ascii') === 'glTF') return 'model/gltf-binary';
  if (value.subarray(0, 4).toString('hex') === '1a45dfa3') return 'video/webm';
  return 'application/octet-stream';
}

export async function sniffMime(path: string): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return sniffMimeBytes(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export function extensionForMime(mime: string): string {
  const extensions: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/flac': '.flac',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    'model/gltf-binary': '.glb',
  };
  return extensions[mime] ?? '.bin';
}
