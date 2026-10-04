// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-CHR-14 round-trip on disk: export a character to a .kilnry-character.zip,
// then import it into the same Library and assert the handle, references and
// consent come back. Uses the system zip/unzip, the same binaries the web
// wiring spawns.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { assets, closeDatabaseState, createDatabase } from '@kilnry/db';
import { prepareLibraryRoot } from '../library/root.js';
import { indexAsset } from '../library/index.js';
import { readSidecar } from '../library/sidecar.js';
import { addReferences, createCharacter, listVersions, loadVersion, lookupHandle } from './store.js';
import { setConsent } from './consent.js';
import { exportCharacterBundle, importCharacterBundle, type CharacterBundleServices } from './bundle.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

function zipDir(dir: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const zipPath = `${dir}.zip`;
    const child = spawn('zip', ['-r', '-q', zipPath, '.'], { cwd: dir });
    child.on('error', () => resolve(undefined));
    child.on('close', (code) => resolve(code === 0 ? zipPath : undefined));
  });
}

function unzipTo(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-q', '-o', zipPath, '-d', destDir]);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`))));
  });
}

describe('character export/import bundle (F-CHR-14)', () => {
  it('round-trips a character and its references through a zip', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-char-bundle-'));
    const dataDir = join(root, 'data');
    const library = join(root, 'library');
    const bundlesRoot = join(root, 'bundles');
    mkdirSync(dataDir);
    mkdirSync(bundlesRoot);
    const prepared = prepareLibraryRoot(library, dataDir);
    const state = createDatabase(dataDir, { memory: true });
    disposers.push(async () => {
      await closeDatabaseState(state);
      rmSync(root, { recursive: true, force: true });
    });
    await state.ready;

    // A reference image in the Library, indexed to an asset id.
    const refAbs = join(library, 'inbox', 'anchor.png');
    writeFileSync(
      refAbs,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const assetId = (await indexAsset(state, library, refAbs, prepared.marker.library_id)).sidecar.asset_id;

    const created = await createCharacter(state, {
      handle: 'maya',
      kind: 'character',
      display_name: 'Maya',
      appearance: { descriptor: 'a calm ceramicist', anchors: ['green apron'], negative_traits: [] },
    });
    await addReferences(state, created.id, [{ asset_id: assetId, role: 'anchor', view: 'front' }]);

    const services: CharacterBundleServices = {
      db: state,
      libraryRoot: library,
      bundlesRoot,
      exportsRoot: join(library, 'Exports'),
      kilnryVersion: '0.5.0-test',
      zipDir,
      unzipTo,
      indexAsset: async (rel) =>
        (await indexAsset(state, library, join(library, rel), prepared.marker.library_id)).sidecar.asset_id,
    };

    const exported = await exportCharacterBundle(services, { handle: 'maya' });
    expect(exported.bundle_path.endsWith('.zip')).toBe(true);
    expect(existsSync(exported.bundle_path)).toBe(true);
    expect(exported.manifest.character.handle).toBe('maya');
    expect(exported.manifest.character.references).toHaveLength(1);
    expect(exported.manifest.character.appearance.descriptor).toBe('a calm ceramicist');

    // Import it back: the handle clashes, so it lands as @maya_2 with the
    // reference re-indexed under Characters/@maya_2/imported/.
    const imported = await importCharacterBundle(services, {
      bundle_path: exported.bundle_path,
      on_conflict: 'rename',
    });
    expect(imported.handle).toBe('maya_2');
    expect(imported.references_imported).toBe(1);
    expect(
      existsSync(join(library, 'Characters', '@maya_2', 'imported', `anchor_front_${assetId}.png`)),
    ).toBe(true);

    const roundTripped = await lookupHandle(state, 'maya_2');
    expect(roundTripped).not.toBeNull();
    const version = await loadVersion(state, roundTripped!.id);
    expect(version.display_name).toBe('Maya');
    expect(version.appearance.descriptor).toBe('a calm ceramicist');
    expect(version.references).toHaveLength(1);

    // Item 1: the import minted a fresh asset id; the original reference's row
    // still points at inbox/anchor.png (it was NOT re-pointed to the imported
    // path), and the imported reference is a different asset id.
    const original = (await state.db.select().from(assets).where(eq(assets.id, assetId)))[0];
    expect(original?.path).toBe('inbox/anchor.png');
    const importedId = version.references[0]!.asset_id;
    expect(importedId).not.toBe(assetId);
    const importedRow = (await state.db.select().from(assets).where(eq(assets.id, importedId)))[0];
    expect(importedRow?.path).toBe('Characters/@maya_2/imported/anchor_front_' + assetId + '.png');
    // The exporter's id is kept as provenance in the imported sidecar's lineage.
    const importedSidecar = await readSidecar(join(library, importedRow!.path));
    expect(importedSidecar.ok && importedSidecar.value.lineage.made_from).toContain(assetId);
  }, 30_000);

  it('on_conflict version forks a new version and leaves the old version untouched', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-char-version-'));
    const dataDir = join(root, 'data');
    const library = join(root, 'library');
    const bundlesRoot = join(root, 'bundles');
    mkdirSync(dataDir);
    mkdirSync(bundlesRoot);
    const prepared = prepareLibraryRoot(library, dataDir);
    const state = createDatabase(dataDir, { memory: true });
    disposers.push(async () => {
      await closeDatabaseState(state);
      rmSync(root, { recursive: true, force: true });
    });
    await state.ready;
    const refAbs = join(library, 'inbox', 'anchor.png');
    writeFileSync(
      refAbs,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const assetId = (await indexAsset(state, library, refAbs, prepared.marker.library_id)).sidecar.asset_id;
    const created = await createCharacter(state, {
      handle: 'maya',
      kind: 'character',
      display_name: 'Maya',
      appearance: { descriptor: 'v1 look', anchors: [], negative_traits: [] },
    });
    await addReferences(state, created.id, [{ asset_id: assetId, role: 'anchor', view: 'front' }]);
    const services: CharacterBundleServices = {
      db: state,
      libraryRoot: library,
      bundlesRoot,
      exportsRoot: join(library, 'Exports'),
      kilnryVersion: '0.5.0-test',
      zipDir,
      unzipTo,
      indexAsset: async (rel) =>
        (await indexAsset(state, library, join(library, rel), prepared.marker.library_id)).sidecar.asset_id,
    };
    const exported = await exportCharacterBundle(services, { handle: 'maya' });
    const v1RefsBefore = (await loadVersion(state, created.id, 1)).references.length;

    const imported = await importCharacterBundle(services, {
      bundle_path: exported.bundle_path,
      on_conflict: 'version',
    });
    expect(imported.handle).toBe('maya');
    const versions = await listVersions(state, created.id);
    expect(versions.length).toBe(2);
    // The previous version's references are unchanged.
    expect((await loadVersion(state, created.id, 1)).references.length).toBe(v1RefsBefore);
    expect(imported.version).toBe(2);
  }, 30_000);

  it('resets consent to none when importing a real person without a confirmed release', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilnry-char-consent-'));
    const dataDir = join(root, 'data');
    const library = join(root, 'library');
    const bundlesRoot = join(root, 'bundles');
    mkdirSync(dataDir);
    mkdirSync(bundlesRoot);
    const prepared = prepareLibraryRoot(library, dataDir);
    const state = createDatabase(dataDir, { memory: true });
    disposers.push(async () => {
      await closeDatabaseState(state);
      rmSync(root, { recursive: true, force: true });
    });
    await state.ready;

    const created = await createCharacter(state, {
      handle: 'realperson',
      kind: 'character',
      display_name: 'Real Person',
      is_real_person: true,
      appearance: { descriptor: 'a person', anchors: [], negative_traits: [] },
    });
    const services: CharacterBundleServices = {
      db: state,
      libraryRoot: library,
      bundlesRoot,
      exportsRoot: join(library, 'Exports'),
      kilnryVersion: '0.5.0-test',
      zipDir,
      unzipTo,
      indexAsset: async (rel) =>
        (await indexAsset(state, library, join(library, rel), prepared.marker.library_id)).sidecar.asset_id,
    };
    // Item 3: a real person at consent none cannot be exported.
    await expect(exportCharacterBundle(services, { handle: 'realperson' })).rejects.toThrow(
      /Record permission first/,
    );
    // With consent recorded, export is allowed; importing without a confirmed
    // release resets the imported copy's consent to none.
    await setConsent(state, created.id, { is_real_person: true, status: 'self' });
    const exported = await exportCharacterBundle(services, { handle: 'realperson' });
    const imported = await importCharacterBundle(services, {
      bundle_path: exported.bundle_path,
      on_conflict: 'rename',
    });
    expect(imported.consent_status).toBe('none');
    expect(imported.notes.join(' ')).toMatch(/consent was reset to none/);
  }, 30_000);
});
