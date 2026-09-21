// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The read tools for the Library, Characters/Elements, and Voices (TRD-10 §3.3
// and §3.4 read halves): kilnry_library searches and reads assets and folders,
// kilnry_characters lists, gets, resolves prompts for, and reports usage of
// Characters and Elements, and kilnry_voices lists provider and cloned voices.
// All three are read-only; the write and spend siblings live in their own
// modules.

import * as z from 'zod';
import { getAssetDetail } from '../library/assets.js';
import { parseSearchQuery, searchAssets } from '../library/search.js';
import { listCards, loadFullCharacter, usageAssets } from '../characters/full.js';
import { findModelManifest, resolvePromptFromDb } from '../characters/resolve-db.js';
import { listVoices } from '../characters/voices.js';
import { loadRegistry } from '../registry/store.js';
import { loadConfig } from '../config/load.js';
import { toolError, type KilnryTool, type ToolResult, type ToolServices } from './types.js';

function libraryRoot(): string | null {
  const config = loadConfig();
  return config.library_root ?? null;
}

// kilnry_library — search and read assets and folders (read-only).
export const libraryTool: KilnryTool = {
  name: 'kilnry_library',
  description:
    'Search and read the Library (read-only). Search assets with a query and filters, get one asset, or list recent items. Filters cover type, model, provider, character handle, folder, date range, minimum cost, and tags. Returns each asset with its path, type, dimensions, prompt, model, cost, characters, tags, folder, and preview link. Never writes.',
  inputSchema: {
    action: z.enum(['search', 'get', 'list_folder', 'recent']).default('search'),
    query: z.string().optional(),
    asset_id: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(24),
  },
  outputSchema: {
    assets: z.array(z.record(z.string(), z.unknown())).optional(),
    asset: z.record(z.string(), z.unknown()).optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: true },
  async execute(input, services: ToolServices): Promise<ToolResult> {
    const root = libraryRoot();
    if (!root) return toolError('NOT_FOUND', 'The Library root is not configured yet.');
    const action = typeof input.action === 'string' ? input.action : 'search';
    const assetId = typeof input.asset_id === 'string' ? input.asset_id : undefined;

    if (action === 'get') {
      if (!assetId) return toolError('INVALID_INPUT', 'Getting an asset needs an asset_id.');
      try {
        const asset = await getAssetDetail(services.db, root, assetId);
        return { text: `${asset.path} (${asset.kind}).`, structuredContent: { asset } };
      } catch (error) {
        return toolError('NOT_FOUND', error instanceof Error ? error.message : 'Asset not found.');
      }
    }

    const query = typeof input.query === 'string' ? input.query : '';
    const limit = typeof input.limit === 'number' ? input.limit : 24;
    const parsed = parseSearchQuery(action === 'recent' ? '' : query);
    const rows = (await searchAssets(services.db, parsed)).slice(0, limit);
    const assets = rows.map((row) => ({
      asset_id: row.id,
      path: row.path,
      type: row.kind,
      created_at: row.created_at,
      cost_usd: row.actual_usd,
      folder: row.folder_path,
      preview_url: `/api/media/${row.id}`,
      sidecar_ok: row.sidecar_ok,
    }));
    return { text: `${assets.length} asset(s) found.`, structuredContent: { assets } };
  },
};

// kilnry_characters — read and resolve Characters and Elements (read-only).
export const charactersTool: KilnryTool = {
  name: 'kilnry_characters',
  description:
    'Read and resolve Characters and Elements (read-only). List or get by handle, resolve a prompt to see exactly what a chosen model would receive for its @mentions, or list the assets a character was used in. Returns handles, versions, tags, anchors, reference counts, training and voice bindings, consent status, and usage. Never writes.',
  inputSchema: {
    action: z.enum(['list', 'get', 'resolve_prompt', 'usage']).default('list'),
    kind: z.enum(['character', 'prop', 'environment', 'style']).optional(),
    handle: z.string().optional(),
    query: z.string().optional(),
    prompt: z.string().optional(),
    model: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(24),
  },
  outputSchema: {
    items: z.array(z.record(z.string(), z.unknown())).optional(),
    item: z.record(z.string(), z.unknown()).optional(),
    resolution: z.record(z.string(), z.unknown()).optional(),
    usage: z.record(z.string(), z.unknown()).optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: true },
  async execute(input, services: ToolServices): Promise<ToolResult> {
    const action = typeof input.action === 'string' ? input.action : 'list';
    const handle = typeof input.handle === 'string' ? input.handle : undefined;

    if (action === 'get') {
      if (!handle) return toolError('INVALID_INPUT', 'Getting a character needs a handle.');
      try {
        const item = await loadFullCharacter(services.db, handle);
        // The switcher and this tool must agree on the versions and their job
        // counts (F-CHR-10 acceptance 3), so return the detailed rows too.
        const { lookupHandle, listVersions } = await import('../characters/store.js');
        const head = await lookupHandle(services.db, handle);
        const versions = head ? await listVersions(services.db, head.id) : [];
        return {
          text: `@${item.handle} (${item.kind}).`,
          structuredContent: { item: { ...item, versions } },
        };
      } catch (error) {
        return toolError('NOT_FOUND', error instanceof Error ? error.message : 'Character not found.');
      }
    }

    if (action === 'usage') {
      if (!handle) return toolError('INVALID_INPUT', 'Usage needs a handle.');
      try {
        const assets = await usageAssets(services.db, handle);
        return {
          text: `@${handle} was used in ${assets.length} asset(s).`,
          structuredContent: { usage: { assets } },
        };
      } catch (error) {
        return toolError('NOT_FOUND', error instanceof Error ? error.message : 'Character not found.');
      }
    }

    if (action === 'resolve_prompt') {
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';
      const requested = typeof input.model === 'string' && input.model !== 'auto' ? input.model : undefined;
      let modelId = requested;
      if (!modelId) {
        const registry = await loadRegistry(services.db);
        modelId = registry.models[0]?.model_id;
      }
      if (!modelId) return toolError('NOT_FOUND', 'No model is available to resolve against.');
      let model;
      try {
        model = await findModelManifest(services.db, modelId);
      } catch {
        return toolError('NOT_FOUND', `Model ${modelId} is not in the registry.`);
      }
      const resolved = await resolvePromptFromDb(
        services.db,
        { kind: 'image', prompt, params: {}, medias: [], injections: [] } as never,
        model,
      );
      return {
        text: `${resolved.injections.length} mention(s) resolved.`,
        structuredContent: {
          resolution: {
            rewritten_prompt: resolved.prompt,
            injections: resolved.injections,
            warnings: resolved.warnings,
          },
        },
      };
    }

    const kind = typeof input.kind === 'string' ? (input.kind as never) : undefined;
    const query = typeof input.query === 'string' ? input.query : undefined;
    const cards = await listCards(services.db, {
      ...(kind ? { kind } : {}),
      ...(query ? { query } : {}),
    });
    const items = cards.map((card) => ({
      handle: card.handle,
      display_name: card.display_name,
      kind: card.kind,
      version: card.version,
      tags: card.tags,
      usage_count: card.usage_count,
      is_real_person: card.is_real_person,
    }));
    return { text: `${items.length} item(s).`, structuredContent: { items } };
  },
};

// kilnry_voices — presets, previews, cloning. Read paths only in M4; preview and
// clone route to the providers, which arrive in a later milestone.
export const voicesTool: KilnryTool = {
  name: 'kilnry_voices',
  description:
    'List voices for text to speech (read-only listing). Filter provider presets and any cloned voices by provider, language, gender, or text query. Returns each voice with its provider, id, name, language, gender, tags, and whether it is a clone. Previewing and cloning route to a provider and arrive in a later milestone.',
  inputSchema: {
    action: z.enum(['list', 'preview', 'clone', 'delete']).default('list'),
    provider: z.string().optional(),
    language: z.string().optional(),
    query: z.string().optional(),
  },
  outputSchema: {
    voices: z.array(z.record(z.string(), z.unknown())).optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async execute(input, services: ToolServices): Promise<ToolResult> {
    const action = typeof input.action === 'string' ? input.action : 'list';
    if (action !== 'list') {
      return toolError('NO_PROVIDER', 'Voice preview and cloning arrive in a later milestone.');
    }
    const filter: { provider?: string; language?: string; query?: string } = {};
    if (typeof input.provider === 'string') filter.provider = input.provider;
    if (typeof input.language === 'string') filter.language = input.language;
    if (typeof input.query === 'string') filter.query = input.query;
    const voices = await listVoices(services.db, filter);
    return {
      text: `${voices.length} voice(s).`,
      structuredContent: {
        voices: voices.map((voice) => ({
          provider: voice.provider,
          voice_id: voice.voice_id,
          name: voice.name,
          language: voice.language,
          gender: voice.gender,
          tags: voice.tags,
          is_clone: voice.is_clone,
        })),
      },
    };
  },
};

// The Library and reusable-things read group.
export const READ_TOOLS: KilnryTool[] = [libraryTool, charactersTool, voicesTool];
