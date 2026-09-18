// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { headers } from 'next/headers';
import { auth } from './auth';
import { startRuntime } from './runtime';

export async function currentSession(): Promise<Awaited<ReturnType<typeof auth.api.getSession>>> {
  await startRuntime();
  return auth.api.getSession({ headers: await headers() });
}
