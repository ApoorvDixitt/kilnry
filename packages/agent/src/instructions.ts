// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Chat `instructions` assembly (F-CHT-07) and skills discover-then-load
// (F-CHT-06), per TRD-11 §3 and §6. On every chat request the runtime rebuilds
// the system prompt (AI SDK 7 names it `instructions`) from the files under
// packages/skills/prompts/ plus the current session state, in a fixed block
// order with a byte budget per block:
//
//   1 Base prompt        prompts/base-system.md              ≤ 6 KB
//   2 Mode addendum      prompts/modes/<autonomy>.md (+offline) ≤ 1.5 KB
//   3 Routing table      generated from the registry          ≤ 2 KB
//   4 Skills index       kilnry_skills list projection        ≤ 2 KB
//   5 Project memory     <folder>/.kilnry/project.md body     ≤ 4 KB
//   6 Runtime facts      today, folder, characters, budget…   ≤ 1 KB
//
// Loaded skill bodies are NOT part of `instructions`; they are inserted as
// system messages inside the message list (§6) so the cacheable prompt prefix
// stays stable across the session. This module produces those system-message
// strings and manages the at-most-three loaded-skills window, but it does not
// call streamText or touch the AI SDK — that wiring is the Chat route (G4-13).
//
// The prompt files are read from disk exactly as the model will receive them:
// the licence comment header is stripped, and simple ${name} placeholders
// (and the documented {{ name }} / {% include %} forms) are substituted from
// the render variables. The full workflow expression engine (TRD-12 §3) is not
// needed here — the prompt files use plain variable placeholders — so this
// module ships a small, contained renderer and the general engine remains a
// M6 concern in packages/workflows.

import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';

/** How the session decides which spends need the user's approval. */
export type Autonomy = 'ask_first' | 'run_automatically';

/** Per-block byte budgets from TRD-11 §3 (measured on the rendered UTF-8 text). */
export const BLOCK_BUDGETS = {
  base: 6 * 1024,
  mode: 1.5 * 1024,
  routing: 2 * 1024,
  skills: 2 * 1024,
  memory: 4 * 1024,
  runtime: 1 * 1024,
} as const;

/** One skill as it appears in the discover-then-load index (block 4). */
export interface SkillIndexEntry {
  name: string;
  description: string;
  /** Uses this month; higher sorts first, then alphabetical by name (§6). */
  usage_count?: number;
}

/** The render variables a prompt file may reference (TRD-11 §3, TRD-13 §8.1). */
export interface PromptVars {
  today?: string;
  library_root?: string;
  folder?: string;
  autonomy?: Autonomy;
  auto_approve_below_usd?: number;
  session_budget_usd?: number;
  session_spent_usd?: number;
  budget_remaining_usd?: number;
  characters_list?: string;
  providers_connected?: string;
  language_hint?: string;
  llm_name?: string;
  llm_price?: string;
  [key: string]: unknown;
}

export interface AssembleInput {
  /** Absolute path to packages/skills/prompts (resolved by the caller). */
  promptsRoot: string;
  autonomy: Autonomy;
  /** True when the session's model is a local Ollama model: append offline.md. */
  offline?: boolean;
  vars: PromptVars;
  /** Rendered Markdown routing table (block 3); omitted when empty. */
  routingTable?: string;
  /** Enabled skills for the index projection (block 4). */
  skills?: SkillIndexEntry[];
  /** Project memory body (block 5), already read from the folder sidecar. */
  memoryBody?: string;
}

export interface AssembledInstructions {
  instructions: string;
  /** The rendered text of each block, for tests and the Run view. */
  blocks: Record<'base' | 'mode' | 'routing' | 'skills' | 'memory' | 'runtime', string>;
  /** Non-fatal render warnings (unknown variable, budget overflow). */
  warnings: string[];
}

const HEADER = /^<!--[\s\S]*?-->\n?/;

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

// Read a prompt file, containment-checked inside promptsRoot, with the licence
// header stripped so the budget matches what the model receives.
function readPromptFile(promptsRoot: string, rel: string): string {
  const full = resolve(promptsRoot, rel);
  const inside = relative(promptsRoot, full);
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(`prompt path escapes the library: ${rel}`);
  }
  return readFileSync(full, 'utf8').replace(HEADER, '');
}

// Resolve a dotted path (a.b.c) against the flat/nested render variables.
function lookup(vars: PromptVars, path: string): unknown {
  // Direct hit on a flat key first (the vars object is mostly flat).
  if (path in vars) return vars[path];
  let node: unknown = vars;
  for (const part of path.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return node;
}

// Render one placeholder value. `money` renders a number as "$0.42".
function renderValue(raw: unknown, filter: string | undefined, warnings: string[], token: string): string {
  if (raw === undefined || raw === null) {
    warnings.push(`unknown prompt variable: ${token}`);
    return '';
  }
  if (filter === 'money' && typeof raw === 'number') {
    return `$${raw.toFixed(2)}`;
  }
  return String(raw);
}

/**
 * Substitute the placeholders in one prompt template. Supports the plain
 * `${name}` and `${name.path}` form the shipped prompt files actually use, the
 * documented `{{ name }}` / `{{ name | money }}` form, and a one-level-deep
 * `{% include "rel/path.md" %}` directive resolved under promptsRoot. Unknown
 * variables render as an empty string and add a warning (strict rendering is a
 * CI build concern, not a runtime failure — TRD-13 §8.1).
 */
export function renderPrompt(
  template: string,
  vars: PromptVars,
  options: { promptsRoot?: string; warnings?: string[]; depth?: number } = {},
): string {
  const warnings = options.warnings ?? [];
  const depth = options.depth ?? 0;

  // {% include "fragments/x.md" %} — one level deep only.
  let text = template.replace(/\{%\s*include\s+"([^"]+)"\s*%\}/g, (_all, rel: string) => {
    if (depth >= 1) {
      warnings.push(`include nesting too deep: ${rel}`);
      return '';
    }
    if (!options.promptsRoot) {
      warnings.push(`include without a prompts root: ${rel}`);
      return '';
    }
    const included = readPromptFile(options.promptsRoot, rel);
    return renderPrompt(included, vars, { ...options, warnings, depth: depth + 1 });
  });

  // {{ name }} and {{ name | money }}
  text = text.replace(/\{\{\s*([\w.]+)\s*(?:\|\s*(\w+)\s*)?\}\}/g, (_all, path: string, filter?: string) =>
    renderValue(lookup(vars, path), filter, warnings, `{{ ${path} }}`),
  );

  // ${name} and ${name.path}
  text = text.replace(/\$\{\s*([\w.]+)\s*\}/g, (_all, path: string) =>
    renderValue(lookup(vars, path), undefined, warnings, `\${${path}}`),
  );

  return text;
}

/**
 * Build the skills index block (F-CHT-06, block 4): one line per enabled skill
 * as `- <name>: <description truncated to 120 chars>`, ordered by usage this
 * month then alphabetically. If the block would exceed its byte budget, the
 * lines that fit are kept and an overflow line names how many more there are so
 * the model calls `kilnry_skills list` to see them (TRD-13 §6.2).
 */
export function buildSkillsIndex(skills: SkillIndexEntry[], maxBytes: number = BLOCK_BUDGETS.skills): string {
  if (skills.length === 0) return '';
  const ordered = [...skills].sort((a, b) => {
    const usage = (b.usage_count ?? 0) - (a.usage_count ?? 0);
    return usage !== 0 ? usage : a.name.localeCompare(b.name);
  });
  const lines = ordered.map((s) => {
    const desc = s.description.replace(/\s+/g, ' ').trim();
    const clipped = desc.length > 120 ? `${desc.slice(0, 119).trimEnd()}…` : desc;
    return `- ${s.name}: ${clipped}`;
  });

  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const remaining = lines.length - i;
    const overflow = `…and ${remaining} more; call kilnry_skills list`;
    const withThis = [...kept, line].join('\n');
    // Reserve room for an overflow line if more skills remain after this one.
    const needsOverflowRoom = i < lines.length - 1;
    const projected = needsOverflowRoom ? `${withThis}\n${overflow}` : withThis;
    if (byteLength(projected) > maxBytes) {
      if (kept.length === 0) break;
      return `${kept.join('\n')}\n…and ${lines.length - kept.length} more; call kilnry_skills list`;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

// Clip a block to its byte budget, appending a marker when it had to be cut.
function clipToBudget(
  text: string,
  maxBytes: number,
  marker: string,
  warnings: string[],
  label: string,
): string {
  if (byteLength(text) <= maxBytes) return text;
  warnings.push(`${label} block exceeds ${maxBytes} bytes; truncated`);
  const room = maxBytes - byteLength(marker);
  // Trim by characters until the UTF-8 length (plus marker) fits.
  let body = text;
  while (body.length > 0 && byteLength(body) > room) {
    body = body.slice(0, -1);
  }
  return `${body}${marker}`;
}

/**
 * Assemble the six `instructions` blocks in order with their byte budgets
 * (F-CHT-07, TRD-11 §3). Returns the joined prompt, the individual rendered
 * blocks (for tests and the Run view), and any render warnings.
 */
export function assembleInstructions(input: AssembleInput): AssembledInstructions {
  const warnings: string[] = [];
  const { promptsRoot, vars } = input;

  // Block 1 — base prompt.
  const base = renderPrompt(readPromptFile(promptsRoot, 'base-system.md'), vars, {
    promptsRoot,
    warnings,
  }).trim();
  if (byteLength(base) > BLOCK_BUDGETS.base) {
    warnings.push(`base block exceeds ${BLOCK_BUDGETS.base} bytes`);
  }

  // Block 2 — mode addendum (+ offline when the model is local).
  const modeFile = input.autonomy === 'ask_first' ? 'ask-first.md' : 'run-automatically.md';
  let mode = renderPrompt(readPromptFile(promptsRoot, join('modes', modeFile)), vars, {
    promptsRoot,
    warnings,
  }).trim();
  if (input.offline) {
    const offline = renderPrompt(readPromptFile(promptsRoot, join('modes', 'offline.md')), vars, {
      promptsRoot,
      warnings,
    }).trim();
    mode = `${mode}\n\n${offline}`;
  }
  mode = clipToBudget(mode, BLOCK_BUDGETS.mode, '\n[…mode note truncated]', warnings, 'mode');

  // Block 3 — routing table (generated by the caller from the registry).
  const routing = clipToBudget(
    (input.routingTable ?? '').trim(),
    BLOCK_BUDGETS.routing,
    '\n[…routing table truncated]',
    warnings,
    'routing',
  );

  // Block 4 — skills index (discover-then-load projection).
  const skills = buildSkillsIndex(input.skills ?? [], BLOCK_BUDGETS.skills);

  // Block 5 — project memory (verbatim body, truncated with the exact marker).
  const memory = clipToBudget(
    (input.memoryBody ?? '').trim(),
    BLOCK_BUDGETS.memory,
    '\n[…memory truncated at 4 KB; open the file to edit]',
    warnings,
    'memory',
  );

  // Block 6 — runtime facts.
  const runtime = clipToBudget(
    renderRuntimeFacts(vars),
    BLOCK_BUDGETS.runtime,
    '\n[…runtime facts truncated]',
    warnings,
    'runtime',
  );

  const blocks = { base, mode, routing, skills, memory, runtime };
  const sections: Array<[string, string]> = [
    ['', base],
    ['', mode],
    ['## Routing right now', routing],
    ['## Skills you can load', skills],
    ['## Project memory', memory],
    ['## Right now', runtime],
  ];
  const instructions = sections
    .filter(([, body]) => body.length > 0)
    .map(([heading, body]) => (heading ? `${heading}\n${body}` : body))
    .join('\n\n');

  return { instructions, blocks, warnings };
}

// Render the block-6 runtime facts from the variables the caller supplies.
function renderRuntimeFacts(vars: PromptVars): string {
  const lines: string[] = [];
  if (vars.today) lines.push(`- Today is ${vars.today}.`);
  if (vars.library_root) lines.push(`- Library root: ${vars.library_root}.`);
  if (vars.folder) lines.push(`- Working folder: ${vars.folder}.`);
  if (vars.llm_name) {
    lines.push(`- Model: ${vars.llm_name}${vars.llm_price ? ` (${vars.llm_price}).` : '.'}`);
  }
  if (vars.autonomy) {
    lines.push(`- Autonomy: ${vars.autonomy === 'ask_first' ? 'Ask me first' : 'Run automatically'}.`);
  }
  if (typeof vars.budget_remaining_usd === 'number') {
    lines.push(`- Session budget remaining: $${vars.budget_remaining_usd.toFixed(2)}.`);
  }
  if (vars.providers_connected) lines.push(`- Connected providers: ${vars.providers_connected}.`);
  if (vars.characters_list) lines.push(`- Characters and elements: ${vars.characters_list}.`);
  if (vars.language_hint) lines.push(`- Reply language hint: ${vars.language_hint}.`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Discover-then-load (F-CHT-06, TRD-11 §6)
// ---------------------------------------------------------------------------

/** One skill loaded into the session's rolling window. */
export interface LoadedSkill {
  name: string;
  version: string;
  /** When it was loaded or last referenced, for least-recently-used eviction. */
  referenced_at: number;
}

/** At most this many skills stay in the session context at once (§6). */
export const MAX_LOADED_SKILLS = 3;

/**
 * The system-message text a loaded skill contributes to the message list (§6).
 * The runtime persists this as a `role: 'system'` chat message so the skill
 * stays in context for the rest of the session; it never enters `instructions`.
 */
export function skillSystemMessage(name: string, version: string, body: string): string {
  return `<skill name="${name}" version="${version}">\n${body.trim()}\n</skill>`;
}

/**
 * Add or refresh a loaded skill in the session window, evicting the least
 * recently referenced one when a fourth is loaded (§6). Returns the new window
 * and the name of any evicted skill so the caller can mark its system row as
 * evicted (`parts[0].meta.evicted = true`) and skip it when converting.
 */
export function applyLoadedSkill(
  loaded: LoadedSkill[],
  entry: { name: string; version: string },
  now: number = Date.now(),
  cap: number = MAX_LOADED_SKILLS,
): { loaded: LoadedSkill[]; evicted?: string } {
  const next = loaded.filter((s) => s.name !== entry.name);
  next.push({ name: entry.name, version: entry.version, referenced_at: now });
  if (next.length <= cap) return { loaded: next };
  // Evict the least recently referenced.
  let lruIndex = 0;
  for (let i = 1; i < next.length; i++) {
    const candidate = next[i];
    const current = next[lruIndex];
    if (candidate && current && candidate.referenced_at < current.referenced_at) lruIndex = i;
  }
  const [evicted] = next.splice(lruIndex, 1);
  return evicted ? { loaded: next, evicted: evicted.name } : { loaded: next };
}

/** Mark a loaded skill as referenced now, refreshing its LRU position. */
export function touchLoadedSkill(
  loaded: LoadedSkill[],
  name: string,
  now: number = Date.now(),
): LoadedSkill[] {
  return loaded.map((s) => (s.name === name ? { ...s, referenced_at: now } : s));
}

/**
 * Resolve the prompt-library directory relative to a caller-provided skills
 * package root. The Chat route passes the real prompts directory in (mirroring
 * how the MCP route passes skillsRoots), so the agent package needs no build
 * dependency on @kilnry/skills and the lockfile stays untouched.
 */
export function promptsRootFrom(skillsPackageRoot: string): string {
  return normalize(join(skillsPackageRoot, 'prompts'));
}
