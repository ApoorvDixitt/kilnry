// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { isBannedAgentPath } from './agent-paths';

describe('isBannedAgentPath (D-47, D-47a)', () => {
  it('bans coding-agent instruction files anywhere', () => {
    expect(isBannedAgentPath('AGENTS.md')).toBe(true);
    expect(isBannedAgentPath('CLAUDE.md')).toBe(true);
    expect(isBannedAgentPath('.cursor/rules')).toBe(true);
    expect(isBannedAgentPath('.kiro/steering.md')).toBe(true);
    expect(isBannedAgentPath('.github/copilot-instructions.md')).toBe(true);
    expect(isBannedAgentPath('.continue/config.json')).toBe(true);
  });

  it('bans a *.prompt.md file at the repository root or in agent locations', () => {
    expect(isBannedAgentPath('system.prompt.md')).toBe(true);
    expect(isBannedAgentPath('docs/agent.prompt.md')).toBe(true);
    expect(isBannedAgentPath('.github/pr.prompt.md')).toBe(true);
    expect(isBannedAgentPath('.claude/system.prompt.md')).toBe(true);
  });

  it('allows Kilnry product prompt assets under packages/** and apps/** (D-47a)', () => {
    expect(isBannedAgentPath('packages/core/src/characters/descriptor.prompt.md')).toBe(false);
    expect(isBannedAgentPath('packages/skills/ugc-ad/system.prompt.md')).toBe(false);
    expect(isBannedAgentPath('packages/workflows/sheet/step.prompt.md')).toBe(false);
    expect(isBannedAgentPath('apps/web/src/prompts/help.prompt.md')).toBe(false);
  });

  it('leaves ordinary product files alone', () => {
    expect(isBannedAgentPath('packages/core/src/characters/descriptor.ts')).toBe(false);
    expect(isBannedAgentPath('README.md')).toBe(false);
    expect(isBannedAgentPath('docs/STATUS.md')).toBe(false);
  });
});
