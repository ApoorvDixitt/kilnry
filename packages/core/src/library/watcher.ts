// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import chokidar, { type FSWatcher } from 'chokidar';
import { existsSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { eq } from 'drizzle-orm';
import type { DatabaseState } from '@kilnry/db';
import { assets } from '@kilnry/db';
import { createDerivatives } from '@kilnry/media';
import { indexAsset } from './index.js';

export interface LibraryWatcher {
  close(): Promise<void>;
  ready: Promise<void>;
}

// Decide whether a path under the watched root should be ignored. The test runs
// against the path *relative to the root*, so a Library whose root itself lives
// under a dot-directory (for example a temporary "…/.dev/library" used in tests,
// or a hidden folder in someone's home) does not have every file ignored just
// because the root's own prefix contains a dot segment.
function ignored(path: string, root: string): boolean {
  const rel = relative(root, path);
  // A path outside the root (empty or starting with "..") is never watched here.
  if (rel === '' ) return false;
  return (
    /(^|[/\\])\.[^/\\]+/.test(rel) ||
    /(^|[/\\])Trash(?:[/\\]|$)/.test(rel) ||
    /\.(?:part|crdownload|download)$/.test(rel) ||
    /\.kilnry\.json\.tmp-.*$/.test(rel)
  );
}

export function watchLibrary(input: {
  state: DatabaseState;
  root: string;
  libraryId: string;
  dataDir?: string;
  polling?: boolean;
  stabilityThresholdMs?: number;
  debounceMs?: number;
  onImported?: (assetId: string, folder: string) => void;
  onError: (error: unknown) => void;
}): LibraryWatcher {
  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  const watcher: FSWatcher = chokidar.watch(input.root, {
    ignoreInitial: true,
    followSymlinks: false,
    awaitWriteFinish: {
      stabilityThreshold: input.stabilityThresholdMs ?? 2000,
      pollInterval: Math.min(200, input.stabilityThresholdMs ?? 2000),
    },
    usePolling: input.polling ?? false,
    interval: input.polling ? 2000 : 100,
    binaryInterval: input.polling ? 3000 : 300,
    ignored: (path: string) => ignored(path, input.root),
    atomic: 250,
    ignorePermissionErrors: true,
  });
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const schedule = (path: string): void => {
    const mediaPath = path.endsWith('.kilnry.json') ? path.slice(0, -'.kilnry.json'.length) : path;
    const prior = pending.get(mediaPath);
    if (prior) clearTimeout(prior);
    pending.set(
      mediaPath,
      setTimeout(() => {
        pending.delete(mediaPath);
        void indexAsset(input.state, input.root, mediaPath, input.libraryId)
          .then(async (result) => {
            if (input.dataDir) {
              await createDerivatives({
                source: mediaPath,
                dataDir: input.dataDir,
                assetId: result.sidecar.asset_id,
                mime: result.sidecar.file.mime,
                ...(result.sidecar.file.duration_s === undefined
                  ? {}
                  : { durationS: result.sidecar.file.duration_s }),
              });
            }
            input.onImported?.(
              result.sidecar.asset_id,
              relative(input.root, dirname(mediaPath)).split('\\').join('/'),
            );
          })
          .catch(input.onError);
      }, input.debounceMs ?? 500),
    );
  };
  const markMissing = (path: string): void => {
    const mediaPath = path.endsWith('.kilnry.json') ? path.slice(0, -'.kilnry.json'.length) : path;
    const scheduled = pending.get(mediaPath);
    if (scheduled) {
      clearTimeout(scheduled);
      pending.delete(mediaPath);
    }
    const relativePath = relative(input.root, mediaPath).split('\\').join('/');
    void input.state.db
      .update(assets)
      .set({ sidecarOk: false })
      .where(eq(assets.path, relativePath))
      .catch(input.onError);
  };
  watcher.on('ready', () => readyResolve());
  watcher.on('add', (path) => {
    const mediaPath = path.endsWith('.kilnry.json') ? path.slice(0, -'.kilnry.json'.length) : path;
    if (!path.endsWith('.kilnry.json') || existsSync(mediaPath)) schedule(path);
  });
  watcher.on('change', schedule);
  watcher.on('unlink', markMissing);
  watcher.on('error', input.onError);
  return {
    ready,
    async close() {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      await watcher.close();
    },
  };
}
