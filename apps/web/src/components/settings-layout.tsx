// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import Link from 'next/link';
import { LockKeyhole, MessagesSquare, Palette, Plug, ServerCog, Settings2, Wallet } from 'lucide-react';
import { message } from '../lib/messages';

const sections = [
  { id: 'providers', icon: ServerCog },
  { id: 'workspace', icon: Settings2 },
  { id: 'budget', icon: Wallet },
  { id: 'chat', icon: MessagesSquare },
  { id: 'security', icon: LockKeyhole },
  { id: 'mcp', icon: Plug },
  { id: 'appearance', icon: Palette },
] as const;

export function SettingsLayout({
  section,
  children,
}: {
  section: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={message('settings.navLabel')}>
        <p>{message('settings.navTitle')}</p>
        {sections.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={`/settings/${item.id}`}
              className={section === item.id ? 'is-active' : ''}
            >
              <Icon size={17} />
              {message(`settings.nav.${item.id}`)}
            </Link>
          );
        })}
        <small>{message('settings.m2Scope')}</small>
      </nav>
      <main>{children}</main>
    </div>
  );
}
