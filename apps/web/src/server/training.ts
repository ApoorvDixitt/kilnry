// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Wires the identity-training orchestrator (F-CHR-07) to the running services:
// the provider adapters, the encrypted key store and the on-disk identities
// folder. The consent gate lives inside startTraining, so this helper only needs
// to hand over keys and paths.

import { join } from 'node:path';
import { startTraining, type ProviderAdapter, type TrainingRunner } from '@kilnry/core';
import { loadConfig } from '@kilnry/core/config';
import { adapters } from '@kilnry/providers';
import { runtimeServices } from './runtime';

export async function trainingRunner(): Promise<TrainingRunner> {
  const services = await runtimeServices();
  const config = loadConfig();
  const identitiesRoot = join(config.data_dir, 'identities');
  const trainerAdapters: Partial<Record<'fal' | 'replicate' | 'higgsfield', ProviderAdapter>> = {};
  if (adapters.fal) trainerAdapters.fal = adapters.fal;
  if (adapters.replicate) trainerAdapters.replicate = adapters.replicate;
  if (adapters.higgsfield) trainerAdapters.higgsfield = adapters.higgsfield;
  return {
    start: (input) =>
      startTraining(
        {
          db: services.database,
          adapters: trainerAdapters,
          keyFor: (trainer) => services.keyStore.get(trainer),
          assetUrl: (assetId) => `http://127.0.0.1:${process.env.KILNRY_PORT ?? '3123'}/api/media/${assetId}`,
          identitiesRoot,
        },
        input,
      ),
  };
}
