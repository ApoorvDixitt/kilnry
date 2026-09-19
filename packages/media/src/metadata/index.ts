// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import { runMediaProcess } from '../process.js';
import { readPngMetadata, writePngMetadata } from './png-itxt.js';

export interface EmbeddedPayload {
  kilnry: 1;
  asset_id: string;
  library_id: string;
  created_at: string;
  source: string;
  kind: string;
  generation: unknown;
  lineage: unknown;
}

function parameters(payload: EmbeddedPayload): string | undefined {
  if (typeof payload.generation !== 'object' || payload.generation === null) return undefined;
  const generation = payload.generation as Record<string, unknown>;
  if (typeof generation.prompt !== 'string') return undefined;
  const negative =
    typeof generation.negative_prompt === 'string' ? `\nNegative prompt: ${generation.negative_prompt}` : '';
  const seed = typeof generation.seed === 'number' ? `, Seed: ${generation.seed}` : '';
  const model = typeof generation.model === 'string' ? `, Model: ${generation.model}` : '';
  return `${generation.prompt}${negative}\nSteps: -${seed}${model}`;
}

export async function embedMetadata(
  path: string,
  mime: string,
  payload: EmbeddedPayload,
): Promise<{ embedded: boolean; adjustment?: string }> {
  if (mime === 'image/png') {
    const bytes = await readFile(path);
    const updated = writePngMetadata(bytes, payload, parameters(payload));
    const temporary = `${path}.metadata-${process.pid}-${randomBytes(3).toString('hex')}`;
    await writeFile(temporary, updated, { mode: 0o600 });
    await rename(temporary, path);
    return { embedded: true };
  }
  if (!mime.startsWith('video/') && !mime.startsWith('audio/')) {
    return { embedded: false, adjustment: `embed_skipped:${mime}` };
  }
  const extension = extname(path);
  const temporary = `${path}.metadata-${process.pid}-${randomBytes(3).toString('hex')}${extension}`;
  const generation = JSON.stringify(payload);
  const prompt = parameters(payload)?.split('\n')[0]?.slice(0, 2000) ?? '';
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    path,
    '-map',
    '0',
    '-c',
    'copy',
    '-map_metadata',
    '0',
    ...(mime === 'video/mp4' || mime === 'audio/mp4'
      ? ['-movflags', '+faststart+use_metadata_tags', '-metadata', `com.kilnry.generation=${generation}`]
      : ['-metadata', `KILNRY=${generation}`]),
    '-metadata',
    `comment=${prompt}`,
    '-metadata',
    'encoder=Kilnry',
    temporary,
  ];
  try {
    await runMediaProcess(process.env.KILNRY_FFMPEG ?? 'ffmpeg', args, { timeoutMs: 120_000 });
    await rename(temporary, path);
    return { embedded: true };
  } catch (error) {
    return {
      embedded: false,
      adjustment: `embed_skipped:${error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120)}`,
    };
  }
}

export async function readEmbeddedMetadata(
  path: string,
  mime: string,
): Promise<{ payload?: unknown; parameters?: string; skipped_reason?: string }> {
  if (mime === 'image/png') return readPngMetadata(await readFile(path));
  if (!mime.startsWith('video/') && !mime.startsWith('audio/')) return {};
  try {
    const result = await runMediaProcess(
      process.env.KILNRY_FFPROBE ?? 'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', path],
      { timeoutMs: 20_000 },
    );
    const parsed = JSON.parse(result.stdout) as { format?: { tags?: Record<string, string> } };
    const tags = parsed.format?.tags ?? {};
    const encoded = tags['com.kilnry.generation'] ?? tags.KILNRY ?? tags.kilnry;
    return {
      ...(encoded ? { payload: JSON.parse(encoded) as unknown } : {}),
      ...(tags.comment ? { parameters: tags.comment } : {}),
    };
  } catch (error) {
    return { skipped_reason: error instanceof Error ? error.message : String(error) };
  }
}
