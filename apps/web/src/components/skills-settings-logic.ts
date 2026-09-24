// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Pure helpers for Settings › Skills (F-SKL-04, F-SET-06). The component reads
// the skill list from the API and renders each row; these helpers turn a raw
// entry into the labels the row shows and read a dropped folder into the file
// set the install route accepts, so the view stays thin and the shaping is
// unit-tested.

export interface SkillRow {
  name: string;
  description: string;
  license: string;
  source: 'bundled' | 'installed';
  enabled: boolean;
  tags: string[];
  error?: string;
}

/** The copy shown for a skill's source: shipped with Kilnry or community. */
export function sourceLabelKey(source: SkillRow['source']): string {
  return source === 'bundled' ? 'settings.skills.sourceShipped' : 'settings.skills.sourceInstalled';
}

/** The licence line, or the "no licence declared" copy when none is set. */
export function licenseLabel(license: string): string {
  return license === 'unknown' || license === '' ? '' : license;
}

/** A shipped skill is read-only: it cannot be uninstalled or edited. */
export function isReadOnly(source: SkillRow['source']): boolean {
  return source === 'bundled';
}

/** The npx command a user can copy to install a skill into Kilnry (D-28). */
export function npxInstallCommand(repo: string): string {
  const trimmed = repo.trim();
  const target = trimmed === '' ? '<owner/repo>' : trimmed;
  return `npx skills add ${target} --dir ~/.kilnry/skills`;
}

/** Turn a dropped file list into the {path, content} array the install route reads. */
export async function filesFromDrop(
  entries: Array<{ path: string; text: () => Promise<string> }>,
): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = [];
  for (const entry of entries) {
    // Keep only the path inside the dropped skill folder (strip a leading folder
    // name so SKILL.md lands at the skill root).
    const parts = entry.path.split('/').filter(Boolean);
    const relative = parts.length > 1 ? parts.slice(1).join('/') : parts.join('/');
    out.push({ path: relative, content: await entry.text() });
  }
  return out;
}
