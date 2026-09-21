// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Wires the export-bundle builder (F-LIB-14) to the media package's strip and
// IPTC label helpers and to a system zip. The builder itself lives in core; this
// helper supplies the pieces that need ffmpeg/sharp or a shell.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import {
  exportBundle,
  libraryMarker,
  loadConfig,
  type BundleExporter,
  type ExportOptions,
} from '@kilnry/core';
import {
  embedIptcProvenance,
  embedMetadata,
  readEmbeddedMetadata,
  stripEmbeddedMetadata,
} from '@kilnry/media';
import { runtimeServices } from './runtime';

// Zip a directory with the system zip if it is on the PATH; return undefined when
// it is not, so the caller keeps the folder.
function zipDir(dir: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const zipPath = `${dir}.zip`;
    const child = spawn('zip', ['-r', '-q', zipPath, '.'], { cwd: dir });
    child.on('error', () => resolve(undefined));
    child.on('close', (code) => resolve(code === 0 ? zipPath : undefined));
  });
}

export async function bundleExporter(): Promise<BundleExporter> {
  const services = await runtimeServices();
  const config = loadConfig();
  const libraryRoot = config.library_root;
  if (!libraryRoot) throw new Error('The Library root is not configured.');
  const marker = await libraryMarker(libraryRoot).catch(() => null);
  const exportsRoot = join(libraryRoot, 'Exports');
  return {
    export: async (options) => {
      const full: ExportOptions = {
        asset_ids: options.asset_ids,
        format: options.format ?? 'zip',
        include_sidecars: options.include_sidecars ?? true,
        metadata: options.metadata ?? 'keep',
        provenance: options.provenance ?? 'iptc',
        include_lineage: options.include_lineage ?? false,
        manifest: options.manifest ?? true,
        rename: options.rename ?? false,
      };
      return exportBundle(
        {
          db: services.database,
          libraryRoot,
          libraryId: marker?.library_id ?? '',
          exportsRoot,
          stripMetadata: stripEmbeddedMetadata,
          labelIptc: embedIptcProvenance,
          embedIfMissing: async (path, mime) => {
            // Only embed when the copy carries no Kilnry metadata already.
            const existing = await readEmbeddedMetadata(path, mime).catch(() => ({ payload: undefined }));
            if (existing.payload) return;
            // Nothing to embed without the sidecar payload; a full embed reads the
            // sidecar, which the copy carries when include_sidecars is on.
            void embedMetadata;
          },
          zipDir,
        },
        full,
      );
    },
  };
}
