// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import {
  MANAGE_TOOLS,
  charactersManageTool,
  presetsTool,
  skillsTool,
  uiTool,
  workflowsTool,
} from './manage.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-manage-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

describe('management and template tools (F-MCP-02 §3.3–§3.6)', () => {
  it('names the group with the kilnry_ prefix in catalogue order', () => {
    expect(MANAGE_TOOLS.map((tool) => tool.name)).toEqual([
      'kilnry_library_manage',
      'kilnry_import',
      'kilnry_characters_manage',
      'kilnry_presets',
      'kilnry_workflows',
      'kilnry_skills',
      'kilnry_publish',
      'kilnry_ui',
    ]);
  });

  it('creates a character through kilnry_characters_manage', async () => {
    const state = await db();
    const result = await charactersManageTool.execute(
      { action: 'create', handle: 'maya', kind: 'character', display_name: 'Maya' },
      { db: state, scope: 'full' },
    );
    const item = result.structuredContent.item as { handle: string } | undefined;
    expect(item?.handle).toBe('maya');
  });

  it('returns confirmation-required for training a character', async () => {
    const state = await db();
    const result = await charactersManageTool.execute(
      { action: 'train', handle: 'maya' },
      { db: state, scope: 'full' },
    );
    expect((result.structuredContent.error as { code: string }).code).toBe('CONFIRMATION_REQUIRED');
  });

  it('lists empty presets, workflows and skills for now', async () => {
    const state = await db();
    const presets = await presetsTool.execute({ action: 'list' }, { db: state, scope: 'full' });
    const flows = await workflowsTool.execute({ action: 'list' }, { db: state, scope: 'full' });
    const skills = await skillsTool.execute({ action: 'list' }, { db: state, scope: 'read_only' });
    expect(presets.structuredContent.presets).toEqual([]);
    expect(flows.structuredContent.workflows).toEqual([]);
    expect(skills.structuredContent.skills).toEqual([]);
  });

  it('returns a widget resource link and a fallback from kilnry_ui', async () => {
    const state = await db();
    const result = await uiTool.execute({ view: 'job_progress' }, { db: state, scope: 'read_only' });
    expect(result.structuredContent.resource_uri).toBe('ui://kilnry/job_progress');
    expect(typeof result.structuredContent.fallback_text).toBe('string');
  });
});
