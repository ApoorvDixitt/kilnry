// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers for Create variants, batch and edit mode (F-CRE-09,
// F-CRE-10), unit-tested without a browser.

export const BATCH_MAX = 12;

export interface BatchLine {
  index: number;
  prompt: string;
  overrides: Record<string, string | number | boolean>;
}

export interface BatchParse {
  lines: BatchLine[];
  error?: string;
}

// Parse the batch list editor: one prompt per line, up to twelve, each line
// optionally ending with a JSON override block like {aspect: "1:1", count: 2}.
// Blank lines are ignored; more than twelve prompts is rejected with exact copy.
export function parseBatch(text: string): BatchParse {
  const raw = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (raw.length > BATCH_MAX) {
    return { lines: [], error: 'Batch is limited to 12 prompts.' };
  }
  const lines: BatchLine[] = [];
  raw.forEach((line, index) => {
    const match = /^(.*?)(\{[^}]*\})\s*$/.exec(line);
    let prompt = line;
    let overrides: Record<string, string | number | boolean> = {};
    if (match) {
      prompt = match[1]!.trim();
      overrides = parseOverrides(match[2]!);
    }
    lines.push({ index, prompt, overrides });
  });
  return { lines };
}

// Parse a loose {key: value} override block into a flat record. Tolerates single
// quotes and unquoted keys, as a person types them.
function parseOverrides(block: string): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  const inner = block.slice(1, -1);
  for (const pair of inner.split(',')) {
    const [key, ...rest] = pair.split(':');
    if (!key || rest.length === 0) continue;
    const name = key.trim().replace(/['"]/g, '');
    const rawValue = rest.join(':').trim().replace(/['"]/g, '');
    if (!name) continue;
    if (rawValue === 'true' || rawValue === 'false') result[name] = rawValue === 'true';
    else if (/^\d+(\.\d+)?$/.test(rawValue)) result[name] = Number(rawValue);
    else result[name] = rawValue;
  }
  return result;
}

// Build the requests[] payload for a batch generate call, preserving line order
// as the caller index (F-CRE-09 AC 2).
export function batchRequests(
  parse: BatchParse,
  base: { kind: string; model: string },
): Array<{ index: number; kind: string; prompt: string; model: string; params: Record<string, unknown> }> {
  return parse.lines.map((line) => ({
    index: line.index,
    kind: base.kind,
    prompt: line.prompt,
    model: base.model,
    params: { ...line.overrides },
  }));
}

// The edit kind for a source asset: image edits route to image_edit, video edits
// to video_edit; never text2image (F-CRE-10 AC 2).
export function editKindFor(sourceKind: 'image' | 'video'): 'image_edit' | 'video_edit' {
  return sourceKind === 'video' ? 'video_edit' : 'image_edit';
}
