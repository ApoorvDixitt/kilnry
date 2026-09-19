// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { defaultLibraryRoot, loadConfig } from '@kilnry/core';
import { getSetting, hasLocalUser } from '@kilnry/db';
import { OnboardingFlow } from '../../../components/onboarding-flow';
import { BrandMark } from '../../../components/brand-mark';
import { message } from '../../../lib/messages';
import { currentSession } from '../../../server/session';

export default async function WelcomePage(): Promise<React.ReactNode> {
  const session = await currentSession();
  const hasUser = await hasLocalUser();
  const config = loadConfig();
  const library = await getSetting<string>('library_root');
  if (session && config.onboarding_complete) redirect('/create');
  if (!session && hasUser) redirect('/login');

  const setup = (await cookies()).get('kilnry_setup')?.value === '1';
  if (!hasUser && !setup) {
    return (
      <main className="terminal-gate">
        <BrandMark size={32} />
        <h1>{message('welcome.terminalTitle')}</h1>
        <p>{message('welcome.terminalBody')}</p>
        <code>http://127.0.0.1:3123/welcome?t=…</code>
      </main>
    );
  }
  return (
    <OnboardingFlow
      initialStep={hasUser ? (library ? 3 : 2) : 1}
      defaultLibrary={library ?? defaultLibraryRoot()}
      docker={process.env.KILNRY_DOCKER === '1'}
    />
  );
}
