// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import { READ_TOOLS, charactersTool, voicesTool } from './read.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-read-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

describe('read tools (F-MCP-02 §3.3, §3.4)', () => {
  it('names the read tools with the kilnry_ prefix', () => {
    expect(READ_TOOLS.map((tool) => tool.name)).toEqual([
      'kilnry_library',
      'kilnry_characters',
      'kilnry_voices',
    ]);
  });

  it('keeps descriptions under 300 tokens and marks read tools read-only', () => {
    for (const tool of READ_TOOLS) {
      expect(tokenEstimate(tool.description)).toBeLessThanOrEqual(300);
      // kilnry_voices can clone and delete, so it is not read-only overall; its
      // list and preview actions are declared read-only so a read-only token can
      // still call them (TRD-10 §3.4, §7). Every other read tool is read-only.
      if (tool.name === 'kilnry_voices') {
        expect(tool.annotations.readOnlyHint).toBe(false);
        expect(tool.readOnlyActions).toEqual(['list', 'preview']);
      } else {
        expect(tool.annotations.readOnlyHint).toBe(true);
      }
    }
  });

  it('lists characters with structured content on a fresh install', async () => {
    const state = await db();
    const result = await charactersTool.execute({ action: 'list' }, { db: state, scope: 'full' });
    expect(Array.isArray(result.structuredContent.items)).toBe(true);
  });

  it('lists the built-in voice presets', async () => {
    const state = await db();
    const result = await voicesTool.execute({ action: 'list' }, { db: state, scope: 'read_only' });
    const voices = result.structuredContent.voices as unknown[];
    expect(Array.isArray(voices)).toBe(true);
    expect(voices.length).toBeGreaterThan(0);
  });

  it('returns NO_PROVIDER for voice preview when no previewer is wired', async () => {
    const state = await db();
    const result = await voicesTool.execute({ action: 'preview' }, { db: state, scope: 'full' });
    expect((result.structuredContent.error as { code: string }).code).toBe('NO_PROVIDER');
  });

  it('previews a voice through the injected previewer and returns audio', async () => {
    const state = await db();
    const result = await voicesTool.execute(
      { action: 'preview', provider: 'elevenlabs', voice_id: 'v1' },
      {
        db: state,
        scope: 'full',
        voicePreviewer: {
          preview: async () => ({
            bytes: new Uint8Array([1, 2, 3]),
            mime: 'audio/mpeg',
            estimate_usd: 0.005,
          }),
        },
      },
    );
    expect(String(result.structuredContent.audio_data_uri)).toMatch(/^data:audio\/mpeg;base64,/);
    expect(result.structuredContent.estimate_usd).toBe(0.005);
  });

  it('deletes a stored voice through the injected deleter', async () => {
    const state = await db();
    const deleted: string[] = [];
    const result = await voicesTool.execute(
      { action: 'delete', voice_ulid: 'voice-1' },
      {
        db: state,
        scope: 'full',
        voiceDeleter: {
          delete: async (id: string) => {
            deleted.push(id);
            return true;
          },
        },
      },
    );
    expect(result.structuredContent.deleted).toBe('voice-1');
    expect(deleted).toEqual(['voice-1']);
  });
});
