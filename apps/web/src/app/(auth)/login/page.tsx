// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { redirect } from 'next/navigation';
import { LoginForm } from '../../../components/login-form';
import { currentSession } from '../../../server/session';

export default async function LoginPage(): Promise<React.ReactNode> {
  if (await currentSession()) redirect('/create');
  return <LoginForm />;
}
