// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Export diagnostics bundle (F-SET-11, PRD-16 §11). It gathers the files a
// maintainer needs — the doctor report, the redacted config, the last two log
// files, and the registry snapshot ages — and scrubs every one so the zip holds
// no provider key and no generation prompt (the acceptance criterion). The web
// route zips the returned map and writes it to the logs folder; keeping the map
// here lets a unit test scan the exact bytes that will ship.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { redact, redactString } from '../security/redact.js';

export interface DiagnosticsInput {
  dataDir: string;
  doctor: unknown;
  config: unknown;
  // name → fetched_at ISO string for each price snapshot (ages, not prices).
  snapshotAges: Array<{ model: string; fetched_at: string }>;
  now?: Date;
}

// Strip prompt values from a log line. Logs are JSON lines; a generation prompt
// surfaces as a "prompt" field (TRD-04 generation.prompt). We blank the value
// of any prompt-shaped key, then run the shared secret redactor over what's left.
function scrubLogLine(line: string): string {
  const noPrompts = line.replace(
    /("(?:prompt|negative_prompt|system|input_text)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
    '$1"[redacted-prompt]"',
  );
  return redactString(noPrompts);
}

function lastTwoLogFiles(dataDir: string): Array<{ name: string; content: string }> {
  const logsDir = join(dataDir, 'logs');
  if (!existsSync(logsDir)) return [];
  const files = readdirSync(logsDir)
    .filter((name) => name.endsWith('.log'))
    .map((name) => ({ name, mtime: statSync(join(logsDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 2);
  return files.map(({ name }) => ({
    name,
    content: readFileSync(join(logsDir, name), 'utf8').split('\n').map(scrubLogLine).join('\n'),
  }));
}

// Build the diagnostics file set. Returns filename → UTF-8 contents, all scrubbed.
export function buildDiagnosticsFiles(input: DiagnosticsInput): Record<string, string> {
  const date = (input.now ?? new Date()).toISOString().slice(0, 10);
  const files: Record<string, string> = {
    'doctor.json': `${JSON.stringify(redact(input.doctor), null, 2)}\n`,
    'config.json': `${JSON.stringify(redact(input.config), null, 2)}\n`,
    'registry-snapshot-ages.json': `${JSON.stringify(input.snapshotAges, null, 2)}\n`,
    'README.txt':
      `Kilnry diagnostics ${date}\n\n` +
      'This bundle contains no keys and no prompts. It lists file paths and model names.\n' +
      'Files: doctor.json, config.json, registry-snapshot-ages.json, and the last two log files with prompts removed.\n',
  };
  for (const log of lastTwoLogFiles(input.dataDir)) {
    files[`logs/${log.name}`] = log.content;
  }
  return files;
}

export function diagnosticsZipName(now = new Date()): string {
  return `diagnostics-${now.toISOString().slice(0, 10)}.zip`;
}
