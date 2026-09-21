// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Wires the reference-sheet run (F-CHR-04) to the real job engine, the Library on
// disk, and the sharp splitter. The engine adapter routes each generate step
// through the same canonical request path the composer uses, so budget and
// confirmation rules apply. The sink reads a finished sheet's file, cuts it into
// panels with sharp, writes each view under the Character's folder with a
// sidecar carrying role "reference", the view tag, and lineage to the anchor,
// and registers it on the Character.

import { relative } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  addReferences,
  getAssetDetail,
  indexAsset,
  libraryMarker,
  loadConfig,
  readSidecar,
  resolveInRoot,
  writeSidecar,
  KilnryError,
  type SheetEngine,
  type SheetSink,
} from '@kilnry/core';
import { splitRowSheet } from '@kilnry/media';
import { jobs } from '@kilnry/db';
import { canonicalGeneration } from './generation-input';
import { ensureRuntimeEngine, runtimeServices } from './runtime';

function libraryRoot(): string {
  const config = loadConfig();
  if (!config.library_root) throw new KilnryError('NOT_FOUND', 'Library root is not configured.');
  return config.library_root;
}

// Build the engine adapter: map a sheet generate request onto the canonical
// request the engine expects and submit it.
export async function sheetEngine(): Promise<SheetEngine> {
  const engine = await ensureRuntimeEngine();
  return {
    async createJob(input) {
      const request = input.request as {
        prompt?: string;
        model?: string;
        params?: Record<string, unknown>;
        medias?: Array<{ role: string; ref: string }>;
      };
      const canonical = canonicalGeneration({
        kind: 'image',
        prompt: request.prompt ?? '',
        model: request.model ?? 'auto',
        params: request.params ?? {},
        medias: (request.medias ?? []).map((media) => ({
          role: media.role as never,
          asset_id: media.ref,
        })),
        count: 1,
        target_folder: 'inbox',
        override_budget: false,
        allow_stale_price: false,
        source: 'ui',
      });
      const created = await engine.createJob({
        request: canonical.request,
        constraints: canonical.constraints,
        confirmed_by: 'sheet',
        ...(input.client_request_id ? { client_request_id: input.client_request_id } : {}),
      });
      return { job_id: created.job_id, status: created.status };
    },
  };
}

// Build the sink that turns finished sheets into registered view files.
export async function sheetSink(): Promise<SheetSink> {
  const services = await runtimeServices();
  const root = libraryRoot();
  const marker = await libraryMarker(root);
  return {
    async assetPath(assetId) {
      try {
        const detail = await getAssetDetail(services.database, root, assetId);
        const resolved = await resolveInRoot(root, detail.path, { mustExist: false });
        return resolved.abs;
      } catch {
        return null;
      }
    },
    async jobOutputs(jobId) {
      const [row] = await services.database.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      return { status: row?.status ?? 'queued', assetIds: row?.outputAssetIds ?? [] };
    },
    async split(inputPath, outputs) {
      return splitRowSheet(inputPath, outputs);
    },
    async registerView({ characterId, path, view, anchorAssetId }) {
      const rel = relative(root, path);
      const indexed = await indexAsset(services.database, root, rel, marker.library_id);
      const abs = (await resolveInRoot(root, rel, { mustExist: true })).abs;
      // Tag the view with role and view, and record lineage to the anchor.
      const current = await readSidecar(abs);
      if (current.ok) {
        const sidecar = current.value;
        sidecar.tags = Array.from(new Set([...sidecar.tags, 'reference', `view:${view}`]));
        if (anchorAssetId && !sidecar.lineage.made_from.includes(anchorAssetId)) {
          sidecar.lineage.made_from.push(anchorAssetId);
        }
        await writeSidecar(abs, sidecar);
      }
      await addReferences(services.database, characterId, [
        { asset_id: indexed.sidecar.asset_id, role: 'reference', view },
      ]);
      return indexed.sidecar.asset_id;
    },
  };
}
