// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { constants, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { opendir, copyFile, mkdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import { eq } from 'drizzle-orm';
import { assets } from '@kilnry/db';
import { createDerivatives } from '@kilnry/media';
import type { DatabaseState } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { resolveInRoot } from './containment.js';
import { indexAsset } from './index.js';
import { safeFetch } from '../security/ssrf.js';

export interface ImportReport {
  scanned: number;
  imported: number;
  recovered: number;
  errors: Array<{ path: string; message: string }>;
}

async function walkMedia(directory: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const handle = await opendir(dir);
    for await (const entry of handle) {
      if (entry.name.startsWith('.') || entry.name === 'Trash') continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(path);
      else if (
        !entry.name.endsWith('.kilnry.json') &&
        !/\.(?:part|crdownload|download|tmp-[^/]+)$/.test(entry.name)
      ) {
        files.push(path);
      }
    }
  };
  await walk(directory);
  return files.sort((left, right) => left.localeCompare(right));
}

// Import an existing folder that already lives inside the Library root: probe,
// hash, thumbnail and write a sidecar for each media file in place, without
// moving or altering the bytes. Duplicates and already-indexed files are handled
// by indexAsset's sha256 reconciliation. Nothing outside the root is touched.
export async function importFolder(
  state: DatabaseState,
  root: string,
  libraryId: string,
  folderRel: string,
  options: {
    dataDir?: string;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<ImportReport> {
  const target = folderRel ? await resolveInRoot(root, folderRel, { mustExist: true }) : { abs: root };
  const files = await walkMedia(target.abs);
  let imported = 0;
  let recovered = 0;
  const errors: ImportReport['errors'] = [];

  for (const file of files) {
    try {
      const result = await indexAsset(state, root, file, libraryId);
      if (options.dataDir) {
        await createDerivatives({
          source: file,
          dataDir: options.dataDir,
          assetId: result.sidecar.asset_id,
          mime: result.sidecar.file.mime,
          ...(result.sidecar.file.duration_s === undefined
            ? {}
            : { durationS: result.sidecar.file.duration_s }),
        });
      }
      imported += 1;
      if (result.recovered) recovered += 1;
    } catch (error) {
      errors.push({
        path: relative(root, file),
        message: error instanceof Error ? error.message : String(error),
      });
    }
    options.onProgress?.(imported + errors.length, files.length);
  }

  return { scanned: files.length, imported, recovered, errors };
}

export interface PathImportReport extends ImportReport {
  /** in_place for a folder already under the root; otherwise copy or move. */
  mode: 'in_place' | 'copy' | 'move';
  /** The Library-relative folder the files landed in. */
  destination: string;
  /** Files whose bytes are already in the Library, not imported again. */
  duplicates: number;
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Import a folder anywhere on this machine (PRD-06 §2, F-ONB-07): "Default is
 * in-place when the source is already inside the Library root; otherwise copy
 * into the chosen folder (`inbox/` default) unless `--move`." The Library's
 * "Import folder" only re-indexed the folder already shown, so a folder of
 * renders kept elsewhere had no way in (F-125).
 *
 * Outside the root, each media file (the same walk as importFolder: no dot
 * files, no symbolic links, no sidecars or partial downloads) lands under
 * `<into>/<source folder name>/` with its subfolders kept, so two imports
 * cannot collide (default; adjustable). Every destination goes through
 * resolveInRoot. A file whose sha256 is already in the Library is skipped and
 * counted, as PRD-06 §2 says; with `move` it is left where it was.
 */
export async function importFromPath(
  state: DatabaseState,
  root: string,
  libraryId: string,
  input: { source: string; into?: string; mode?: 'copy' | 'move'; dataDir?: string },
): Promise<PathImportReport> {
  if (!isAbsolute(input.source)) {
    throw new KilnryError('INVALID_INPUT', 'Give the full path of the folder to import.');
  }
  let source: string;
  try {
    source = await realpath(input.source);
    if (!(await stat(source)).isDirectory()) throw new Error('not a folder');
  } catch {
    throw new KilnryError('NOT_FOUND', `No folder at ${input.source}.`);
  }
  const rootReal = await realpath(root);
  const inside = relative(rootReal, source);
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
    const folderRel = inside.split(sep).join('/');
    const report = await importFolder(state, root, libraryId, folderRel, {
      ...(input.dataDir === undefined ? {} : { dataDir: input.dataDir }),
    });
    return { ...report, mode: 'in_place', destination: folderRel, duplicates: 0 };
  }

  const mode = input.mode ?? 'copy';
  const destination = join(input.into ?? 'inbox', basename(source))
    .split(sep)
    .join('/');
  const files = await walkMedia(source);
  const report: PathImportReport = {
    scanned: files.length,
    imported: 0,
    recovered: 0,
    errors: [],
    mode,
    destination,
    duplicates: 0,
  };
  for (const file of files) {
    const rel = relative(source, file).split(sep).join('/');
    try {
      const sha = await sha256Of(file);
      const known = await state.db
        .select({ id: assets.id })
        .from(assets)
        .where(eq(assets.sha256, sha))
        .limit(1);
      if (known.length > 0) {
        report.duplicates += 1;
        continue;
      }
      let target = await resolveInRoot(root, `${destination}/${rel}`, { mustExist: false });
      for (let n = 2; await exists(target.abs); n += 1) {
        const ext = extname(rel);
        target = await resolveInRoot(
          root,
          `${destination}/${rel.slice(0, rel.length - ext.length)}-${n}${ext}`,
          {
            mustExist: false,
          },
        );
      }
      await mkdir(dirname(target.abs), { recursive: true });
      if (mode === 'move') await moveFile(file, target.abs);
      else await copyFile(file, target.abs, constants.COPYFILE_EXCL);
      const result = await indexAsset(state, root, target.abs, libraryId);
      if (input.dataDir) {
        await createDerivatives({
          source: target.abs,
          dataDir: input.dataDir,
          assetId: result.sidecar.asset_id,
          mime: result.sidecar.file.mime,
          ...(result.sidecar.file.duration_s === undefined
            ? {}
            : { durationS: result.sidecar.file.duration_s }),
        });
      }
      report.imported += 1;
    } catch (error) {
      report.errors.push({ path: rel, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// A rename, or a copy and delete when the source is on another volume.
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(from, to, constants.COPYFILE_EXCL);
    await unlink(from);
  }
}

// The result of importing a list of sources (kilnry_import, F-ONB-07): the
// assets that landed and a per-source error list.
export interface ImportSourcesResult {
  assets: Array<{ source: string; asset_id: string; path: string; type: string }>;
  errors: Array<{ source: string; code: string; message: string }>;
}

// A safe file name derived from a URL path or an absolute path.
function importName(source: string): string {
  try {
    if (/^https?:\/\//i.test(source)) {
      const name = basename(new URL(source).pathname) || 'import';
      return name.replace(/[^\w.-]/g, '_');
    }
  } catch {
    // Fall through to the path form.
  }
  return basename(source).replace(/[^\w.-]/g, '_') || 'import';
}

// Import each source into the target folder under the Library root. An https URL
// is fetched through the SSRF-guarded fetch and written into the folder; an
// absolute path is copied in. Every file is then indexed with a sidecar. Errors
// are collected per source rather than aborting the whole call.
export async function importSources(
  state: DatabaseState,
  root: string,
  libraryId: string,
  input: {
    sources: string[];
    targetFolder?: string;
    dataDir?: string;
    fetchImpl?: typeof safeFetch;
  },
): Promise<ImportSourcesResult> {
  const fetchImpl = input.fetchImpl ?? safeFetch;
  const folderRel = input.targetFolder ?? 'inbox';
  const target = await resolveInRoot(root, folderRel, { mustExist: false });
  await mkdir(target.abs, { recursive: true, mode: 0o700 });

  const result: ImportSourcesResult = { assets: [], errors: [] };
  for (const source of input.sources) {
    try {
      const dest = join(target.abs, importName(source));
      if (/^https?:\/\//i.test(source)) {
        const response = await fetchImpl(source);
        if (!response.ok) throw new Error(`The source returned HTTP ${response.status}.`);
        const bytes = Buffer.from(await response.arrayBuffer());
        await writeFile(dest, bytes, { mode: 0o600 });
      } else if (source.startsWith('/')) {
        await copyFile(source, dest);
      } else {
        result.errors.push({
          source,
          code: 'INVALID_INPUT',
          message: 'A source must be an https URL or an absolute path.',
        });
        continue;
      }
      const indexed = await indexAsset(state, root, relative(root, dest), libraryId);
      if (input.dataDir) {
        await createDerivatives({
          source: dest,
          dataDir: input.dataDir,
          assetId: indexed.sidecar.asset_id,
          mime: indexed.sidecar.file.mime,
          ...(indexed.sidecar.file.duration_s === undefined
            ? {}
            : { durationS: indexed.sidecar.file.duration_s }),
        });
      }
      result.assets.push({
        source,
        asset_id: indexed.sidecar.asset_id,
        path: relative(root, dest),
        type: indexed.sidecar.kind,
      });
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : 'PROVIDER_ERROR';
      result.errors.push({
        source,
        code,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
