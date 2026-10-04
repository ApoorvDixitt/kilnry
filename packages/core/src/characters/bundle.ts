// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Character export / import bundle (F-CHR-14, TRD-14 §15). Export writes a
// self-contained character-<handle>-v<n>.kilnry-character.zip: character.json,
// the version's reference images and sidecars, a local LoRA only when the
// licence allows or the user opted in (hosted Soul IDs are never exportable),
// voices.json (provider + id only, account-bound), and a human README. Import
// validates the bundle, places references under Characters/@<handle>/imported/,
// verifies any LoRA's sha256, and resets consent for a real person unless the
// bundle carries a release and the importer confirms.

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { assets, characters, trainedIdentities, type DatabaseState } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import {
  addReferences,
  createCharacter,
  loadVersion,
  lookupHandle,
  normaliseHandle,
  type LoadedVersion,
} from './store.js';
import { sidecarPath } from '../library/sidecar.js';

// Licences under which a trained LoRA leaves the machine without an explicit
// opt-in (TRD-14 §9). Everything else needs the user to tick "include my LoRA".
const EXPORTABLE_LICENCES = new Set(['cc0', 'cc-by', 'commercial-release']);

export interface CharacterBundleManifest {
  schema_version: 1;
  exported_at: string;
  kilnry_version: string;
  character: {
    handle: string;
    kind: LoadedVersion['kind'];
    display_name: string;
    is_real_person: boolean;
    appearance: LoadedVersion['appearance'];
    injection_defaults?: LoadedVersion['injection_defaults'];
    references: Array<{ file: string; asset_id: string; role: string; view?: string; label?: string }>;
  };
  versions_included: number[];
  consent: { is_real_person: boolean; consent_status: string; release_included: boolean };
  license: string;
  identity?: { provider: string; kind: string; file: string; sha256: string };
  voices?: Array<{ provider: string; voice_id: string }>;
}

export interface CharacterBundleServices {
  db: DatabaseState;
  libraryRoot: string;
  bundlesRoot: string;
  kilnryVersion: string;
  now?: () => Date;
  // Zip a staged directory into <dir>.zip, or undefined when no archiver exists.
  zipDir: (dir: string) => Promise<string | undefined>;
  // Unzip a bundle into a fresh directory and return that directory.
  unzipTo: (zipPath: string, destDir: string) => Promise<void>;
  // Index a Library-relative path and return its asset id. Injected so the
  // bundle module does not depend on the engine; the host passes a closure over
  // indexAsset(db, libraryRoot, path, libraryId).
  indexAsset: (relativePath: string) => Promise<string>;
}

export interface CharacterExportOptions {
  handle: string;
  version?: number;
  include_lora?: boolean;
  include_release?: boolean;
}

export interface CharacterBundleResult {
  bundle_path: string;
  manifest: CharacterBundleManifest;
  notes: string[];
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function safeSegment(input: string): string {
  return input.replace(/[^a-z0-9_-]+/gi, '_');
}

export async function exportCharacterBundle(
  services: CharacterBundleServices,
  options: CharacterExportOptions,
): Promise<CharacterBundleResult> {
  const now = services.now ?? (() => new Date());
  const notes: string[] = [];
  const handle = normaliseHandle(options.handle);
  const found = await lookupHandle(services.db, handle);
  if (!found) throw new KilnryError('NOT_FOUND', `@${handle} is not a Character.`);
  const version = await loadVersion(services.db, found.id, options.version);
  const head = (
    await services.db.db.select().from(characters).where(eq(characters.id, found.id)).limit(1)
  )[0];
  if (!head) throw new KilnryError('NOT_FOUND', `@${handle} is not a Character.`);

  const stageName = `character-${safeSegment(handle)}-v${version.version}.kilnry-character`;
  const stageDir = join(services.bundlesRoot, stageName);
  await mkdir(join(stageDir, 'references'), { recursive: true });

  // References: copy each image and its sidecar into references/.
  const referenceEntries: CharacterBundleManifest['character']['references'] = [];
  for (const ref of version.references) {
    const row = (await services.db.db.select().from(assets).where(eq(assets.id, ref.asset_id)).limit(1))[0];
    if (!row) {
      notes.push(`Reference ${ref.asset_id} is no longer in the Library.`);
      continue;
    }
    const label = ref.view ?? ref.label ?? ref.role;
    const name = `${safeSegment(ref.role)}_${safeSegment(label)}_${ref.asset_id}.png`;
    const src = join(services.libraryRoot, row.path);
    await copyFile(src, join(stageDir, 'references', name));
    await copyFile(sidecarPath(src), sidecarPath(join(stageDir, 'references', name))).catch(() =>
      notes.push(`No sidecar for ${name}.`),
    );
    referenceEntries.push({
      file: `references/${name}`,
      asset_id: ref.asset_id,
      role: ref.role,
      ...(ref.view ? { view: ref.view } : {}),
      ...(ref.label ? { label: ref.label } : {}),
    });
  }

  // Identity (LoRA): only a *local* trained identity whose licence allows export
  // or that the user opted into; hosted Soul IDs (no localPath) are never
  // exported (TRD-14 §9/§15).
  let identity: CharacterBundleManifest['identity'];
  const identities = await services.db.db
    .select()
    .from(trainedIdentities)
    .where(and(eq(trainedIdentities.characterId, found.id), eq(trainedIdentities.version, version.version)));
  const local = identities.find((row) => row.localPath && row.sha256);
  if (local) {
    const allowed = EXPORTABLE_LICENCES.has(head.license) || options.include_lora === true;
    if (!allowed) {
      notes.push(
        `The trained LoRA was left out: licence "${head.license}" is not export-safe and "include my LoRA" was not ticked.`,
      );
    } else {
      await mkdir(join(stageDir, 'identities', safeSegment(local.providerId)), { recursive: true });
      const dest = join(stageDir, 'identities', safeSegment(local.providerId), 'lora.safetensors');
      await copyFile(local.localPath!, dest);
      const digest = await sha256(dest);
      if (digest !== local.sha256) {
        throw new KilnryError(
          'INVALID_INPUT',
          'The trained LoRA on disk does not match its recorded sha256.',
        );
      }
      await writeFile(
        join(stageDir, 'identities', safeSegment(local.providerId), 'manifest.json'),
        JSON.stringify(
          {
            provider: local.providerId,
            kind: local.kind,
            base_model: local.baseModel,
            trigger_word: local.triggerWord,
            default_scale: local.defaultScale,
            sha256: digest,
          },
          null,
          2,
        ),
      );
      identity = {
        provider: local.providerId,
        kind: local.kind,
        file: `identities/${safeSegment(local.providerId)}/lora.safetensors`,
        sha256: digest,
      };
    }
  }
  if (identities.some((row) => !row.localPath)) {
    notes.push('A hosted identity (Soul ID) was not exported; hosted ids are account-bound.');
  }

  const voicesList = version.voice ? [version.voice] : undefined;
  if (voicesList) await writeFile(join(stageDir, 'voices.json'), JSON.stringify(voicesList, null, 2));

  const releaseIncluded = options.include_release === true && head.consentEvidenceAssetId !== null;

  const manifest: CharacterBundleManifest = {
    schema_version: 1,
    exported_at: now().toISOString(),
    kilnry_version: services.kilnryVersion,
    character: {
      handle,
      kind: version.kind,
      display_name: version.display_name,
      is_real_person: version.is_real_person,
      appearance: version.appearance,
      ...(version.injection_defaults ? { injection_defaults: version.injection_defaults } : {}),
      references: referenceEntries,
    },
    versions_included: [version.version],
    consent: {
      is_real_person: version.is_real_person,
      consent_status: version.consent_status,
      release_included: releaseIncluded,
    },
    license: head.license,
    ...(identity ? { identity } : {}),
    ...(voicesList ? { voices: voicesList } : {}),
  };
  await writeFile(join(stageDir, 'character.json'), JSON.stringify(manifest, null, 2));

  const readme = [
    `# ${version.display_name} (@${handle})`,
    '',
    `Kilnry character bundle, version ${version.version}, exported ${manifest.exported_at}.`,
    '',
    `**Descriptor** ${version.appearance.descriptor || '—'}`,
    `**Anchors** ${version.appearance.anchors.join(', ') || '—'}`,
    '',
    '## Import',
    'Open Kilnry → Characters → Import, and choose this .zip. If a character with',
    'this handle already exists, Kilnry offers to import as a new version or under',
    `@${handle}_2. References land under Characters/@${handle}/imported/.`,
    '',
  ].join('\n');
  await writeFile(join(stageDir, 'README.md'), readme);

  const zipped = await services.zipDir(stageDir);
  if (!zipped) {
    notes.push('No archiver is available; the bundle was written as a folder.');
    return { bundle_path: stageDir, manifest, notes };
  }
  return { bundle_path: zipped, manifest, notes };
}

export interface CharacterImportOptions {
  bundle_path: string;
  // When the handle already exists: 'version' adds a new version; 'rename'
  // imports under @<handle>_2 (TRD-14 §15).
  on_conflict?: 'version' | 'rename';
  confirm_real_person?: boolean;
}

export interface CharacterImportResult {
  handle: string;
  character_id: string;
  version: number;
  references_imported: number;
  consent_status: string;
  notes: string[];
}

export async function importCharacterBundle(
  services: CharacterBundleServices,
  options: CharacterImportOptions,
): Promise<CharacterImportResult> {
  const notes: string[] = [];
  const extractDir = join(services.bundlesRoot, `import-${Date.now()}`);
  await mkdir(extractDir, { recursive: true });
  await services.unzipTo(options.bundle_path, extractDir);

  const manifestRaw = await readFile(join(extractDir, 'character.json'), 'utf8').catch(() => '');
  if (manifestRaw.trim() === '') {
    throw new KilnryError('INVALID_INPUT', 'The bundle has no character.json.');
  }
  const manifest = JSON.parse(manifestRaw) as CharacterBundleManifest;
  if (manifest.schema_version !== 1) {
    throw new KilnryError('INVALID_INPUT', `Unsupported bundle schema_version ${manifest.schema_version}.`);
  }

  // Resolve the target handle: a clash becomes a new version or @<handle>_2.
  const requested = normaliseHandle(manifest.character.handle);
  let handle = requested;
  const existing = await lookupHandle(services.db, requested);
  if (existing && options.on_conflict !== 'version') {
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${requested}_${suffix}`.slice(0, 32);
      if (!(await lookupHandle(services.db, candidate))) {
        handle = candidate;
        break;
      }
    }
    notes.push(`@${requested} already exists; imported as @${handle}.`);
  }

  // Verify any LoRA's sha256 before trusting the bundle.
  if (manifest.identity) {
    const loraPath = join(extractDir, manifest.identity.file);
    const digest = await sha256(loraPath).catch(() => '');
    if (digest !== manifest.identity.sha256) {
      throw new KilnryError('INVALID_INPUT', "The bundle's LoRA does not match its recorded sha256.");
    }
  }

  // Real-person consent is reset to none unless the bundle carries a release and
  // the importer confirms (TRD-14 §9/§15).
  const consentStatus =
    manifest.character.is_real_person && !(manifest.consent.release_included && options.confirm_real_person)
      ? 'none'
      : manifest.consent.consent_status;
  if (manifest.character.is_real_person && consentStatus === 'none') {
    notes.push(
      'This is a real person; consent was reset to none. Re-confirm consent before training or use.',
    );
  }

  // Create the character (or reuse the existing one for a new version), then
  // copy each reference into Characters/@<handle>/imported/, index it as a
  // Library asset, and bind it to the version.
  let characterId: string;
  if (existing && options.on_conflict === 'version') {
    characterId = existing.id;
  } else {
    const created = await createCharacter(services.db, {
      handle,
      kind: manifest.character.kind,
      display_name: manifest.character.display_name,
      is_real_person: manifest.character.is_real_person,
      appearance: manifest.character.appearance,
      ...(manifest.character.injection_defaults
        ? { injection_defaults: manifest.character.injection_defaults }
        : {}),
    });
    characterId = created.id;
  }

  const importRel = join('Characters', `@${handle}`, 'imported');
  const importAbs = join(services.libraryRoot, importRel);
  await mkdir(importAbs, { recursive: true });
  const refInputs: Array<{ asset_id: string; role: string; view?: string; label?: string }> = [];
  for (const ref of manifest.character.references) {
    const srcImage = join(extractDir, ref.file);
    const name = basename(ref.file);
    const destAbs = join(importAbs, name);
    await copyFile(srcImage, destAbs);
    // Carry the sidecar if the bundle has one; otherwise indexAsset builds a
    // minimal one. A fresh asset id is minted on import (the source id is only a
    // provenance hint in the manifest).
    await copyFile(sidecarPath(srcImage), sidecarPath(destAbs)).catch(() => undefined);
    const indexed = await services.indexAsset(join(importRel, name));
    refInputs.push({
      asset_id: indexed,
      role: ref.role,
      ...(ref.view ? { view: ref.view } : {}),
      ...(ref.label ? { label: ref.label } : {}),
    });
  }
  if (refInputs.length > 0) await addReferences(services.db, characterId, refInputs);
  if (consentStatus !== manifest.consent.consent_status) {
    await services.db.db.update(characters).set({ consentStatus }).where(eq(characters.id, characterId));
  }
  const finalVersion = await loadVersion(services.db, characterId);

  return {
    handle,
    character_id: characterId,
    version: finalVersion.version,
    references_imported: refInputs.length,
    consent_status: consentStatus,
    notes,
  };
}
