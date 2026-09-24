// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The skills host helper (F-SKL-03/04). It knows the two skill roots — the
// catalogue bundled with the app and the installed folder under the data
// directory — and answers the two questions the routes need: the set of shipped
// names (which a community skill may never take, TRD-13 §7 rule 7.7), and the
// combined list of skills with the source each came from, so Settings can show
// shipped and installed skills together with their enable state.

import { listSkills, loadConfig, installedSkillsRoot, type SkillListEntry } from '@kilnry/core';
import { bundledSkillsRoot } from '@kilnry/skills';

/** Both skill roots: the bundled catalogue and the installed folder. */
export async function skillRoots(): Promise<{ bundled: string; installed: string }> {
  const config = await loadConfig();
  return { bundled: bundledSkillsRoot(), installed: installedSkillsRoot(config.data_dir) };
}

/** The names shipped in the bundled catalogue; reserved from community install. */
export async function shippedSkillNames(): Promise<Set<string>> {
  const entries = await listSkills({ bundled: bundledSkillsRoot() });
  return new Set(entries.map((entry) => entry.name));
}

/** Every skill across both roots; an installed skill shadows a bundled one. */
export async function listAllSkills(): Promise<SkillListEntry[]> {
  const roots = await skillRoots();
  return listSkills(roots);
}
