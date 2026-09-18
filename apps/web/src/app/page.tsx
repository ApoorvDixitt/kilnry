// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { redirect } from 'next/navigation';
import { hasLocalUser } from '@kilnry/db';
import { loadConfig } from '@kilnry/core';
import { currentSession } from '../server/session';

export default async function HomePage(): Promise<never> {
  const session = await currentSession();
  if (session) redirect(loadConfig().onboarding_complete ? '/create' : '/welcome');
  redirect((await hasLocalUser()) ? '/login' : '/welcome');
}
