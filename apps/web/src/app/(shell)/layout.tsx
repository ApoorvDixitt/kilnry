// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { hasLocalUser } from '@kilnry/db';
import { loadConfig } from '@kilnry/core';
import { AppShell } from '../../components/app-shell';
import { currentSession } from '../../server/session';

export default async function ShellLayout({ children }: { children: ReactNode }): Promise<React.ReactNode> {
  const session = await currentSession();
  if (!session) redirect((await hasLocalUser()) ? '/login' : '/welcome');
  if (!loadConfig().onboarding_complete) redirect('/welcome');
  return <AppShell>{children}</AppShell>;
}
