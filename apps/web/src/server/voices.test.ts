// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-24: the voice-design preview was fetched with a plain fetch — no address
// check, no size cap, no deadline — and written into the Library. It now goes
// through the SSRF guard (PRD-19:26).

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import { prepareLibraryRoot, safeFetch } from '@kilnry/core';
import { storeVoicePreview } from './voices';

let database: ReturnType<typeof createDatabase>;
let root: string;
let libraryRoot: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kilnry-voice-preview-'));
  const dataDir = join(root, 'data');
  libraryRoot = join(root, 'library');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(libraryRoot, { recursive: true });
  database = createDatabase(dataDir, { memory: true });
  await database.ready;
  prepareLibraryRoot(libraryRoot, dataDir);
}, 60_000);

afterAll(async () => {
  await closeDatabaseState(database);
  rmSync(root, { recursive: true, force: true });
}, 30_000);

describe('storeVoicePreview (F-VOI-03)', () => {
  it('refuses a preview URL that points at a loopback or metadata address', async () => {
    for (const url of ['http://127.0.0.1:9000/preview.mp3', 'http://169.254.169.254/preview.mp3']) {
      await expect(
        storeVoicePreview({
          database,
          libraryRoot,
          libraryId: 'fixture-library',
          url,
          name: 'Studio Riya',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  }, 30_000);

  it('asks the guard for the preview with a 25 MB cap', async () => {
    const seen: Array<{ url: string; max?: number }> = [];
    const fake: typeof safeFetch = async (input, options) => {
      seen.push({ url: String(input), ...(options?.max_bytes ? { max: options.max_bytes } : {}) });
      // A refused preview leaves the voice without one rather than failing the
      // whole design, so nothing is written here.
      return new Response('nope', { status: 404 });
    };
    const assetId = await storeVoicePreview({
      database,
      libraryRoot,
      libraryId: 'fixture-library',
      url: 'https://media.example/preview.mp3',
      name: 'Studio Riya',
      fetchImpl: fake,
    });
    expect(seen).toEqual([{ url: 'https://media.example/preview.mp3', max: 25 * 1024 * 1024 }]);
    expect(assetId).toBeUndefined();
  }, 30_000);
});
