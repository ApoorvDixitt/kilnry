// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Kilnry tool set (TRD-10 §3). All twenty tools are assembled here in
// catalogue order and consumed by the Model Context Protocol server registrar
// and, in a later milestone, the Chat registrar (TRD-10 §2.9).

export * from './types.js';
export * from './discovery.js';
export * from './generation.js';
export * from './read.js';
export * from './manage.js';

import { modelsTool, estimateTool, providersTool, budgetTool } from './discovery.js';
import { generateTool, transformTool, ffmpegTool, analyzeTool, jobsTool } from './generation.js';
import { libraryTool, charactersTool, voicesTool } from './read.js';
import {
  libraryManageTool,
  importTool,
  charactersManageTool,
  presetsTool,
  workflowsTool,
  skillsTool,
  publishTool,
  uiTool,
} from './manage.js';
import type { KilnryTool } from './types.js';

// The twenty tools in TRD-10 §3 order: discovery and pricing, generation and
// transforms, library, characters and voices, presets/workflows/skills, then
// jobs and publishing.
export const KILNRY_TOOLS: KilnryTool[] = [
  modelsTool,
  estimateTool,
  providersTool,
  budgetTool,
  generateTool,
  transformTool,
  ffmpegTool,
  analyzeTool,
  libraryTool,
  libraryManageTool,
  importTool,
  charactersTool,
  charactersManageTool,
  voicesTool,
  presetsTool,
  workflowsTool,
  skillsTool,
  jobsTool,
  publishTool,
  uiTool,
];

// Look up a tool by its canonical name.
export function toolByName(name: string): KilnryTool | undefined {
  return KILNRY_TOOLS.find((tool) => tool.name === name);
}
