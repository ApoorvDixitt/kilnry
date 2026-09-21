// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Wires the voice-clone orchestrator (F-VOI-02) to the running services: the
// encrypted key store and the database. Consent and the sample-length check live
// inside cloneVoice, so this helper only hands over keys.

import { cloneVoice, type VoiceCloner } from '@kilnry/core';
import { runtimeServices } from './runtime';

export async function voiceCloner(): Promise<VoiceCloner> {
  const services = await runtimeServices();
  return {
    clone: (input) =>
      cloneVoice(
        {
          db: services.database,
          keyFor: (provider) => services.keyStore.get(provider),
        },
        input,
      ),
  };
}
