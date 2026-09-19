// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import sharp from 'sharp';
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

const metadataLimit = 65_536;

function compactPayload(payload: EmbeddedPayload): EmbeddedPayload {
  const value = JSON.parse(JSON.stringify(payload)) as EmbeddedPayload;
  const generation =
    typeof value.generation === 'object' && value.generation !== null
      ? (value.generation as Record<string, unknown>)
      : undefined;
  const fits = (): boolean => Buffer.byteLength(JSON.stringify(value)) <= metadataLimit;
  if (fits() || !generation) return value;
  if (typeof generation.params === 'object' && generation.params !== null) {
    const params = { ...(generation.params as Record<string, unknown>) };
    delete params.extra;
    generation.params = params;
  }
  if (fits()) return value;
  if (Array.isArray(generation.medias)) {
    generation.medias = generation.medias.map((media) => {
      if (typeof media !== 'object' || media === null) return media;
      const reduced = { ...(media as Record<string, unknown>) };
      delete reduced.label;
      return reduced;
    });
  }
  if (fits()) return value;
  for (const key of ['prompt', 'resolved_prompt', 'negative_prompt']) {
    if (typeof generation[key] === 'string' && generation[key].length > 4000) {
      generation[key] = `${generation[key].slice(0, 3999)}…`;
    }
  }
  generation.truncated = true;
  if (fits()) return value;
  generation.medias = [];
  generation.characters = [];
  generation.params = {};
  if (!fits()) throw new Error('Kilnry embedded metadata still exceeds 64 KiB after canonical reduction.');
  return value;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function xmlUnescape(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function xmpPacket(payload: EmbeddedPayload): string {
  const generation = xmlEscape(JSON.stringify(payload));
  const prompt =
    typeof payload.generation === 'object' &&
    payload.generation !== null &&
    'prompt' in payload.generation &&
    typeof payload.generation.prompt === 'string'
      ? xmlEscape(payload.generation.prompt.slice(0, 2000))
      : '';
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:kilnry="http://kilnry.app/ns/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><kilnry:generation>${generation}</kilnry:generation><dc:description>${prompt}</dc:description><xmp:CreatorTool>Kilnry</xmp:CreatorTool><xmp:CreateDate>${xmlEscape(payload.created_at)}</xmp:CreateDate></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
}

function glbMetadata(bytes: Uint8Array): unknown {
  const value = Buffer.from(bytes);
  if (value.length < 20 || value.toString('ascii', 0, 4) !== 'glTF') throw new Error('Invalid GLB header.');
  const jsonLength = value.readUInt32LE(12);
  if (value.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength > value.length) {
    throw new Error('GLB is missing its JSON chunk.');
  }
  const json = JSON.parse(
    value
      .subarray(20, 20 + jsonLength)
      .toString('utf8')
      .trimEnd(),
  ) as {
    asset?: { extras?: { kilnry?: unknown } };
  };
  return json.asset?.extras?.kilnry;
}

function writeGlbMetadata(bytes: Uint8Array, payload: EmbeddedPayload): Uint8Array {
  const value = Buffer.from(bytes);
  if (value.length < 20 || value.toString('ascii', 0, 4) !== 'glTF') throw new Error('Invalid GLB header.');
  const jsonLength = value.readUInt32LE(12);
  if (value.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength > value.length) {
    throw new Error('GLB is missing its JSON chunk.');
  }
  const json = JSON.parse(
    value
      .subarray(20, 20 + jsonLength)
      .toString('utf8')
      .trimEnd(),
  ) as Record<string, unknown>;
  const asset: Record<string, unknown> =
    typeof json.asset === 'object' && json.asset !== null
      ? { ...(json.asset as Record<string, unknown>) }
      : { version: '2.0' };
  const extras =
    typeof asset.extras === 'object' && asset.extras !== null
      ? { ...(asset.extras as Record<string, unknown>) }
      : {};
  asset.extras = { ...extras, kilnry: payload };
  json.asset = asset;
  const encoded = Buffer.from(JSON.stringify(json), 'utf8');
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const chunk = Buffer.alloc(paddedLength, 0x20);
  encoded.copy(chunk);
  const remainder = value.subarray(20 + jsonLength);
  const output = Buffer.alloc(20 + paddedLength + remainder.length);
  value.subarray(0, 12).copy(output, 0);
  output.writeUInt32LE(paddedLength, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(output, 20);
  remainder.copy(output, 20 + paddedLength);
  output.writeUInt32LE(output.length, 8);
  return output;
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

function a1111Payload(value: string): unknown {
  const settingsAt = value.lastIndexOf('\nSteps:');
  const body = settingsAt >= 0 ? value.slice(0, settingsAt) : value;
  const settings = settingsAt >= 0 ? value.slice(settingsAt + 1) : '';
  const negativeAt = body.indexOf('\nNegative prompt:');
  const prompt = (negativeAt >= 0 ? body.slice(0, negativeAt) : body).trim();
  const negative = negativeAt >= 0 ? body.slice(negativeAt + '\nNegative prompt:'.length).trim() : undefined;
  const seed = /(?:^|,)\s*Seed:\s*(\d+)/i.exec(settings)?.[1];
  const model = /(?:^|,)\s*Model:\s*([^,]+)/i.exec(settings)?.[1]?.trim();
  if (!prompt) return undefined;
  return {
    generation: {
      prompt,
      resolved_prompt: prompt,
      negative_prompt: negative ?? null,
      ...(seed ? { seed: Number(seed) } : {}),
      ...(model ? { model } : {}),
      recovered_from: 'png:tEXt:parameters',
    },
  };
}

function comfyPayload(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  let prompt: string | undefined;
  let model: string | undefined;
  for (const node of Object.values(value as Record<string, unknown>)) {
    if (typeof node !== 'object' || node === null) continue;
    const record = node as { class_type?: unknown; inputs?: unknown };
    if (typeof record.inputs !== 'object' || record.inputs === null) continue;
    const inputs = record.inputs as Record<string, unknown>;
    if (record.class_type === 'CLIPTextEncode' && typeof inputs.text === 'string' && !prompt) {
      prompt = inputs.text;
    }
    if (/CheckpointLoader/i.test(String(record.class_type)) && typeof inputs.ckpt_name === 'string') {
      model = inputs.ckpt_name;
    }
  }
  if (!prompt && !model) return undefined;
  return {
    generation: {
      prompt: prompt ?? '',
      resolved_prompt: prompt ?? '',
      negative_prompt: null,
      ...(model ? { model } : {}),
      recovered_from: 'png:tEXt:comfy',
    },
  };
}

export async function embedMetadata(
  path: string,
  mime: string,
  payload: EmbeddedPayload,
): Promise<{ embedded: boolean; adjustment?: string }> {
  const compacted = compactPayload(payload);
  if (mime === 'image/png') {
    const bytes = await readFile(path);
    const updated = writePngMetadata(bytes, compacted, parameters(compacted));
    const temporary = `${path}.metadata-${process.pid}-${randomBytes(3).toString('hex')}`;
    await writeFile(temporary, updated, { mode: 0o600 });
    await rename(temporary, path);
    return { embedded: true };
  }
  if (mime === 'model/gltf-binary') {
    const temporary = `${path}.metadata-${process.pid}-${randomBytes(3).toString('hex')}.glb`;
    await writeFile(temporary, writeGlbMetadata(await readFile(path), compacted), { mode: 0o600 });
    await rename(temporary, path);
    return { embedded: true };
  }
  if (['image/jpeg', 'image/webp', 'image/avif', 'image/tiff'].includes(mime)) {
    const extension = extname(path);
    const temporary = `${path}.metadata-${process.pid}-${randomBytes(3).toString('hex')}${extension}`;
    await sharp(path, { animated: mime === 'image/webp' })
      .keepMetadata()
      .withXmp(xmpPacket(compacted))
      .toFile(temporary);
    await rename(temporary, path);
    return { embedded: true, adjustment: 'xmp_embed_reencoded' };
  }
  if (!mime.startsWith('video/') && !mime.startsWith('audio/')) {
    return { embedded: false, adjustment: `embed_skipped:${mime}` };
  }
  const extension = extname(path);
  const temporary = `${path}.metadata-${process.pid}-${randomBytes(3).toString('hex')}${extension}`;
  const generation = JSON.stringify(compacted);
  const prompt = parameters(compacted)?.split('\n')[0]?.slice(0, 2000) ?? '';
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
  if (mime === 'image/png') {
    const metadata = readPngMetadata(await readFile(path));
    return {
      ...(metadata.payload
        ? { payload: metadata.payload }
        : metadata.parameters
          ? { payload: a1111Payload(metadata.parameters) }
          : metadata.comfy?.prompt || metadata.comfy?.workflow
            ? { payload: comfyPayload(metadata.comfy.prompt ?? metadata.comfy.workflow) }
            : {}),
      ...(metadata.parameters ? { parameters: metadata.parameters } : {}),
    };
  }
  if (mime === 'model/gltf-binary') {
    const payload = glbMetadata(await readFile(path));
    return payload === undefined ? {} : { payload };
  }
  if (['image/jpeg', 'image/webp', 'image/avif', 'image/tiff'].includes(mime)) {
    try {
      const metadata = await sharp(path).metadata();
      const xmp = metadata.xmp?.toString('utf8');
      const encoded = xmp ? /<kilnry:generation>([\s\S]*?)<\/kilnry:generation>/.exec(xmp)?.[1] : undefined;
      return encoded ? { payload: JSON.parse(xmlUnescape(encoded)) as unknown } : {};
    } catch (error) {
      return { skipped_reason: error instanceof Error ? error.message : String(error) };
    }
  }
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
