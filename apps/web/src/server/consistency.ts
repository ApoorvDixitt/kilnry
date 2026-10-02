// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The consistency check service (F-CHR-12): enabling downloads the face models
// and runtime on demand (O-03), embeds the Character references, and from then
// on every finished image or video made with a photoreal Character is scored
// locally. Turning it off hides badges but keeps the stored scores.

import {
  CONSISTENCY_MANIFEST,
  OnnxFaceEmbedder,
  consistencyDownloadBytes,
  consistencyInstalled,
  embedCharacterReferences,
  installConsistencyModel,
  loadConfig,
  modelPath,
  runtimeDir,
  saveConfig,
  scoreAssetConsistency,
  type ConsistencyManifest,
  type FaceEmbedder,
  type InstallProgress,
} from '@kilnry/core';
import { log } from './log';

interface ConsistencyGlobal {
  __kilnryConsistencyProgress?: InstallProgress;
  __kilnryConsistencyInstall?: Promise<void>;
  __kilnryConsistencyEmbedder?: FaceEmbedder;
}

function globalState(): ConsistencyGlobal {
  return globalThis as ConsistencyGlobal;
}

// Under the acceptance harness the download is served by the mock from small
// fixture files and scoring uses a fixture embedder, so the real model never
// runs in CI. Refused in release builds.
function harness(): boolean {
  if (process.env.KILNRY_TEST_MSW !== '1') return false;
  if (process.env.KILNRY_RELEASE_BUILD === '1') {
    throw new Error('KILNRY_TEST_MSW is forbidden in release builds.');
  }
  return true;
}

async function manifest(): Promise<ConsistencyManifest> {
  if (!harness()) return CONSISTENCY_MANIFEST;
  const { consistencyFixtureManifest } = await import('../test/consistency-fixture');
  return consistencyFixtureManifest();
}

async function embedder(dataDir: string): Promise<FaceEmbedder> {
  const global = globalState();
  if (global.__kilnryConsistencyEmbedder) return global.__kilnryConsistencyEmbedder;
  if (harness()) {
    const { fixtureFaceEmbedder } = await import('../test/consistency-fixture');
    global.__kilnryConsistencyEmbedder = fixtureFaceEmbedder();
  } else {
    global.__kilnryConsistencyEmbedder = new OnnxFaceEmbedder({
      runtimeDir: runtimeDir(dataDir),
      detectorPath: modelPath(dataDir, 'detector'),
      recognizerPath: modelPath(dataDir, 'recognizer'),
    });
  }
  return global.__kilnryConsistencyEmbedder;
}

export interface ConsistencyStatus {
  enabled: boolean;
  installed: boolean;
  download_bytes: number;
  progress: InstallProgress;
}

export async function consistencyStatus(): Promise<ConsistencyStatus> {
  const config = loadConfig();
  const files = await manifest();
  // The size shown is the real download, even under the harness's small fixture.
  return {
    enabled: config.consistency_check,
    installed: await consistencyInstalled(config.data_dir, files),
    download_bytes: consistencyDownloadBytes(CONSISTENCY_MANIFEST),
    progress: globalState().__kilnryConsistencyProgress ?? { phase: 'idle', received: 0, total: 0 },
  };
}

// Turn the check on: download and verify the files if needed, embed the
// Character references, then switch the config on. The download runs in the
// background and reports progress.
export async function enableConsistency(
  state: Parameters<typeof scoreAssetConsistency>[0]['state'],
  libraryRoot: string,
): Promise<void> {
  const global = globalState();
  const config = loadConfig();
  const files = await manifest();
  const finish = async (): Promise<void> => {
    await embedCharacterReferences({ state, libraryRoot, embedder: await embedder(config.data_dir) });
    saveConfig({ ...loadConfig(), consistency_check: true });
  };
  if (await consistencyInstalled(config.data_dir, files)) {
    await finish();
    global.__kilnryConsistencyProgress = { phase: 'installed', received: 0, total: 0 };
    return;
  }
  global.__kilnryConsistencyInstall ??= installConsistencyModel({
    dataDir: config.data_dir,
    manifest: files,
    onProgress: (progress) => {
      // "installed" is reported once the references are embedded too.
      if (progress.phase !== 'installed') global.__kilnryConsistencyProgress = progress;
    },
  })
    .then(async () => {
      await finish();
      global.__kilnryConsistencyProgress = {
        phase: 'installed',
        received: consistencyDownloadBytes(files),
        total: consistencyDownloadBytes(files),
      };
    })
    .catch((error: unknown) => {
      global.__kilnryConsistencyProgress = {
        phase: 'failed',
        received: 0,
        total: consistencyDownloadBytes(files),
        error: error instanceof Error ? error.message : String(error),
      };
      log.error({ err: error }, 'consistency_install_failed');
    })
    .finally(() => {
      delete global.__kilnryConsistencyInstall;
    });
  global.__kilnryConsistencyProgress = {
    phase: 'downloading',
    received: 0,
    total: consistencyDownloadBytes(files),
  };
}

export function disableConsistency(): void {
  saveConfig({ ...loadConfig(), consistency_check: false });
}

// Score the assets a finished job produced. Errors are logged by asset id, never
// with an embedding, and never fail the job: the check is a signal, not a gate.
export async function scoreFinishedAssets(
  services: Parameters<typeof scoreAssetConsistency>[0]['state'],
  libraryRoot: string,
  assetIds: string[],
): Promise<void> {
  const config = loadConfig();
  if (!config.consistency_check) return;
  if (!(await consistencyInstalled(config.data_dir, await manifest()))) return;
  const face = await embedder(config.data_dir);
  for (const assetId of assetIds) {
    try {
      await scoreAssetConsistency({ state: services, libraryRoot, assetId, embedder: face });
    } catch (error) {
      log.error(
        { err: error instanceof Error ? error.message : String(error), asset_id: assetId },
        'consistency_score_failed',
      );
    }
  }
}
