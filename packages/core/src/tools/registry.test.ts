// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { KILNRY_TOOLS, toolByName } from './index.js';

// The twenty locked tool names in TRD-10 §3 order. This list is the contract the
// canon check (scripts/check-canon.ts) also enforces on source and tests.
const LOCKED_NAMES = [
  'kilnry_models',
  'kilnry_estimate',
  'kilnry_providers',
  'kilnry_budget',
  'kilnry_generate',
  'kilnry_transform',
  'kilnry_ffmpeg',
  'kilnry_analyze',
  'kilnry_library',
  'kilnry_library_manage',
  'kilnry_import',
  'kilnry_characters',
  'kilnry_characters_manage',
  'kilnry_voices',
  'kilnry_presets',
  'kilnry_workflows',
  'kilnry_skills',
  'kilnry_jobs',
  'kilnry_publish',
  'kilnry_ui',
];

function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

describe('the Kilnry tool set (F-MCP-02)', () => {
  it('is exactly twenty tools in the locked catalogue order', () => {
    expect(KILNRY_TOOLS).toHaveLength(20);
    expect(KILNRY_TOOLS.map((tool) => tool.name)).toEqual(LOCKED_NAMES);
  });

  it('gives every tool a description under 300 tokens, schemas, and annotations', () => {
    for (const tool of KILNRY_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tokenEstimate(tool.description)).toBeLessThanOrEqual(300);
      expect(Object.keys(tool.inputSchema).length).toBeGreaterThan(0);
      expect(Object.keys(tool.outputSchema).length).toBeGreaterThan(0);
      expect(typeof tool.annotations).toBe('object');
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('has no duplicate names and looks up by name', () => {
    const names = new Set(KILNRY_TOOLS.map((tool) => tool.name));
    expect(names.size).toBe(20);
    expect(toolByName('kilnry_generate')?.name).toBe('kilnry_generate');
    expect(toolByName('not_a_kilnry_tool')).toBeUndefined();
  });

  it('marks the read-only tools with readOnlyHint true', () => {
    const readOnly = KILNRY_TOOLS.filter((tool) => tool.annotations.readOnlyHint === true).map(
      (tool) => tool.name,
    );
    expect(readOnly).toContain('kilnry_models');
    expect(readOnly).toContain('kilnry_library');
    expect(readOnly).toContain('kilnry_characters');
    expect(readOnly).not.toContain('kilnry_generate');
  });
});
