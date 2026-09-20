// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Kilnry tool set (TRD-10 §3). The 20 tools are assembled here in catalogue
// order and consumed by the Model Context Protocol server registrar and, in a
// later milestone, the Chat registrar. Groups are added one commit at a time
// (F-MCP-02); the full set of 20 is asserted by the contract test once complete.

export * from './types.js';
export * from './discovery.js';

import { DISCOVERY_TOOLS } from './discovery.js';
import type { KilnryTool } from './types.js';

// Every Kilnry tool in TRD-10 §3 order. Remaining groups are appended as they
// land (§3.2 generation and transforms, §3.3 library, §3.4 characters, §3.5
// presets/workflows/skills, §3.6 jobs and publishing).
export const KILNRY_TOOLS: KilnryTool[] = [...DISCOVERY_TOOLS];

// Look up a tool by its canonical name.
export function toolByName(name: string): KilnryTool | undefined {
  return KILNRY_TOOLS.find((tool) => tool.name === name);
}
