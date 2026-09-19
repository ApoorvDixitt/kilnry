// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { randomBytes } from 'node:crypto';
import { open, readFile, rename } from 'node:fs/promises';
import * as z from 'zod';

export const SidecarSchema = z
  .object({
    schema_version: z.literal(1),
    asset_id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
    library_id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
    file: z.object({
      name: z.string(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      bytes: z.number().int().nonnegative(),
      mime: z.string(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      duration_s: z.number().nonnegative().optional(),
      fps: z.number().nonnegative().optional(),
      has_audio: z.boolean().optional(),
    }),
    created_at: z.string().datetime(),
    source: z.enum(['ui', 'chat', 'mcp', 'workflow', 'import', 'transform', 'assembly']),
    kind: z.enum(['image', 'video', 'audio', '3d', 'document']),
    generation: z.record(z.string(), z.unknown()).nullable(),
    lineage: z.object({
      made_from: z.array(z.string()).default([]),
      used_in: z.array(z.string()).default([]),
    }),
    tags: z.array(z.string()).default([]),
    label: z.string().nullable().default(null),
    rating: z.number().int().min(0).max(5).default(0),
    user_notes: z.string().default(''),
    consistency: z.record(z.string(), z.unknown()).nullable().default(null),
    export: z.object({
      c2pa: z.boolean().default(false),
      iptc_digital_source_type: z.string().nullable().default(null),
    }),
    trash: z.record(z.string(), z.unknown()).nullable().default(null),
  })
  .passthrough();

export type Sidecar = z.infer<typeof SidecarSchema>;

export function sidecarPath(assetPath: string): string {
  return `${assetPath}.kilnry.json`;
}

export async function readSidecar(
  assetPath: string,
): Promise<{ ok: true; value: Sidecar; bytes: Buffer } | { ok: false; reason: string; bytes?: Buffer }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(sidecarPath(assetPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, reason: 'missing' };
    throw error;
  }
  try {
    return { ok: true, value: SidecarSchema.parse(JSON.parse(bytes.toString('utf8')) as unknown), bytes };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason, bytes };
  }
}

export async function writeSidecar(assetPath: string, input: Sidecar): Promise<void> {
  const path = sidecarPath(assetPath);
  let value = SidecarSchema.parse(input);
  const existing = await readSidecar(assetPath);
  if (existing.ok) {
    value = {
      ...value,
      tags: existing.value.tags,
      label: existing.value.label,
      rating: existing.value.rating,
      user_notes: existing.value.user_notes,
    };
  }
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}
