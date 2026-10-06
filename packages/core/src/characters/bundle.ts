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
import { copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { and, eq } from 'drizzle-orm';
import * as z from 'zod';
import { assets, characters, trainedIdentities, type DatabaseState } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';
import {
  addReferences,
  createCharacter,
  forkVersion,
  loadVersion,
  lookupHandle,
  normaliseHandle,
  setAppearance,
} from './store.js';
import { assertConsentForExport } from './consent.js';
import { resolveInRoot } from '../library/containment.js';
import { SidecarSchema, sidecarPath, writeSidecar } from '../library/sidecar.js';

// Licences under which a trained LoRA leaves the machine without an explicit
// opt-in (TRD-14 §9). Everything else needs the user to tick "include my LoRA".
const EXPORTABLE_LICENCES = new Set(['cc0', 'cc-by', 'commercial-release']);

// A bundled reference is references/<name>.png; an identity is
// identities/<provider>/lora.safetensors. Both are matched before any path is
// joined onto the extract dir, so a crafted manifest cannot escape it (item 5).
const REFERENCE_FILE_RE = /^references\/[^/]+\.png$/;
const IDENTITY_FILE_RE = /^identities\/[^/]+\/lora\.safetensors$/;

const ReferenceEntrySchema = z.object({
  file: z.string().regex(REFERENCE_FILE_RE),
  asset_id: z.string(),
  role: z.string(),
  view: z.string().optional(),
  label: z.string().optional(),
});

export const CharacterBundleManifestSchema = z.object({
  schema_version: z.literal(1),
  exported_at: z.string(),
  kilnry_version: z.string(),
  character: z.object({
    handle: z.string(),
    kind: z.enum(['character', 'prop', 'environment', 'style']),
    display_name: z.string(),
    is_real_person: z.boolean(),
    appearance: z.object({
      descriptor: z.string(),
      anchors: z.array(z.string()),
      negative_traits: z.array(z.string()),
      palette_hex: z.array(z.string()).optional(),
      gendered_noun: z.enum(['figure', 'man', 'person', 'woman']).optional(),
    }),
    injection_defaults: z.record(z.string(), z.array(z.string())).optional(),
    references: z.array(ReferenceEntrySchema),
  }),
  versions_included: z.array(z.number().int()),
  consent: z.object({
    is_real_person: z.boolean(),
    consent_status: z.string(),
    release_included: z.boolean(),
  }),
  license: z.string(),
  identity: z
    .object({
      provider: z.string(),
      kind: z.string(),
      file: z.string().regex(IDENTITY_FILE_RE),
      sha256: z.string(),
    })
    .optional(),
  voices: z.array(z.object({ provider: z.string(), voice_id: z.string() })).optional(),
});

export type CharacterBundleManifest = z.infer<typeof CharacterBundleManifestSchema>;

export interface CharacterBundleServices {
  db: DatabaseState;
  libraryRoot: string;
  // Staging and extraction happen here (the data dir, NOT under the watched
  // Library root), so the watcher never sees a half-staged reference or a
  // non-media bundle file (item 2).
  bundlesRoot: string;
  // The finished .zip is written here, under the Library's Exports folder, the
  // way a Library export is (library-export.ts).
  exportsRoot: string;
  kilnryVersion: string;
  now?: () => Date;
  // Zip a staged directory into <dir>.zip, or undefined when no archiver exists.
  zipDir: (dir: string) => Promise<string | undefined>;
  // Unzip a bundle into a fresh directory.
  unzipTo: (zipPath: string, destDir: string) => Promise<void>;
  // Index a Library-relative path and return its asset id.
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

// A bundle may not carry a symbolic link anywhere (PRD-07 §14: import never
// reads outside the extracted bundle; F-06). unzip restores a link stored with
// `zip -y` verbatim, and copyFile follows it, so a manifest path that is in
// bounds could still copy any host file the server can read into the Library.
// The whole extracted tree is walked with lstat before anything is read.
async function assertNoSymlinks(extractDir: string, dir = extractDir): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new KilnryError(
        'INVALID_INPUT',
        `A Character bundle cannot contain a symbolic link: ${relative(extractDir, abs)}.`,
      );
    }
    if (entry.isDirectory()) await assertNoSymlinks(extractDir, abs);
  }
}

// Each entry the manifest names (references, their sidecars, the identity) is
// checked again with lstat right before it is read, so a link can never be
// followed even if the tree changed after the walk.
async function assertRegularFile(extractDir: string, rel: string): Promise<void> {
  const stats = await lstat(join(extractDir, rel)).catch(() => undefined);
  if (stats?.isSymbolicLink()) {
    throw new KilnryError('INVALID_INPUT', `A Character bundle cannot contain a symbolic link: ${rel}.`);
  }
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

  // A real person at consent none cannot be exported (PRD-07 §7/§14). Checked
  // before any staging so nothing is written for a refused export.
  await assertConsentForExport(services.db, found.id);

  const stageName = `character-${safeSegment(handle)}-v${version.version}.kilnry-character`;
  const stageDir = join(services.bundlesRoot, `${ulid()}-${stageName}`);
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
  // Move the finished zip into the Library's Exports folder, then remove the
  // staging directory from the data dir so the watcher never sees it (item 2).
  await mkdir(services.exportsRoot, { recursive: true });
  const finalZip = join(services.exportsRoot, `${stageName}.zip`);
  await rm(finalZip, { force: true });
  await copyFile(zipped, finalZip);
  await rm(zipped, { force: true });
  await rm(stageDir, { recursive: true, force: true });
  return { bundle_path: finalZip, manifest, notes };
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
  // The client may name any path; refuse one that does not resolve inside the
  // Library root or the data dir, then extract into the data dir (item 5/2).
  let bundleAbs: string | undefined;
  for (const base of [services.libraryRoot, services.bundlesRoot]) {
    const resolved = await resolveInRoot(base, options.bundle_path, { mustExist: true }).catch(
      () => undefined,
    );
    if (resolved) {
      bundleAbs = resolved.abs;
      break;
    }
  }
  if (!bundleAbs) {
    throw new KilnryError('INVALID_INPUT', 'The bundle path is outside the Library and data folders.');
  }
  const extractDir = join(services.bundlesRoot, `import-${ulid()}`);
  await mkdir(extractDir, { recursive: true });
  try {
    await services.unzipTo(bundleAbs, extractDir);
    await assertNoSymlinks(extractDir);

    const manifestRaw = await readFile(join(extractDir, 'character.json'), 'utf8').catch(() => '');
    if (manifestRaw.trim() === '') {
      throw new KilnryError('INVALID_INPUT', 'The bundle has no character.json.');
    }
    const parsed = CharacterBundleManifestSchema.safeParse(JSON.parse(manifestRaw) as unknown);
    if (!parsed.success) {
      throw new KilnryError(
        'INVALID_INPUT',
        `The bundle's character.json is invalid: ${parsed.error.message}`,
      );
    }
    const manifest = parsed.data;

    // Validate every bundled sidecar before trusting the bundle; name all the
    // offending files in one error (PRD-07 §14 acceptance 3).
    const bad: string[] = [];
    const sidecars = new Map<string, z.infer<typeof SidecarSchema>>();
    for (const ref of manifest.character.references) {
      await assertRegularFile(extractDir, ref.file);
      await assertRegularFile(extractDir, `${ref.file}.kilnry.json`);
      const sidecarAbs = sidecarPath(join(extractDir, ref.file));
      const raw = await readFile(sidecarAbs, 'utf8').catch(() => '');
      if (raw.trim() === '') continue; // no sidecar is allowed; a bad one is not
      const check = SidecarSchema.safeParse(JSON.parse(raw) as unknown);
      if (!check.success) bad.push(`${ref.file}.kilnry.json`);
      else sidecars.set(ref.file, check.data);
    }
    if (bad.length > 0) {
      throw new KilnryError('INVALID_INPUT', `These bundled sidecars are invalid: ${bad.join(', ')}.`);
    }

    // Verify any LoRA's sha256 before trusting the bundle.
    if (manifest.identity) {
      await assertRegularFile(extractDir, manifest.identity.file);
      const digest = await sha256(join(extractDir, manifest.identity.file)).catch(() => '');
      if (digest !== manifest.identity.sha256) {
        throw new KilnryError('INVALID_INPUT', "The bundle's LoRA does not match its recorded sha256.");
      }
    }

    // Resolve the target handle: a clash becomes a new version or @<handle>_2.
    const requested = normaliseHandle(manifest.character.handle);
    let handle = requested;
    const existing = await lookupHandle(services.db, requested);
    const asNewVersion = existing !== null && options.on_conflict === 'version';
    if (existing && !asNewVersion) {
      for (let suffix = 2; ; suffix += 1) {
        const candidate = `${requested}_${suffix}`.slice(0, 32);
        if (!(await lookupHandle(services.db, candidate))) {
          handle = candidate;
          break;
        }
      }
      notes.push(`@${requested} already exists; imported as @${handle}.`);
    }

    // Real-person consent is reset to none unless the bundle carries a release
    // and the importer confirms (TRD-14 §9/§15).
    const consentStatus =
      manifest.character.is_real_person && !(manifest.consent.release_included && options.confirm_real_person)
        ? 'none'
        : manifest.consent.consent_status;
    if (manifest.character.is_real_person && consentStatus === 'none') {
      notes.push(
        'This is a real person; consent was reset to none. Re-confirm consent before training or use.',
      );
    }

    // Create the character, or fork a new version of the existing one and write
    // the manifest's appearance onto it (item 4: "import as new version").
    const appearance: {
      descriptor: string;
      anchors: string[];
      negative_traits: string[];
      palette_hex?: string[];
      gendered_noun?: 'figure' | 'man' | 'person' | 'woman';
    } = {
      descriptor: manifest.character.appearance.descriptor,
      anchors: manifest.character.appearance.anchors,
      negative_traits: manifest.character.appearance.negative_traits,
      ...(manifest.character.appearance.palette_hex
        ? { palette_hex: manifest.character.appearance.palette_hex }
        : {}),
      ...(manifest.character.appearance.gendered_noun
        ? { gendered_noun: manifest.character.appearance.gendered_noun }
        : {}),
    };
    let characterId: string;
    if (asNewVersion && existing) {
      characterId = existing.id;
      await forkVersion(services.db, characterId);
      await setAppearance(services.db, characterId, appearance);
    } else {
      const created = await createCharacter(services.db, {
        handle,
        kind: manifest.character.kind,
        display_name: manifest.character.display_name,
        is_real_person: manifest.character.is_real_person,
        appearance,
        ...(manifest.character.injection_defaults
          ? { injection_defaults: manifest.character.injection_defaults }
          : {}),
      });
      characterId = created.id;
    }

    // Copy each reference under Characters/@<handle>/imported/ with a FRESH
    // asset_id in its sidecar (item 1): keeping the exporter's id made the
    // upsert re-point the exporter's own asset to the imported path. The
    // exporter's id is kept as provenance in lineage.made_from.
    const importRel = join('Characters', `@${handle}`, 'imported');
    const importAbs = join(services.libraryRoot, importRel);
    await mkdir(importAbs, { recursive: true });
    const refInputs: Array<{ asset_id: string; role: string; view?: string; label?: string }> = [];
    for (const ref of manifest.character.references) {
      const name = basename(ref.file);
      const destAbs = join(importAbs, name);
      await copyFile(join(extractDir, ref.file), destAbs);
      const bundled = sidecars.get(ref.file);
      if (bundled) {
        const made = bundled.lineage.made_from.includes(ref.asset_id)
          ? bundled.lineage.made_from
          : [...bundled.lineage.made_from, ref.asset_id];
        await writeSidecar(
          destAbs,
          SidecarSchema.parse({
            ...bundled,
            asset_id: ulid(),
            library_id: bundled.library_id,
            source: 'import',
            file: { ...bundled.file, name },
            lineage: { ...bundled.lineage, made_from: made },
          }),
        );
      }
      const assetId = await services.indexAsset(join(importRel, name));
      refInputs.push({
        asset_id: assetId,
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
  } finally {
    await rm(extractDir, { recursive: true, force: true });
  }
}
