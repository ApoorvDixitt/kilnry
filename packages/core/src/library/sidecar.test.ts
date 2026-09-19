// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSidecar, sidecarPath, writeSidecar, type Sidecar } from './sidecar.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function value(): Sidecar {
  return {
    schema_version: 1,
    asset_id: '01J00000000000000000000000',
    library_id: '01J00000000000000000000001',
    file: { name: 'asset.png', sha256: 'a'.repeat(64), bytes: 4, mime: 'image/png' },
    created_at: '2026-09-19T00:00:00.000Z',
    source: 'import',
    kind: 'image',
    generation: null,
    lineage: { made_from: [], used_in: [] },
    tags: ['user-tag'],
    label: null,
    rating: 0,
    user_notes: 'kept',
    consistency: null,
    export: { c2pa: false, iptc_digital_source_type: null },
    trash: null,
  };
}

describe('sidecar writes', () => {
  it('writes atomically and preserves user-owned fields on a later write', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-sidecar-'));
    roots.push(root);
    const asset = join(root, 'asset.png');
    writeFileSync(asset, 'data');
    await writeSidecar(asset, value());
    await writeSidecar(asset, { ...value(), tags: [], user_notes: '' });
    const read = await readSidecar(asset);
    expect(read.ok && read.value.tags).toEqual(['user-tag']);
    expect(read.ok && read.value.user_notes).toBe('kept');
    expect(readdirSync(root).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('reports corrupt JSON without swallowing the parse error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-sidecar-'));
    roots.push(root);
    const asset = join(root, 'asset.png');
    writeFileSync(sidecarPath(asset), '{broken');
    const read = await readSidecar(asset);
    expect(read).toMatchObject({ ok: false });
    expect(!read.ok && read.reason).toMatch(/JSON/i);
  });
});
