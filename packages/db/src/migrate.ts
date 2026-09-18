// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { closeDatabase, database } from './client.js';

const state = database(process.env.KILNRY_DATA_DIR ?? '.dev/kilnry');
await state.ready;
process.stdout.write(`Database migrations applied at ${state.dataDir}.\n`);
await closeDatabase();
