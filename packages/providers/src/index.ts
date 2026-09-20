// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { AdapterRegistry } from '@kilnry/core';
import { elevenlabsAdapter } from './elevenlabs/index.js';
import { falAdapter } from './fal/index.js';
import { googleAdapter } from './google/index.js';
import { higgsfieldAdapter } from './higgsfield/index.js';
import { minimaxAdapter } from './minimax/index.js';
import { ollamaAdapter } from './ollama/index.js';
import { openaiAdapter } from './openai/index.js';
import { openRouterAdapter } from './openrouter/index.js';
import { pollinationsAdapter } from './pollinations/index.js';

export * from './elevenlabs/index.js';
export * from './fal/index.js';
export * from './google/index.js';
export * from './higgsfield/index.js';
export * from './minimax/index.js';
export * from './ollama/index.js';
export * from './openai/index.js';
export * from './openrouter/index.js';
export * from './pollinations/index.js';

export const adapters: AdapterRegistry = {
  fal: falAdapter,
  openrouter: openRouterAdapter,
  google: googleAdapter,
  openai: openaiAdapter,
  elevenlabs: elevenlabsAdapter,
  minimax: minimaxAdapter,
  higgsfield: higgsfieldAdapter,
  ollama: ollamaAdapter,
  pollinations: pollinationsAdapter,
};
