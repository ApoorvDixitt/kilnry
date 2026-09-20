// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The management, template and publishing tools (TRD-10 §3.3 writes, §3.4
// writes, §3.5 and §3.6). kilnry_library_manage changes the Library,
// kilnry_import brings media in, kilnry_characters_manage creates and changes
// Characters and Elements, kilnry_presets and kilnry_workflows browse and run
// templates, kilnry_skills discovers agent instructions, kilnry_publish posts to
// social accounts, and kilnry_ui opens a widget. Actions whose provider or
// pipeline arrives in a later milestone return a clear not-available result.

import * as z from 'zod';
import { rename as fsRename, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createCharacter } from '../characters/store.js';
import { setConsent } from '../characters/consent.js';
import { createFolder } from '../library/folders.js';
import { deleteAssetToTrash, restoreAsset, updateAssetMetadata } from '../library/assets.js';
import { getAssetDetail } from '../library/assets.js';
import { indexAsset } from '../library/index.js';
import { resolveInRoot } from '../library/containment.js';
import { sidecarPath } from '../library/sidecar.js';
import { toolError, type KilnryTool, type ToolResult, type ToolServices } from './types.js';

const MediaRef = z.string();

// kilnry_library_manage — change the Library (writes to disk).
export const libraryManageTool: KilnryTool = {
  name: 'kilnry_library_manage',
  description:
    'Change the Library: move, rename, copy, delete, restore, create a folder, tag, untag, set a prompt, or export a bundle. Give the asset ids or paths and the action parameters. Deleting moves to Trash with a thirty-day restore. Returns what was affected and an undo token where one applies.',
  inputSchema: {
    action: z.enum([
      'move',
      'rename',
      'copy',
      'delete',
      'restore',
      'create_folder',
      'tag',
      'untag',
      'set_prompt',
      'export_bundle',
    ]),
    asset_ids: z.array(z.string()).optional(),
    to_folder: z.string().optional(),
    new_name: z.string().optional(),
    tags: z.array(z.string()).optional(),
    prompt: z.string().optional(),
  },
  outputSchema: {
    ok: z.boolean().optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  async execute(input, services: ToolServices): Promise<ToolResult> {
    const root = services.libraryRoot;
    const libraryId = services.libraryId;
    if (!root || !libraryId) return toolError('NOT_FOUND', 'The Library root is not configured yet.');
    const action = typeof input.action === 'string' ? input.action : '';
    const assetIds = Array.isArray(input.asset_ids) ? (input.asset_ids as string[]) : [];

    if (action === 'export_bundle') {
      return toolError('NO_PROVIDER', 'Exporting a bundle is F-LIB-14 and arrives in a later milestone.');
    }
    if (action === 'create_folder') {
      const name = typeof input.new_name === 'string' ? input.new_name : '';
      const parent = typeof input.to_folder === 'string' ? input.to_folder : '';
      if (!name) return toolError('INVALID_INPUT', 'A folder needs a name.');
      await createFolder(root, parent, name);
      return {
        text: `Created folder ${parent ? `${parent}/` : ''}${name}.`,
        structuredContent: { ok: true },
      };
    }

    if (assetIds.length === 0) return toolError('INVALID_INPUT', 'This action needs one or more asset ids.');
    const affected: Array<{ asset_id?: string; from?: string; to?: string }> = [];
    try {
      for (const assetId of assetIds) {
        if (action === 'delete') {
          await deleteAssetToTrash(services.db, root, libraryId, assetId);
          affected.push({ asset_id: assetId });
        } else if (action === 'restore') {
          await restoreAsset(services.db, root, assetId);
          affected.push({ asset_id: assetId });
        } else if (action === 'tag' || action === 'untag') {
          const detail = await getAssetDetail(services.db, root, assetId);
          const current = new Set(detail.tags);
          for (const tag of (input.tags as string[] | undefined) ?? []) {
            if (action === 'tag') current.add(tag);
            else current.delete(tag);
          }
          await updateAssetMetadata(services.db, root, libraryId, assetId, { tags: [...current] });
          affected.push({ asset_id: assetId });
        } else if (action === 'set_prompt' || action === 'write_sidecar') {
          const prompt = typeof input.prompt === 'string' ? input.prompt : undefined;
          await updateAssetMetadata(services.db, root, libraryId, assetId, {
            ...(prompt !== undefined ? { prompt } : {}),
            ...(Array.isArray(input.tags) ? { tags: input.tags as string[] } : {}),
          });
          affected.push({ asset_id: assetId });
        } else if (action === 'move' || action === 'rename' || action === 'copy') {
          const from = await getAssetDetail(services.db, root, assetId);
          const fromAbs = (await resolveInRoot(root, from.path, { mustExist: true })).abs;
          const name = action === 'rename' && typeof input.new_name === 'string' ? input.new_name : null;
          const folder = action !== 'rename' && typeof input.to_folder === 'string' ? input.to_folder : null;
          const baseName = name ?? from.path.split('/').at(-1)!;
          const destFolderAbs = folder
            ? (await resolveInRoot(root, folder, { mustExist: false })).abs
            : dirname(fromAbs);
          await mkdir(destFolderAbs, { recursive: true, mode: 0o700 });
          const destAbs = join(destFolderAbs, baseName);
          if (action === 'copy') {
            await copyFile(fromAbs, destAbs);
          } else {
            await fsRename(fromAbs, destAbs);
            await fsRename(sidecarPath(fromAbs), sidecarPath(destAbs)).catch(() => undefined);
          }
          const destRel = destAbs.startsWith(root) ? destAbs.slice(root.length + 1) : baseName;
          const indexed = await indexAsset(services.db, root, destRel, libraryId);
          affected.push({ asset_id: indexed.sidecar.asset_id, from: from.path, to: destRel });
        } else {
          return toolError('INVALID_INPUT', `Unknown Library action: ${action}.`);
        }
      }
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : 'INVALID_INPUT';
      return toolError(code, error instanceof Error ? error.message : 'Could not change the Library.');
    }
    return {
      text: `${action} affected ${affected.length} item(s).`,
      structuredContent: { ok: true, affected },
    };
  },
};

// kilnry_import — bring media into the Library.
export const importTool: KilnryTool = {
  name: 'kilnry_import',
  description:
    'Bring media into the Library from URLs or absolute paths inside the Library root, up to twenty at once, optionally into a target folder, with tags, or registered as an element. Returns each imported asset with its id, path and type, plus any per-source errors.',
  inputSchema: {
    sources: z.array(MediaRef).min(1).max(20),
    target_folder: z.string().default('inbox'),
    tags: z.array(z.string()).optional(),
  },
  outputSchema: {
    assets: z.array(z.record(z.string(), z.unknown())).optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: false, openWorldHint: true },
  async execute(): Promise<ToolResult> {
    return toolError('NO_PROVIDER', 'Importing over the tool interface arrives in a later milestone.');
  },
};

// kilnry_characters_manage — create and change Characters and Elements.
export const charactersManageTool: KilnryTool = {
  name: 'kilnry_characters_manage',
  description:
    'Create and change Characters and Elements: create, update, add or remove references, set consent, build a reference sheet, train, bind a voice, cut a new version, or delete. Training a real person needs consent set first and returns confirmation-required until it is. Returns the changed item or the jobs a build started.',
  inputSchema: {
    action: z.enum([
      'create',
      'update',
      'add_references',
      'remove_reference',
      'set_consent',
      'build_sheet',
      'train',
      'bind_voice',
      'new_version',
      'delete',
    ]),
    handle: z.string().optional(),
    kind: z.enum(['character', 'prop', 'environment', 'style']).optional(),
    display_name: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    consent: z
      .object({
        is_real_person: z.boolean(),
        status: z.enum(['self', 'written', 'none', 'n/a']),
        evidence_asset_id: z.string().optional(),
      })
      .optional(),
    confirm_cost_usd: z.number().optional(),
  },
  outputSchema: {
    item: z.record(z.string(), z.unknown()).optional(),
    needs_confirmation: z.boolean().optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async execute(input, services: ToolServices): Promise<ToolResult> {
    const action = typeof input.action === 'string' ? input.action : 'create';

    if (action === 'create') {
      const handle = typeof input.handle === 'string' ? input.handle : '';
      const displayName = typeof input.display_name === 'string' ? input.display_name : '';
      const kind = typeof input.kind === 'string' ? input.kind : 'character';
      if (!handle || !displayName) {
        return toolError('INVALID_INPUT', 'A new character needs a handle and a display name.');
      }
      try {
        const head = await createCharacter(services.db, {
          handle,
          kind: kind as never,
          display_name: displayName,
          ...(typeof input.description === 'string' ? { description: input.description } : {}),
          ...(Array.isArray(input.tags) ? { tags: input.tags as string[] } : {}),
        } as never);
        return {
          text: `Created @${head.handle}.`,
          structuredContent: { item: { id: head.id, handle: head.handle, kind: head.kind } },
        };
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error ? String(error.code) : 'INVALID_INPUT';
        return toolError(code, error instanceof Error ? error.message : 'Could not create the character.');
      }
    }

    if (action === 'set_consent') {
      const handle = typeof input.handle === 'string' ? input.handle : '';
      const consent = input.consent as
        | { is_real_person: boolean; status: 'self' | 'written' | 'none' | 'n/a'; evidence_asset_id?: string }
        | undefined;
      if (!handle || !consent)
        return toolError('INVALID_INPUT', 'Setting consent needs a handle and a choice.');
      const { lookupHandle } = await import('../characters/store.js');
      const head = await lookupHandle(services.db, handle);
      if (!head) return toolError('NOT_FOUND', `@${handle} is not a Character.`);
      try {
        const state = await setConsent(services.db, head.id, {
          is_real_person: consent.is_real_person,
          status: consent.status,
          ...(consent.evidence_asset_id ? { evidence_asset_id: consent.evidence_asset_id } : {}),
        } as never);
        return { text: `Consent set to ${state.status}.`, structuredContent: { item: { consent: state } } };
      } catch (error) {
        return toolError('INVALID_INPUT', error instanceof Error ? error.message : 'Could not set consent.');
      }
    }

    if (action === 'train') {
      // Training spends and needs consent; it returns confirmation-required
      // until consent is set and a cost is acknowledged (F-MCP-06 tightens this).
      return toolError(
        'CONFIRMATION_REQUIRED',
        'Training needs consent set and an acknowledged cost; it arrives in a later milestone.',
      );
    }

    return toolError('NO_PROVIDER', `The ${action} action arrives in a later milestone.`);
  },
};

// kilnry_presets — browse and run presets.
export const presetsTool: KilnryTool = {
  name: 'kilnry_presets',
  description:
    'Browse and run presets: list by category or query, get one, or run it with inputs. Running a preset spends and estimates first. Returns the presets with their indicative cost and slots, or the jobs a run started. Presets themselves arrive in a later milestone, so listing returns an empty set for now.',
  inputSchema: {
    action: z.enum(['list', 'get', 'run']).default('list'),
    category: z.string().optional(),
    query: z.string().optional(),
    preset_id: z.string().optional(),
    confirm_cost_usd: z.number().optional(),
  },
  outputSchema: {
    presets: z.array(z.record(z.string(), z.unknown())).optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: false, openWorldHint: true },
  async execute(input): Promise<ToolResult> {
    const action = typeof input.action === 'string' ? input.action : 'list';
    if (action === 'list') return { text: 'No presets yet.', structuredContent: { presets: [] } };
    return toolError('NO_PROVIDER', 'Presets arrive in a later milestone.');
  },
};

// kilnry_workflows — browse, plan, run, and steer pipelines.
export const workflowsTool: KilnryTool = {
  name: 'kilnry_workflows',
  description:
    'Browse, plan, run, and steer multi-step pipelines: list, get, plan (never spends), run, check status, approve or deny a step, cancel, or retry a step. Returns the workflows with their cost range, a plan with per-step estimates, or a run with its steps and spend. The full workflow engine arrives in a later milestone, so listing returns an empty set for now.',
  inputSchema: {
    action: z
      .enum(['list', 'get', 'plan', 'run', 'status', 'approve', 'deny', 'cancel', 'retry_step', 'list_runs'])
      .default('list'),
    workflow_id: z.string().optional(),
    run_id: z.string().optional(),
    confirm_cost_usd: z.number().optional(),
  },
  outputSchema: {
    workflows: z.array(z.record(z.string(), z.unknown())).optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: false, openWorldHint: true },
  async execute(input): Promise<ToolResult> {
    const action = typeof input.action === 'string' ? input.action : 'list';
    if (action === 'list' || action === 'list_runs') {
      return { text: 'No workflows yet.', structuredContent: { workflows: [] } };
    }
    return toolError('NO_PROVIDER', 'Workflows arrive in a later milestone.');
  },
};

// kilnry_skills — discover then load agent instructions.
export const skillsTool: KilnryTool = {
  name: 'kilnry_skills',
  description:
    'Discover then load agent instructions: list skills (a short entry each), load one skill body in full, or load a file referenced inside a skill. The base instructions tell an agent to list first and load exactly one. Returns the skills, a skill body, or a file. Read-only. Bundled skills arrive in a later milestone, so listing returns an empty set for now.',
  inputSchema: {
    action: z.enum(['list', 'load', 'load_file']).default('list'),
    name: z.string().optional(),
    path: z.string().optional(),
    query: z.string().optional(),
  },
  outputSchema: {
    skills: z.array(z.record(z.string(), z.unknown())).optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: true },
  async execute(input): Promise<ToolResult> {
    const action = typeof input.action === 'string' ? input.action : 'list';
    if (action === 'list') return { text: 'No skills yet.', structuredContent: { skills: [] } };
    return toolError('NOT_FOUND', 'No such skill; bundled skills arrive in a later milestone.');
  },
};

// kilnry_publish — TikTok (gated).
export const publishTool: KilnryTool = {
  name: 'kilnry_publish',
  description:
    'Publish to a connected social account (TikTok first, gated): list accounts, connect, prepare a post, publish, check status, or list trending music. Returns accounts, an authorize link, a prepared session with its required confirmations, or a publish status. Returns not-available until the deployer configures a provider app.',
  inputSchema: {
    action: z
      .enum(['accounts', 'connect', 'prepare', 'publish', 'status', 'music_trending'])
      .default('accounts'),
    asset_id: z.string().optional(),
    title: z.string().optional(),
  },
  outputSchema: {
    accounts: z.array(z.record(z.string(), z.unknown())).optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { openWorldHint: true, destructiveHint: false },
  async execute(): Promise<ToolResult> {
    return toolError('NO_PROVIDER', 'Publishing needs a provider app that the deployer configures.');
  },
};

// kilnry_ui — open an MCP App widget.
export const uiTool: KilnryTool = {
  name: 'kilnry_ui',
  description:
    'Open a small Kilnry widget in a client that supports MCP Apps: a job-progress view, an asset picker, or a character picker. Returns the widget resource link and a plain-text fallback so a client without widget support still shows something useful. Read-only.',
  inputSchema: {
    view: z.enum(['job_progress', 'asset_picker', 'character_picker']),
    job_ids: z.array(z.string()).optional(),
    folder: z.string().optional(),
    kind: z.string().optional(),
  },
  outputSchema: {
    resource_uri: z.string(),
    fallback_text: z.string(),
  },
  annotations: { readOnlyHint: true },
  async execute(input): Promise<ToolResult> {
    const view = typeof input.view === 'string' ? input.view : 'job_progress';
    return {
      text: `Open the ${view.replace('_', ' ')} in a widget-capable client.`,
      structuredContent: {
        resource_uri: `ui://kilnry/${view}`,
        fallback_text: `Open the ${view.replace('_', ' ')} in the Kilnry window.`,
      },
    };
  },
};

// The management, template and publishing group.
export const MANAGE_TOOLS: KilnryTool[] = [
  libraryManageTool,
  importTool,
  charactersManageTool,
  presetsTool,
  workflowsTool,
  skillsTool,
  publishTool,
  uiTool,
];
