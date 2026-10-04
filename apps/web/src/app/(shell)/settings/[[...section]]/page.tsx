// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { appVersion, aboutInfo, loadConfig } from '@kilnry/core';
import { AboutSettings } from '../../../../components/about-settings';
import { AppearanceSettings } from '../../../../components/appearance-settings';
import { BudgetSettings } from '../../../../components/budget-settings';
import { CharactersSettings } from '../../../../components/characters-settings';
import { ChatSettings } from '../../../../components/chat-settings';
import { McpSettings } from '../../../../components/mcp-settings';
import { ProviderSettings } from '../../../../components/provider-settings';
import { SecuritySettings } from '../../../../components/security-settings';
import { SkillsSettings } from '../../../../components/skills-settings';
import { PresetsSettings } from '../../../../components/presets-settings';
import { SettingsLayout } from '../../../../components/settings-layout';
import { UpdatesSettings } from '../../../../components/updates-settings';
import { WorkspaceSettings } from '../../../../components/workspace-settings';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}): Promise<React.ReactNode> {
  const requested = (await params).section?.[0] ?? 'providers';
  const section = [
    'providers',
    'workspace',
    'budget',
    'chat',
    'security',
    'mcp',
    'skills',
    'presets',
    'characters',
    'appearance',
    'updates',
    'about',
  ].includes(requested)
    ? requested
    : 'providers';
  const config = loadConfig();
  const content =
    section === 'characters' ? (
      <CharactersSettings />
    ) : section === 'appearance' ? (
      <AppearanceSettings
        initialValue={{
          theme: config.theme,
          density: config.density,
          reduced_motion: config.reduced_motion,
        }}
      />
    ) : section === 'budget' ? (
      <BudgetSettings />
    ) : section === 'chat' ? (
      <ChatSettings />
    ) : section === 'security' ? (
      <SecuritySettings />
    ) : section === 'mcp' ? (
      <McpSettings port={config.port} />
    ) : section === 'skills' ? (
      <SkillsSettings />
    ) : section === 'presets' ? (
      <PresetsSettings />
    ) : section === 'workspace' ? (
      <WorkspaceSettings libraryRoot={config.library_root ?? ''} />
    ) : section === 'updates' ? (
      <UpdatesSettings
        initial={{
          current: appVersion(),
          channel: config.update_channel,
          auto_check: config.update_check,
          update_command: 'npx kilnry@latest',
        }}
      />
    ) : section === 'about' ? (
      <AboutSettings initial={aboutInfo()} />
    ) : (
      <ProviderSettings />
    );
  return <SettingsLayout section={section}>{content}</SettingsLayout>;
}
