// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const notice = [
  'Kilnry — https://github.com/ApoorvDixitt/kilnry',
  'Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.',
  'SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0',
  'See LICENSE.md in the repository root. You may not remove or obscure this notice.',
] as const;

const markdownFooter = '<!-- Kilnry © 2026 Apoorv Dixit · Sustainable Use License 1.0 · See LICENSE.md. -->';
const fix = process.argv.includes('--fix');

function gitFiles(): string[] {
  const result = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Unable to list tracked files: ${result.stderr.trim()}`);
  }
  return result.stdout.split('\n').filter(Boolean);
}

function isExempt(path: string): boolean {
  return (
    path === 'LICENSE.md' ||
    path.startsWith('LICENSES/') ||
    path === 'pnpm-lock.yaml' ||
    path === '.github/CODEOWNERS' ||
    path.endsWith('.json') ||
    path.includes('/fixtures/') ||
    path.includes('/__snapshots__/') ||
    path.includes('/drizzle/meta/') ||
    path.startsWith('.next/') ||
    /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp3|wav|mp4|mov|pdf|zip|gz)$/.test(path)
  );
}

function markdownNeedsSourceHeader(path: string): boolean {
  return path.startsWith('apps/docs/content/') || path.startsWith('packages/skills/');
}

function styleFor(path: string): 'slash' | 'hash' | 'css' | 'html' | 'sql' | 'footer' | undefined {
  const extension = extname(path);
  const name = basename(path);
  if (['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts'].includes(extension)) return 'slash';
  if (['.sh', '.py', '.yml', '.yaml', '.toml'].includes(extension)) return 'hash';
  if (['.gitignore', '.editorconfig', '.npmrc', '.env.example'].includes(name) || name === 'Dockerfile')
    return 'hash';
  if (['.css', '.scss'].includes(extension)) return 'css';
  if (extension === '.sql') return 'sql';
  if (['.html', '.mdx'].includes(extension)) return 'html';
  if (extension === '.md') return markdownNeedsSourceHeader(path) ? 'html' : 'footer';
  return undefined;
}

function renderedHeader(style: Exclude<ReturnType<typeof styleFor>, 'footer' | undefined>): string {
  if (style === 'slash') return notice.map((line) => `// ${line}`).join('\n');
  if (style === 'hash') return notice.map((line) => `# ${line}`).join('\n');
  if (style === 'sql') return notice.map((line) => `-- ${line}`).join('\n');
  return `/*\n${notice.map((line) => ` * ${line}`).join('\n')}\n */`;
}

function hasNotice(content: string): boolean {
  return notice.every((line) => content.includes(line));
}

function insertHeader(content: string, header: string): string {
  const lines = content.split('\n');
  let position = 0;
  if (lines[0]?.startsWith('#!')) position = 1;
  if (/^["']use client["'];?$/.test(lines[position]?.trim() ?? '')) position += 1;
  lines.splice(position, 0, header, '');
  return lines.join('\n');
}

const failures: string[] = [];
for (const path of gitFiles()) {
  if (isExempt(path)) continue;
  const style = styleFor(path);
  if (!style) continue;
  const content = readFileSync(path, 'utf8');
  if (style === 'footer') {
    if (!content.includes(markdownFooter)) failures.push(`${path}: missing licence footer`);
    continue;
  }
  if (hasNotice(content)) continue;
  if (!fix) {
    failures.push(`${path}: missing four-line licence header`);
    continue;
  }
  writeFileSync(path, insertHeader(content, renderedHeader(style)), 'utf8');
}

for (const path of gitFiles().filter((file) => basename(file) === 'package.json')) {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { license?: string; author?: string };
  if (parsed.license !== 'SEE LICENSE IN LICENSE.md') failures.push(`${path}: invalid license field`);
  if (parsed.author !== 'Apoorv Dixit (https://github.com/ApoorvDixitt)')
    failures.push(`${path}: invalid author field`);
}

if (failures.length > 0) {
  process.stderr.write(`Licence header check failed:\n${failures.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Licence headers verified for ${gitFiles().length} tracked files.\n`);
