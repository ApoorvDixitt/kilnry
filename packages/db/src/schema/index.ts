// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

export * from './auth.js';
export * from './budget.js';
export * from './catalog.js';
export * from './characters.js';
export * from './chat.js';
export * from './jobs.js';
export * from './library.js';
export * from './mcp.js';
export * from './models.js';
export * from './providers.js';
export * from './publish.js';
export * from './runs.js';
export * from './settings.js';
export * from './voices.js';

import * as auth from './auth.js';
import * as budget from './budget.js';
import * as catalog from './catalog.js';
import * as characters from './characters.js';
import * as chat from './chat.js';
import * as jobs from './jobs.js';
import * as library from './library.js';
import * as mcp from './mcp.js';
import * as models from './models.js';
import * as providers from './providers.js';
import * as publish from './publish.js';
import * as runs from './runs.js';
import * as settings from './settings.js';
import * as voices from './voices.js';

export const schema = {
  ...auth,
  ...budget,
  ...catalog,
  ...characters,
  ...chat,
  ...jobs,
  ...library,
  ...mcp,
  ...models,
  ...providers,
  ...publish,
  ...runs,
  ...settings,
  ...voices,
};
