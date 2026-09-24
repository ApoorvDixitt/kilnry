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

// Honest "not yet" copy is allowed, but only for a capability that genuinely
// has not shipped and only until its milestone lands. Each string that names a
// future capability is listed here against the milestone the feature map
// assigns it: laterReasoning is visible thinking (F-CHT-08, M6); laterMemory is
// project memory (F-CHT-09, M6). The check reads the highest completed milestone from docs/STATUS.md and fails
// when a listed key's milestone has already landed (the promise is stale), or
// when any string still reads as a future promise but is not on this list (so a
// new stale promise cannot slip in unnoticed). Update this map, not the regex,
// when copy legitimately points at a later milestone.
const notYet: Record<string, number> = {
  'settings.chat.laterReasoning': 6,
  'settings.chat.laterMemory': 6,
};

// A string reads as a future promise if it defers a capability to a later
// milestone or release, or names a specific M<n>.
const promiseGuard =
  /later (release|milestone)|(arrives?|arrive|lands?|comes?)\b.*\bin M\d|in M\d\b|arrives with/i;

function highestCompleteMilestone(): number {
  const status = readFileSync('docs/STATUS.md', 'utf8');
  let highest = 0;
  for (const match of status.matchAll(/^##\s+M(\d+)\b/gm)) {
    const n = Number(match[1]);
    if (n > highest) highest = n;
  }
  return highest;
}

const complete = highestCompleteMilestone();
const promises: string[] = [];
function collectPromises(value: Record<string, unknown>, prefix = ''): void {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') {
      const listed = path in notYet;
      if (listed) {
        // A listed promise must still be ahead of the shipped milestone.
        if (notYet[path]! <= complete) {
          promises.push(
            `${path}: promises M${notYet[path]} but M${complete} has shipped — the capability should be here; reword or remove: ${child}`,
          );
        }
      } else if (referenced.has(path) && promiseGuard.test(child)) {
        // A string the interface actually renders may not read as a future
        // promise unless it is listed above against its milestone.
        promises.push(
          `${path}: reads as a future promise but is not listed in notYet; add it with its milestone or reword: ${child}`,
        );
      }
    } else if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
      collectPromises(child as Record<string, unknown>, path);
    }
  }
}
collectPromises(catalogue);
if (promises.length > 0) {
  process.stderr.write(
    `Message catalogue check failed; each user-visible "not yet" string must name a capability that has not shipped and be listed against its milestone:\n${promises
      .map((entry) => `- ${entry}`)
      .join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `Message catalogue verified: ${referenced.size} referenced, ${unused.length} reserved for later screens.\n`,
);
