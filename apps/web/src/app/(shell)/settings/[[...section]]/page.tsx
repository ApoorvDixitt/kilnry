// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { loadConfig } from '@kilnry/core';
import { AppearanceSettings } from '../../../../components/appearance-settings';
import { BudgetSettings } from '../../../../components/budget-settings';
import { McpSettings } from '../../../../components/mcp-settings';
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
  const section = ['providers', 'workspace', 'budget', 'security', 'mcp', 'appearance'].includes(requested)
    ? requested
    : 'providers';
  const config = loadConfig();
  const content =
    section === 'appearance' ? (
      <AppearanceSettings
        initialValue={{
          theme: config.theme,
          density: config.density,
          reduced_motion: config.reduced_motion,
        }}
      />
    ) : section === 'budget' ? (
      <BudgetSettings />
    ) : section === 'security' ? (
      <SecuritySettings />
    ) : section === 'mcp' ? (
      <McpSettings port={config.port} />
    ) : section === 'workspace' ? (
      <WorkspaceSettings libraryRoot={config.library_root ?? ''} />
    ) : (
      <ProviderSettings />
    );
  return <SettingsLayout section={section}>{content}</SettingsLayout>;
}
