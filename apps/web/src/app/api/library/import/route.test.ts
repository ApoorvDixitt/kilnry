// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assets, closeDatabaseState, createDatabase } from '@kilnry/db';
import { prepareLibraryRoot } from '@kilnry/core';

const harness = vi.hoisted(() => ({ services: undefined as unknown }));

vi.mock('../../../../server/http', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../server/http')>();
  return {
    ...original,
    requireSession: async () => ({ user: { id: 'owner' }, session: { id: 'session' } }),
  };
});

vi.mock('../../../../server/runtime', () => ({
  runtimeServices: async () => harness.services,
}));

// errorResponse reads the request id from next/headers, which only exists inside
// a request scope; outside one it throws instead of answering.
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { POST } from './route';

// A one-pixel PNG, the same bytes the acceptance fixtures use.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

let database: ReturnType<typeof createDatabase>;
let root: string;
let libraryRoot: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kilnry-import-route-'));
  const dataDir = join(root, 'data');
  libraryRoot = join(root, 'library');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(libraryRoot, { recursive: true });
  process.env.KILNRY_DATA_DIR = dataDir;
  process.env.KILNRY_LIBRARY_ROOT = libraryRoot;
  database = createDatabase(dataDir, { memory: true });
  await database.ready;
  prepareLibraryRoot(libraryRoot, dataDir);
  harness.services = { database };
}, 60_000);

afterAll(async () => {
  delete process.env.KILNRY_DATA_DIR;
  delete process.env.KILNRY_LIBRARY_ROOT;
  await closeDatabaseState(database);
  rmSync(root, { recursive: true, force: true });
}, 30_000);

function upload(files: Array<{ name: string; bytes: Buffer }>, folder?: string): Request {
  const form = new FormData();
  for (const file of files)
    form.append('files', new File([new Uint8Array(file.bytes)], file.name, { type: 'image/png' }));
  if (folder !== undefined) form.append('target_folder', folder);
  return new Request('http://127.0.0.1:3123/api/library/import', { method: 'POST', body: form });
}

// F-111: the browser posts multipart here (create-character.tsx's From photo
// path), and the route read JSON only, so every attempt answered 500 with the
// multipart boundary parsed as JSON. TRD-16 §3 specifies the branch.
describe('POST /api/library/import multipart (F-CHR-02)', () => {
  it('writes one uploaded photo into the Library and returns its asset', async () => {
    const response = await POST(upload([{ name: 'maya-anchor.png', bytes: PNG }], 'inbox'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { assets?: Array<{ asset_id: string; path: string }> };
    expect(body.assets).toHaveLength(1);
    const asset = body.assets![0]!;
    expect(asset.asset_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(existsSync(join(libraryRoot, asset.path))).toBe(true);
    const rows = await database.db.select().from(assets);
    expect(rows.map((row) => row.id)).toContain(asset.asset_id);
  }, 30_000);

  it('imports into the folder the form names, creating it when it does not exist', async () => {
    const folder = 'Character_Sheets/@maya/v1';
    const response = await POST(upload([{ name: 'a.png', bytes: PNG }], folder));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { assets: Array<{ path: string }> };
    expect(body.assets[0]!.path.startsWith(folder)).toBe(true);
    expect(existsSync(join(libraryRoot, body.assets[0]!.path))).toBe(true);
  }, 30_000);

  it('refuses a file name that would climb out of the Library', async () => {
    const response = await POST(upload([{ name: '../escape.png', bytes: PNG }], 'inbox'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { assets: Array<{ path: string }> };
    // The name is sanitised, so the write stays inside the folder.
    expect(body.assets[0]!.path.startsWith('inbox/')).toBe(true);
    expect(existsSync(join(libraryRoot, '..', 'escape.png'))).toBe(false);
  }, 30_000);

  it('refuses an empty upload and more than twenty files', async () => {
    const empty = await POST(upload([], 'inbox'));
    expect(empty.status).toBe(400);
    const many = await POST(
      upload(
        Array.from({ length: 21 }, (_unused, index) => ({ name: `p${index}.png`, bytes: PNG })),
        'inbox',
      ),
    );
    expect(many.status).toBe(400);
    const body = (await many.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain('20 files');
  }, 30_000);

  it('still runs the folder scan for a JSON body', async () => {
    const response = await POST(
      new Request('http://127.0.0.1:3123/api/library/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: 'inbox' }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { report?: { imported: number } };
    expect(typeof body.report?.imported).toBe('number');
  }, 60_000);
});
