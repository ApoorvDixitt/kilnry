// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { KilnryTool, ToolServices } from '@kilnry/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { chatToolNames, compactForModel, MODEL_OUTPUT_BUDGET, registerChatTools } from './tools.js';

const services = { scope: 'full' } as unknown as ToolServices;

function fakeTool(overrides: Partial<KilnryTool> = {}): KilnryTool {
  return {
    name: 'kilnry_models',
    description: 'List the models available for a capability.',
    inputSchema: { capability: z.string() },
    outputSchema: { models: z.array(z.string()) },
    annotations: { readOnlyHint: true },
    execute: async () => ({ text: 'Two models.', structuredContent: { models: ['a', 'b'] } }),
    ...overrides,
  };
}

describe('registerChatTools (TRD-11 §4)', () => {
  it('registers one AI SDK tool per Kilnry tool, keeping the description', () => {
    const registered = registerChatTools({ services }, [fakeTool()]);
    expect(Object.keys(registered)).toEqual(['kilnry_models']);
    expect(registered['kilnry_models']?.description).toBe('List the models available for a capability.');
  });

  it('runs the same implementation and adds the human summary', async () => {
    const execute = vi.fn(async () => ({ text: 'Two models.', structuredContent: { models: ['a', 'b'] } }));
    const registered = registerChatTools({ services }, [fakeTool({ execute })]);
    const result = await callTool(registered, 'kilnry_models', { capability: 'image' });
    expect(execute).toHaveBeenCalledOnce();
    expect(result).toEqual({ models: ['a', 'b'], _summary: 'Two models.' });
  });

  it('turns a thrown error into a value the model can read', async () => {
    const registered = registerChatTools({ services }, [
      fakeTool({
        execute: async () => {
          throw new Error('the disk is full');
        },
      }),
    ]);
    const result = (await callTool(registered, 'kilnry_models', {})) as {
      error: { code: string; message: string };
    };
    expect(result.error.code).toBe('PROVIDER_ERROR');
    expect(result.error.message).toBe('the disk is full');
  });

  it('reports each tool result so the Steps and Cost panes can follow along', async () => {
    const seen: string[] = [];
    const registered = registerChatTools(
      { services, onToolResult: (event) => seen.push(`${event.name}:${event.summary}`) },
      [fakeTool()],
    );
    await callTool(registered, 'kilnry_models', {});
    expect(seen).toEqual(['kilnry_models:Two models.']);
  });

  it('names the twenty tools of the catalogue by default', () => {
    expect(chatToolNames()).toHaveLength(20);
    expect(chatToolNames()).toContain('kilnry_generate');
  });

  it('disables a spend tool offline with a reason and never runs it (F-CHT-11)', async () => {
    const execute = vi.fn(async () => ({ text: 'made', structuredContent: {} }));
    const registered = registerChatTools({ services, offline: true }, [
      fakeTool({ name: 'kilnry_generate', description: 'Generate media.', execute }),
    ]);
    expect(registered['kilnry_generate']?.description).toContain('Unavailable offline');
    const result = (await callTool(registered, 'kilnry_generate', {})) as {
      error: { code: string };
    };
    expect(execute).not.toHaveBeenCalled();
    expect(result.error.code).toBe('NO_PROVIDER');
  });

  it('keeps a local tool available offline', async () => {
    const execute = vi.fn(async () => ({ text: 'listed', structuredContent: { assets: [] } }));
    const registered = registerChatTools({ services, offline: true }, [
      fakeTool({ name: 'kilnry_library', description: 'Read the Library.', execute }),
    ]);
    expect(registered['kilnry_library']?.description).not.toContain('Unavailable offline');
    await callTool(registered, 'kilnry_library', {});
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe('compactForModel (TRD-11 §4)', () => {
  it('drops preview and byte-bearing fields but keeps ids, paths and costs', () => {
    const text = compactForModel({
      asset_ids: ['01J'],
      paths: ['Campaign_A/shot.png'],
      cost_usd: 0.04,
      preview_urls: ['http://127.0.0.1:3123/api/media/01J'],
      b64_json: 'AAAA',
      _summary: 'One image.',
    });
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed['asset_ids']).toEqual(['01J']);
    expect(parsed['paths']).toEqual(['Campaign_A/shot.png']);
    expect(parsed['cost_usd']).toBe(0.04);
    expect(parsed).not.toHaveProperty('preview_urls');
    expect(parsed).not.toHaveProperty('b64_json');
  });

  it('keeps an oversized result inside the output budget', () => {
    const text = compactForModel({
      _summary: 'A long listing.',
      job_id: '01J',
      items: Array.from({ length: 5_000 }, (_, i) => `item-${i}-with-a-long-name`),
    });
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(MODEL_OUTPUT_BUDGET);
    expect(text).toContain('A long listing.');
  });
});

// Invoke a registered tool the way the AI SDK would.
async function callTool(
  registered: Record<string, unknown>,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const entry = registered[name] as {
    execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
  };
  return entry.execute(input, { toolCallId: 'call-1' });
}
