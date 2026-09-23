// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Wires the voice-clone orchestrator (F-VOI-02) and the priced preview and
// delete helpers (F-VOI-01) to the running services: the encrypted key store
// and the database. Consent and the sample-length check live inside cloneVoice,
// and the preview is priced and ledgered inside previewVoice, so these helpers
// only hand over keys and the provider synthesis call.

import {
  KilnryError,
  cloneVoice,
  deleteVoice,
  previewVoice,
  type VoiceCloner,
  type VoiceDeleter,
  type VoicePreviewer,
} from '@kilnry/core';
import { synthesizeSpeech } from '@kilnry/providers';
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

export async function voicePreviewer(): Promise<VoicePreviewer> {
  const services = await runtimeServices();
  return {
    preview: (input) =>
      previewVoice(
        {
          db: services.database,
          synth: async ({ provider, voiceId, text }) => {
            if (provider !== 'elevenlabs') {
              throw new KilnryError(
                'NO_PROVIDER',
                `Previews for ${provider} voices arrive with that provider's synthesis path. Connect an ElevenLabs key to preview ElevenLabs voices now.`,
              );
            }
            const key = await services.keyStore.get('elevenlabs');
            if (!key) {
              throw new KilnryError(
                'NO_PROVIDER',
                'Connect an ElevenLabs key in Settings › Providers to preview.',
              );
            }
            return synthesizeSpeech({ key, voice_id: voiceId, text });
          },
        },
        input,
      ),
  };
}

export async function voiceDeleter(): Promise<VoiceDeleter> {
  const services = await runtimeServices();
  return {
    delete: (voiceUlid) => deleteVoice(services.database, voiceUlid),
  };
}
