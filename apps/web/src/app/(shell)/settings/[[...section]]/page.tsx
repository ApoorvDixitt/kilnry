// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { loadConfig } from '@kilnry/core';
import { ProviderSettings } from '../../../../components/provider-settings';
import { SecuritySettings } from '../../../../components/security-settings';
import { SettingsLayout } from '../../../../components/settings-layout';
import { WorkspaceSettings } from '../../../../components/workspace-settings';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}): Promise<React.ReactNode> {
  const requested = (await params).section?.[0] ?? 'providers';
  const section = ['providers', 'workspace', 'security'].includes(requested) ? requested : 'providers';
  const content =
    section === 'security' ? (
      <SecuritySettings />
    ) : section === 'workspace' ? (
      <WorkspaceSettings libraryRoot={loadConfig().library_root ?? ''} />
    ) : (
      <ProviderSettings />
    );
  return <SettingsLayout section={section}>{content}</SettingsLayout>;
}
