// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const cataloguePath = 'packages/ui/messages/en.json';
const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8')) as Record<string, unknown>;

function flatten(value: Record<string, unknown>, prefix = ''): Set<string> {
  const keys = new Set<string>();
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') keys.add(path);
    else if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
      for (const nested of flatten(child as Record<string, unknown>, path)) keys.add(nested);
    }
  }
  return keys;
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (['.ts', '.tsx'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

const available = flatten(catalogue);
const referenced = new Set<string>();
for (const file of sourceFiles('apps/web/src')) {
  const content = readFileSync(file, 'utf8');
  for (const match of content.matchAll(/\bmessage\(['"]([^'"]+)['"]\)/g)) {
    const key = match[1];
    if (key) referenced.add(key);
  }
}

const missing = [...referenced].filter((key) => !available.has(key)).sort();
if (missing.length > 0) {
  process.stderr.write(
    `Message catalogue check failed; missing keys:\n${missing.map((key) => `- ${key}`).join('\n')}\n`,
  );
  process.exit(1);
}

const unused = [...available].filter((key) => !referenced.has(key)).sort();

// No user-visible string may promise a capability "in a later milestone/release"
// or "in M<n>": such copy reads as stale the moment the capability ships. The
// guard fails the check so the string is reworded when its feature lands.
const staleGuard = /later (release|milestone)|arrives in M\d/;
const stale: string[] = [];
function collectStale(value: Record<string, unknown>, prefix = ''): void {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') {
      if (staleGuard.test(child)) stale.push(`${path}: ${child}`);
    } else if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
      collectStale(child as Record<string, unknown>, path);
    }
  }
}
collectStale(catalogue);
if (stale.length > 0) {
  process.stderr.write(
    `Message catalogue check failed; reword these strings so they do not promise a capability "in a later milestone/release" or "in M<n>":\n${stale
      .map((entry) => `- ${entry}`)
      .join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `Message catalogue verified: ${referenced.size} referenced, ${unused.length} reserved for later screens.\n`,
);
