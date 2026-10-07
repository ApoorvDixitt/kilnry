// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The workflow validator (F-WFL-06, TRD-12 §7). It runs `kilnry workflows
// validate <file>` and the import path (F-PRE-04, F-SKL-03) apply, layering the
// cross-reference and security rules on top of the schema shape. Each rule from
// §7 is numbered so a failure points back at the specification. A structural
// error disables the workflow; a warning (an unconnected model) is reported but
// does not fail validation.

import { CapabilitySchema, MediaRoleSchema } from '@kilnry/core/types';
import { dirname } from 'node:path';
import { evaluateExpression, TemplateError } from './template.js';
import { readFileSource, packagesRootFrom, type FileSourceRoots } from './file-source.js';
import { parseWorkflow, WorkflowParseError } from './parse.js';
import {
  AnalyzeTaskSchema,
  FfmpegOpSchema,
  InternalAssemblyOpSchema,
  TransformOpSchema,
  type Step,
  type WorkflowFile,
} from './schema.js';

export interface WorkflowIssue {
  rule: string;
  level: 'error' | 'warning';
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  workflow?: WorkflowFile;
  issues: WorkflowIssue[];
}

const MAX_FILE_BYTES = 256 * 1024;
const MAX_DESCRIPTION = 1024;
const MAX_PROMPT = 6000;
const TEMPLATE = /\{\{([\s\S]*?)\}\}/g;
// Provider prompt tokens that must never appear in a workflow (§7 rule 7); only
// @handle mentions are allowed, and the resolver produces internal tokens.
const PROVIDER_TOKENS = [/<<</, />>>/, /@Element\d+/];

// Walk every step in the tree (including nested then/else/steps), depth first.
function walk(
  steps: Step[],
  visit: (step: Step, ancestors: string[]) => void,
  ancestors: string[] = [],
): void {
  for (const step of steps) {
    visit(step, ancestors);
    if (step.kind === 'branch') {
      walk(step.then, visit, [...ancestors, step.id]);
      walk(step.else, visit, [...ancestors, step.id]);
    } else if (step.kind === 'foreach') {
      walk(step.steps, visit, [...ancestors, step.id]);
    }
  }
}

// Collect every {{ }} expression body found anywhere in a value.
function collectTemplates(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(TEMPLATE)) if (match[1] !== undefined) out.push(match[1]);
  } else if (Array.isArray(value)) {
    for (const item of value) collectTemplates(item, out);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) collectTemplates(child, out);
  }
}

// Every plain-text string in a value, for the provider-token scan.
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value && typeof value === 'object')
    for (const child of Object.values(value as Record<string, unknown>)) collectStrings(child, out);
}

// The string literal inside each `file('...')` / `file("...")` call in an
// expression body. Only literal arguments are extracted; a computed path is left
// to plan time.
function fileRefs(body: string): string[] {
  const out: string[] = [];
  const call = /\bfile\(\s*(['"])([^'"]*)\1\s*\)/g;
  for (const match of body.matchAll(call)) if (match[2] !== undefined) out.push(match[2]);
  return out;
}

// A media ref is safe when it is an id/path/https or a template; a raw file:// or
// a `..` traversal is refused (§7 rule 11).
function unsafeMediaRef(ref: string): boolean {
  if (ref.includes('{{')) return false;
  if (ref.startsWith('file://')) return true;
  if (ref.includes('..')) return true;
  return false;
}

/** Validate a parsed workflow. `fileName` (without extension) checks rule 1. */
/**
 * What each assemble op actually reads, from its own argument builder
 * (TRD-09 §3 and TRD-12 §6.3). A parameter outside this list is refused at
 * validation rather than dropped at run time (F-65, AGENTS.md:97).
 */
const ASSEMBLE_PARAMS: Record<string, string[]> = {
  probe: [],
  thumbnail: ['width'],
  sprite_sheet: ['fps', 'width', 'cols', 'rows'],
  extract_frames: ['mode', 'n', 'count', 'fps', 'scene_threshold', 'format', 'max_width', 'duration_s'],
  trim: ['start', 'start_s', 'end', 'duration_s'],
  concat: ['mode', 'target', 'transition', 'image_hold_s', 'gap_s', 'sources'],
  resize: ['width', 'height', 'fit'],
  pad_to_aspect: ['target_aspect', 'width', 'height'],
  gif: ['fps', 'width', 'start', 'end'],
  extract_audio: [],
  mux_audio: ['mode', 'offset_s', 'audio_gain_db', 'video_gain_db', 'gain_db', 'fit', 'fit_duration_s'],
  speed: ['factor'],
  loop: ['count', 'duration_s'],
  overlay_image: ['position', 'width_pct', 'margin_px', 'opacity', 'start', 'end'],
  overlay_text: ['text', 'position', 'stroke', 'font', 'color', 'safe_zone'],
  burn_captions: [
    'transcript',
    'look',
    'font',
    'max_words',
    'max_chars',
    'caps',
    'highlight_words',
    'position',
    'safe_zone',
    'language',
  ],
  normalize_audio: ['target_lufs', 'true_peak_dbtp', 'lra'],
  split_grid: ['columns', 'rows', 'trim', 'trim_threshold', 'pad_pct', 'labels', 'tag_source'],
};

export function validateWorkflow(
  workflow: WorkflowFile,
  fileName?: string,
  roots?: FileSourceRoots,
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const error = (rule: string, message: string): void => {
    issues.push({ rule, level: 'error', message });
  };

  // Rule 1: id equals the file name (when a name is given).
  if (fileName !== undefined && workflow.id !== fileName) {
    error('7.1', `id "${workflow.id}" must equal the file name "${fileName}".`);
  }

  // Rule 2: step ids unique across the whole tree.
  const ids = new Set<string>();
  walk(workflow.steps, (step) => {
    if (ids.has(step.id)) error('7.2', `duplicate step id "${step.id}".`);
    ids.add(step.id);
  });

  // Rule 3: every {{ }} parses. (Cycle/descendant reference checks need the
  // dependency graph; the parse check catches the common failure.)
  walk(workflow.steps, (step) => {
    const templates: string[] = [];
    collectTemplates(step, templates);
    for (const body of templates) {
      try {
        evaluateExpression(body, proxyScope());
      } catch (e) {
        if (e instanceof TemplateError && /cannot parse/.test(e.message)) {
          error('7.3', `step "${step.id}" has an unparseable expression: {{${body}}}.`);
        }
        // A reference to a missing namespace key throws no parse error here; it
        // is caught at plan time. Only syntax errors fail validation.
      }
    }
  });

  // Rule 4: foreach.over that references step outputs requires expect.
  walk(workflow.steps, (step) => {
    if (step.kind === 'foreach') {
      const templates: string[] = [];
      collectTemplates(step.over, templates);
      const dependsOnSteps = templates.some((body) => /\bsteps\./.test(body));
      if (dependsOnSteps && step.expect === undefined) {
        error('7.4', `foreach "${step.id}" iterates over step outputs, so it must set "expect".`);
      }
    }
  });

  // Rule 3b (§7, file() security): every file() reference resolves inside the
  // allowed roots and, with an #EXPORT, names a string constant. Skipped when no
  // roots are known (a schema-only check with no file path), so the CLI and the
  // import path read the disk while a bare parse does not.
  if (roots !== undefined) {
    walk(workflow.steps, (step) => {
      const templates: string[] = [];
      collectTemplates(step, templates);
      for (const body of templates) {
        for (const ref of fileRefs(body)) {
          try {
            readFileSource(ref, roots);
          } catch (e) {
            error('7.11', `step "${step.id}" file(${JSON.stringify(ref)}): ${(e as Error).message}`);
          }
        }
      }
    });
  }

  // Rules 5, 6, 7, 8, 10, 11 per step.
  walk(workflow.steps, (step) => {
    // Rule 7: no provider prompt tokens anywhere.
    const strings: string[] = [];
    collectStrings(step, strings);
    for (const text of strings) {
      if (PROVIDER_TOKENS.some((pattern) => pattern.test(text))) {
        error('7.7', `step "${step.id}" contains a provider prompt token (<<<, >>> or @ElementN).`);
        break;
      }
    }

    if (step.kind === 'generate') {
      // Rule 5: known capability (a literal capability must be in the enum; an
      // expression is checked at plan time).
      if (!step.capability.includes('{{') && !CapabilitySchema.safeParse(step.capability).success) {
        error('7.5', `step "${step.id}" has an unknown capability "${step.capability}".`);
      }
      // Rule 5: media roles allowed.
      if (Array.isArray(step.medias)) {
        for (const media of step.medias) {
          if (!MediaRoleSchema.safeParse(media.role).success) {
            error('7.5', `step "${step.id}" has an unknown media role "${media.role}".`);
          }
          if (typeof media.ref === 'string' && unsafeMediaRef(media.ref)) {
            error(
              '7.11',
              `step "${step.id}" media ref "${media.ref}" must be an id, Library path or https URL.`,
            );
          }
        }
      }
      // Rule 8: a generate step must be priceable.
      const priceable = step.model === 'auto' || step.model.length > 0 || step.cost?.hint_usd !== undefined;
      if (!priceable) error('7.8', `step "${step.id}" spends but cannot be priced.`);
      // Rule 10: a single prompt ≤ 6,000 chars.
      if (typeof step.prompt === 'string' && step.prompt.length > MAX_PROMPT) {
        error('7.10', `step "${step.id}" prompt exceeds ${MAX_PROMPT} characters.`);
      }
    }

    if (step.kind === 'transform' && !TransformOpSchema.safeParse(step.op).success) {
      error('7.6', `step "${step.id}" has an unknown transform op "${step.op}".`);
    }
    if (step.kind === 'analyze' && !AnalyzeTaskSchema.safeParse(step.task).success) {
      error('7.6', `step "${step.id}" has an unknown analyze task "${step.task}".`);
    }
    if (step.kind === 'assemble') {
      const isFfmpeg = FfmpegOpSchema.safeParse(step.op).success;
      const isInternal = InternalAssemblyOpSchema.safeParse(step.op).success;
      if (!isFfmpeg && !isInternal) {
        error('7.6', `step "${step.id}" has an unknown assemble op "${step.op}".`);
      }
      // Rule 11: no {{ }} in assemble.params keys.
      for (const key of Object.keys(step.params)) {
        if (key.includes('{{')) error('7.11', `step "${step.id}" has a template in an assemble param key.`);
      }
      // TRD-12:218: assemble.params validate against the op's own parameter
      // schema. Only the op name was checked, so a parameter the builder never
      // reads passed validation and was silently dropped at run time — exactly
      // what AGENTS.md:97 calls a defect (F-65).
      const accepted = ASSEMBLE_PARAMS[step.op];
      if (accepted) {
        for (const key of Object.keys(step.params)) {
          if (key.includes('{{')) continue;
          if (!accepted.includes(key)) {
            error(
              '7.6',
              `step "${step.id}" passes "${key}" to ${step.op}, which does not read it. ${step.op} takes: ${accepted.join(', ') || '(no parameters)'}.`,
            );
          }
        }
      }
    }
  });

  // Rule 9: outputs.final must resolve to an asset-producing step.
  if (workflow.outputs.final !== undefined) {
    const referenced = [...workflow.outputs.final.matchAll(/steps\.([a-z0-9][a-z0-9_-]*)/g)].map(
      (match) => match[1],
    );
    const assetProducers = new Set<string>();
    walk(workflow.steps, (step) => {
      if (['generate', 'transform', 'assemble', 'foreach', 'set', 'export'].includes(step.kind)) {
        assetProducers.add(step.id);
      }
    });
    const resolves =
      referenced.length === 0 || referenced.some((id) => id !== undefined && assetProducers.has(id));
    if (!resolves) error('7.9', 'outputs.final does not resolve to an asset-producing step.');
  }

  return issues;
}

/** Validate a workflow from its YAML text; the parse errors become rule 1. */
export function validateWorkflowFile(yaml: string, fileName?: string, filePath?: string): ValidationResult {
  if (new TextEncoder().encode(yaml).length > MAX_FILE_BYTES) {
    return {
      ok: false,
      issues: [{ rule: '7.10', level: 'error', message: 'workflow file exceeds 256 KB.' }],
    };
  }
  let workflow: WorkflowFile;
  try {
    workflow = parseWorkflow(yaml);
  } catch (e) {
    if (e instanceof WorkflowParseError) {
      const issues = (e.issues.length > 0 ? e.issues : [e.message]).map<WorkflowIssue>((message) => ({
        rule: '7.1',
        level: 'error',
        message,
      }));
      return { ok: false, issues };
    }
    throw e;
  }
  if (workflow.description !== undefined && workflow.description.length > MAX_DESCRIPTION) {
    return {
      ok: false,
      workflow,
      issues: [{ rule: '7.10', level: 'error', message: 'description exceeds 1,024 characters.' }],
    };
  }
  const issues = validateWorkflow(workflow, fileName, rootsFor(filePath));
  return { ok: !issues.some((issue) => issue.level === 'error'), workflow, issues };
}

// Derive the file() roots from the workflow file's own path: its folder is one
// allowed root, and the packages directory containing it (or containing the
// process's own packages) is the other. Returns undefined when no path is known,
// which turns the file() rule off.
function rootsFor(filePath?: string): FileSourceRoots | undefined {
  if (filePath === undefined) return undefined;
  const workflowDir = dirname(filePath);
  return { packagesRoot: packagesRootFrom(workflowDir), workflowDir };
}

// A scope whose every member access returns another proxy, so evaluating a
// well-formed expression never throws on a missing key during validation; only a
// genuine syntax error (a parse failure) is reported by rule 3.
function proxyScope(): Record<string, unknown> {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get: () => new Proxy({}, handler),
  };
  return new Proxy({}, handler);
}
