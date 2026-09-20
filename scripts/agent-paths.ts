// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Coding-agent instruction files that may never be tracked, anywhere in the tree
// (decision D-47). These are agent configuration, not product content.
const bannedEverywhere = [
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^GEMINI\.md$/,
  /^\.cursor(?:\/|$)/,
  /^\.cursorrules$/,
  /^\.claude(?:\/|$)/,
  /^\.codex(?:\/|$)/,
  /^\.kiro(?:\/|$)/,
  /^\.github\/copilot-instructions\.md$/,
  /^\.windsurfrules$/,
  /^\.aider/,
  /^\.continue(?:\/|$)/,
];

// Decision D-47a: the *.prompt.md ban targets coding-agent instruction files at
// the repository root, in docs/, in .github/ and in dot-folders. Kilnry's own
// prompt assets under packages/** and apps/** (the appearance-descriptor prompt,
// skill and workflow texts) are product content, carry the licence header, and
// are allowed. A prompt file counts as an agent file when it is at the top level
// or under one of those instruction locations.
function isAgentPromptFile(path: string): boolean {
  if (!path.endsWith('.prompt.md')) return false;
  if (!path.includes('/')) return true; // repository root
  if (path.startsWith('docs/') || path.startsWith('.github/')) return true;
  if (path.startsWith('.')) return true; // any dot-folder
  return false;
}

// True when a tracked path is a forbidden coding-agent file (D-47, D-47a).
export function isBannedAgentPath(path: string): boolean {
  if (bannedEverywhere.some((pattern) => pattern.test(path))) return true;
  return isAgentPromptFile(path);
}
