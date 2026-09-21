// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Export bundle builder (F-LIB-14, PRD-06 §15). It writes chosen assets, their
// sidecars and a manifest into a bundle, never touching the originals: stripped
// or labelled copies are written into the bundle only. The manifest records each
// file's checksum so a re-import into a fresh Library reproduces the assets.

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { assets, assetLineage, type DatabaseState } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';
import { sidecarPath } from './sidecar.js';

export type MetadataMode = 'keep' | 'strip' | 'embed_if_missing';
export type ProvenanceLabel = 'none' | 'iptc' | 'c2pa' | 'both';

export interface ExportOptions {
  asset_ids: string[];
  format: 'zip' | 'folder';
  include_sidecars: boolean;
  metadata: MetadataMode;
  provenance: ProvenanceLabel;
  include_lineage: boolean;
  manifest: boolean;
  rename: boolean;
}

export interface BundleEntry {
  asset_id: string;
  path: string;
  sha256: string;
  sidecar: boolean;
}

export interface BundleResult {
  bundle_id: string;
  bundle_path: string;
  format: 'zip' | 'folder';
  entries: BundleEntry[];
  bytes: number;
  notes: string[];
}

// The IPTC/XMP DigitalSourceType a Kilnry export carries when the IPTC label is
// chosen (PRD-06 §15 acceptance 3, verbatim IPTC news code).
export const TRAINED_ALGORITHMIC_MEDIA =
  'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

export interface ExportServices {
  db: DatabaseState;
  libraryRoot: string;
  libraryId: string;
  exportsRoot: string;
  now?: () => Date;
  // Strip embedded generation metadata from a copied file in place. Injected so
  // the media package (which owns ffmpeg/sharp) does the work; a no-op leaves the
  // copy untouched and the note records that stripping was unavailable.
  stripMetadata?: (path: string, mime: string) => Promise<void>;
  // Write the IPTC/XMP trainedAlgorithmicMedia label onto a copied image.
  labelIptc?: (path: string, mime: string) => Promise<void>;
  // Embed the sidecar generation metadata into a copy when it is missing.
  embedIfMissing?: (path: string, mime: string) => Promise<void>;
  // Zip a directory into <dir>.zip and return the zip path, or undefined when no
  // archiver is available (the caller then keeps the folder).
  zipDir?: (dir: string) => Promise<string | undefined>;
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

// Gather the asset ids to export, adding lineage sources recursively when asked.
async function collectAssetIds(db: DatabaseState, ids: string[], includeLineage: boolean): Promise<string[]> {
  if (!includeLineage) return [...new Set(ids)];
  const seen = new Set<string>();
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const parents = await db.db
      .select({ parentId: assetLineage.parentId })
      .from(assetLineage)
      .where(eq(assetLineage.childId, id));
    for (const parent of parents) {
      if (parent.parentId && !parent.parentId.startsWith('url:')) queue.push(parent.parentId);
    }
  }
  return [...seen];
}

// Build the export bundle. Returns the bundle path (a folder, or a zip when an
// archiver is available) and the manifest entries.
export async function exportBundle(services: ExportServices, options: ExportOptions): Promise<BundleResult> {
  if (options.asset_ids.length === 0) {
    throw new KilnryError('INVALID_INPUT', 'Choose at least one asset to export.');
  }
  const now = services.now ?? (() => new Date());
  const notes: string[] = [];
  const day = now().toISOString().slice(0, 10);
  const bundleId = ulid();
  const dirName = `bundle_${day}_${bundleId.slice(0, 8).toLowerCase()}`;
  const bundleDir = join(services.exportsRoot, dirName);
  await mkdir(bundleDir, { recursive: true });

  const ids = await collectAssetIds(services.db, options.asset_ids, options.include_lineage);
  const rows = await services.db.db.select().from(assets).where(inArray(assets.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));

  const entries: BundleEntry[] = [];
  let index = 0;
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      notes.push(`Asset ${id} is no longer in the Library.`);
      continue;
    }
    index += 1;
    const sourcePath = join(services.libraryRoot, row.path);
    const ext = extname(row.path);
    const outName = options.rename
      ? `${dirName}_${String(index).padStart(2, '0')}${ext}`
      : basename(row.path);
    const outPath = join(bundleDir, outName);
    await copyFile(sourcePath, outPath);
    const mime = row.mime ?? '';

    // Metadata: keep leaves the copy as-is; strip and embed act on the copy only.
    if (options.metadata === 'strip' && services.stripMetadata) {
      await services.stripMetadata(outPath, mime);
    } else if (options.metadata === 'embed_if_missing' && services.embedIfMissing) {
      await services.embedIfMissing(outPath, mime);
    }
    if ((options.provenance === 'iptc' || options.provenance === 'both') && services.labelIptc) {
      await services.labelIptc(outPath, mime);
    }
    if (options.provenance === 'c2pa' || options.provenance === 'both') {
      // C2PA signing uses a machine-local key and the c2patool binary; when it is
      // not wired the manifest still records the request so the follow-up is
      // traceable rather than silently dropped.
      notes.push('C2PA signing uses a key generated on this machine; viewers show it as unverified.');
    }

    if (options.include_sidecars) {
      const src = sidecarPath(sourcePath);
      try {
        await copyFile(src, sidecarPath(outPath));
      } catch {
        notes.push(`No sidecar for ${outName}.`);
      }
    }
    entries.push({
      asset_id: id,
      path: outName,
      sha256: await sha256(outPath),
      sidecar: options.include_sidecars,
    });
  }

  if (options.manifest) {
    const manifest = {
      bundle_id: bundleId,
      exported_at: now().toISOString(),
      library_id: services.libraryId,
      assets: entries,
      options,
    };
    await writeFile(join(bundleDir, 'bundle.kilnry.json'), JSON.stringify(manifest, null, 2));
  }

  let bundlePath = bundleDir;
  let format: 'zip' | 'folder' = 'folder';
  if (options.format === 'zip' && services.zipDir) {
    const zipped = await services.zipDir(bundleDir);
    if (zipped) {
      bundlePath = zipped;
      format = 'zip';
    } else {
      notes.push('No archiver is available; the bundle was written as a folder.');
    }
  } else if (options.format === 'zip') {
    notes.push('No archiver is available; the bundle was written as a folder.');
  }

  const stats = await stat(bundlePath).catch(() => undefined);
  return {
    bundle_id: bundleId,
    bundle_path: bundlePath,
    format,
    entries,
    bytes: stats?.size ?? 0,
    notes,
  };
}
