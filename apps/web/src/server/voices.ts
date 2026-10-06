// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Wires the voice-clone orchestrator (F-VOI-02) and the priced preview and
// delete helpers (F-VOI-01) to the running services: the encrypted key store
// and the database. Consent and the sample-length check live inside cloneVoice,
// and the preview is priced and ledgered inside previewVoice, so these helpers
// only hand over keys and the provider synthesis call.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  KilnryError,
  cloneVoice,
  deleteVoice,
  designVoice,
  indexAsset,
  libraryMarker,
  loadConfig,
  previewVoice,
  ulid,
  type DesignInput,
  type DesignResult,
  type VoiceCloner,
  type VoiceDeleter,
  type VoicePreviewer,
  safeFetch,
  getAssetDetail,
  resolveInRoot,
} from '@kilnry/core';
import { adapters, synthesizeSpeech } from '@kilnry/providers';
import { runtimeServices } from './runtime';

export async function voiceCloner(): Promise<VoiceCloner> {
  const services = await runtimeServices();
  return {
    clone: (input) =>
      cloneVoice(
        {
          db: services.database,
          keyFor: (provider) => services.keyStore.get(provider),
          uploadSample: (assetId, provider) => uploadVoiceSample(assetId, provider),
        },
        input,
      ),
  };
}

/**
 * Put a Library recording where the clone provider can fetch it (F-118). Every
 * clone endpoint takes a URL the provider downloads itself, so a file on the
 * user's own disk has to be uploaded first; fal's storage is reached through the
 * adapter's own uploadFile (TRD-06 §3.1). MiniMax's and ElevenLabs' direct
 * endpoints take a multipart body rather than a presigned address, so a local
 * file for those two still needs their own upload call — the drawer only offers
 * the file field for the providers this can serve.
 */
async function uploadVoiceSample(assetId: string, provider: string): Promise<string> {
  const services = await runtimeServices();
  const config = loadConfig();
  if (!config.library_root) throw new KilnryError('NOT_FOUND', 'Library root is not configured.');
  const adapter = adapters[provider as keyof typeof adapters];
  if (!adapter?.uploadFile) {
    throw new KilnryError(
      'INVALID_INPUT',
      `${provider} needs a public sample URL; Kilnry cannot upload a local file to it yet.`,
    );
  }
  const key = await services.keyStore.get(provider as never);
  if (!key) throw new KilnryError('NO_PROVIDER', `${provider} has no connected key.`);
  const asset = await getAssetDetail(services.database, config.library_root, assetId);
  const resolved = await resolveInRoot(config.library_root, asset.path, { mustExist: true });
  const bytes = await readFile(resolved.abs);
  const uploaded = await adapter.uploadFile(
    {
      bytes: new Uint8Array(bytes),
      mime: asset.mime ?? 'audio/mpeg',
      file_name: asset.path.split('/').pop() ?? 'sample',
    },
    { key, fetch, signal: AbortSignal.timeout(120_000), log: () => undefined },
  );
  return uploaded.url;
}

export interface VoiceDesigner {
  design: (input: DesignInput) => Promise<DesignResult>;
}

export async function voiceDesigner(): Promise<VoiceDesigner> {
  const services = await runtimeServices();
  const config = loadConfig();
  const libraryRoot = config.library_root;
  const marker = libraryRoot ? await libraryMarker(libraryRoot).catch(() => null) : null;
  return {
    design: (input) =>
      designVoice(
        {
          db: services.database,
          keyFor: (provider) => services.keyStore.get(provider),
          // Save the provider's preview audio as an asset so a paid design is
          // audible in the voices list, the way clone previews are (item 7). It
          // is fetched into the Library and indexed; a failure leaves the voice
          // without a preview rather than failing the whole design.
          ...(libraryRoot && marker
            ? {
                storePreview: ({ url, name }) =>
                  storeVoicePreview({
                    database: services.database,
                    libraryRoot,
                    libraryId: marker.library_id,
                    url,
                    name,
                  }),
              }
            : {}),
        },
        input,
      ),
  };
}

/**
 * Save a provider's voice-design preview into the Library and return its asset
 * id. The fetch goes through the SSRF guard with a 25 MB cap (F-24): a plain
 * fetch had no address check, no size limit and no deadline, so a misbehaving
 * provider could point Kilnry at a private or cloud-metadata address, or hang
 * the request while writing an unbounded file.
 */
export async function storeVoicePreview(input: {
  database: Parameters<typeof indexAsset>[0];
  libraryRoot: string;
  libraryId: string;
  url: string;
  name: string;
  fetchImpl?: typeof safeFetch;
}): Promise<string | undefined> {
  const fetchImpl = input.fetchImpl ?? safeFetch;
  const response = await fetchImpl(input.url, { max_bytes: 25 * 1024 * 1024 });
  if (!response.ok) return undefined;
  const bytes = Buffer.from(await response.arrayBuffer());
  const voicesDir = join(input.libraryRoot, 'Characters', '_voices');
  await mkdir(voicesDir, { recursive: true });
  const safe = input.name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'voice';
  const absolute = join(voicesDir, `${safe}-${ulid()}.mp3`);
  await writeFile(absolute, bytes);
  const indexed = await indexAsset(input.database, input.libraryRoot, absolute, input.libraryId);
  return indexed.sidecar.asset_id;
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
