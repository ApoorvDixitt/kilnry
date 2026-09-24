// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The skills host helper (F-SKL-03/04, F-SET-06). It knows the two skill roots —
// the catalogue bundled with the app and the installed folder under the data
// directory — and the persisted enable state in the skills table, and answers
// what the routes need: the shipped names (which a community skill may never
// take, TRD-13 §7 rule 7.7), the set of disabled names (so a disabled skill
// drops from kilnry_skills list and from Chat), the combined list with each
// skill's source and enable state, the enable/disable write, and the uninstall
// of an installed skill.

import { readdir, rm } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { installedSkillsRoot, listSkills, loadConfig, type SkillListEntry } from '@kilnry/core';
import { skills as skillsTable, type DatabaseState } from '@kilnry/db';
import { bundledSkillsRoot } from '@kilnry/skills';

/** The two skill roots plus the persisted disabled set, ready for the loader. */
export async function skillRoots(
  db?: DatabaseState,
): Promise<{ bundled: string; installed: string; disabled?: Set<string> }> {
  const config = await loadConfig();
  const base = { bundled: bundledSkillsRoot(), installed: installedSkillsRoot(config.data_dir) };
  if (!db) return base;
  return { ...base, disabled: await disabledSkillNames(db) };
}

/** The names shipped in the bundled catalogue; reserved from community install. */
export async function shippedSkillNames(): Promise<Set<string>> {
  const entries = await listSkills({ bundled: bundledSkillsRoot() });
  return new Set(entries.map((entry) => entry.name));
}

/** The names the owner has disabled in Settings (skills table, enabled = false). */
export async function disabledSkillNames(db: DatabaseState): Promise<Set<string>> {
  const rows = await db.db.select({ name: skillsTable.name, enabled: skillsTable.enabled }).from(skillsTable);
  return new Set(rows.filter((row) => row.enabled === false).map((row) => row.name));
}

/** Every skill across both roots, with source and enable state honoured. */
export async function listAllSkills(db?: DatabaseState): Promise<SkillListEntry[]> {
  return listSkills(await skillRoots(db));
}

/** Persist a skill's enable state; disabling hides it from the tool and Chat. */
export async function setSkillEnabled(db: DatabaseState, name: string, enabled: boolean): Promise<void> {
  const existing = await db.db
    .select({ name: skillsTable.name })
    .from(skillsTable)
    .where(eq(skillsTable.name, name))
    .limit(1);
  if (existing[0]) {
    await db.db.update(skillsTable).set({ enabled }).where(eq(skillsTable.name, name));
  } else {
    await db.db.insert(skillsTable).values({ name, enabled });
  }
}

/** Remove an installed skill's folder; a shipped skill cannot be uninstalled. */
export async function uninstallSkill(name: string): Promise<{ ok: boolean; reason?: string }> {
  const shipped = await shippedSkillNames();
  if (shipped.has(name)) return { ok: false, reason: 'A shipped skill cannot be uninstalled.' };
  const config = await loadConfig();
  const root = installedSkillsRoot(config.data_dir);
  const present = await readdir(root).catch(() => [] as string[]);
  if (!present.includes(name)) return { ok: false, reason: 'That skill is not installed.' };
  const { join } = await import('node:path');
  await rm(join(root, name), { recursive: true, force: true });
  return { ok: true };
}
