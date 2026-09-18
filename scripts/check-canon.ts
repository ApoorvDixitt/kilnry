// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { spawnSync } from 'node:child_process';

const allowedTools = new Set([
  'kilnry_models',
  'kilnry_estimate',
  'kilnry_providers',
  'kilnry_budget',
  'kilnry_generate',
  'kilnry_transform',
  'kilnry_ffmpeg',
  'kilnry_analyze',
  'kilnry_library',
  'kilnry_library_manage',
  'kilnry_import',
  'kilnry_characters',
  'kilnry_characters_manage',
  'kilnry_voices',
  'kilnry_presets',
  'kilnry_workflows',
  'kilnry_skills',
  'kilnry_jobs',
  'kilnry_publish',
  'kilnry_ui',
]);
const nonToolIdentifiers = new Set([
  'kilnry_setup',
  'kilnry_csrf',
  'kilnry_master_key',
  'kilnry_version',
  'kilnry_bundle',
  'kilnry_handle',
  'kilnry_transcript',
  'kilnry_session',
  'kilnry_token',
]);
const accentAllowlist = new Set([
  'generate-button.tsx',
  'run-button.tsx',
  'approve-button.tsx',
  'cost-strip.tsx',
  'budget-meter.tsx',
  'status-dot.tsx',
  'nav-item.tsx',
]);

function trackedFiles(): string[] {
  const result = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Unable to list tracked files: ${result.stderr.trim()}`);
  return result.stdout.split('\n').filter(Boolean);
}

function isText(path: string): boolean {
  return [
    '.ts',
    '.tsx',
    '.js',
    '.mjs',
    '.cjs',
    '.json',
    '.md',
    '.mdx',
    '.yml',
    '.yaml',
    '.css',
    '.html',
  ].includes(extname(path));
}

const failures: string[] = [];
for (const path of trackedFiles().filter(isText)) {
  const content = readFileSync(path, 'utf8');
  if (/\bKiln\b/.test(content)) failures.push(`${path}: prohibited former short name`);

  for (const match of content.matchAll(/\bkilnry_[a-z][a-z_]*[a-z]\b/g)) {
    const name = match[0];
    if (!allowedTools.has(name) && !nonToolIdentifiers.has(name))
      failures.push(`${path}: unknown tool-like name ${name}`);
  }

  if (
    /\.(?:submit|createPrediction|runModel)\s*\(/.test(content) &&
    !/(confirmed_cost_usd|assertSpendAllowed|reserveBudget)/.test(content)
  ) {
    failures.push(`${path}: provider submit path lacks an explicit cost confirmation or budget gate`);
  }

  if (/(?:bg-accent|text-accent-text)/.test(content) && path.endsWith('.tsx')) {
    const file = path.split('/').at(-1) ?? path;
    if (!accentAllowlist.has(file)) failures.push(`${path}: accent utility outside the component allowlist`);
  }

  if (path.startsWith('docs/') && path.endsWith('.md')) {
    for (const match of content.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)(?:#[^)]*)?\)/g)) {
      const target = match[1];
      if (!target) continue;
      const resolved = normalize(join(dirname(path), decodeURIComponent(target)));
      if (!existsSync(resolved)) failures.push(`${path}: broken relative link ${target}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`Canon check failed:\n${failures.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`Canon verified: ${allowedTools.size} MCP tool names are locked.\n`);
