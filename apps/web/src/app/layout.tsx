// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { AppProviders } from '../components/app-providers';
import { message } from '../lib/messages';
import './globals.css';

export const metadata: Metadata = {
  title: { default: message('brand.name'), template: `%s · ${message('brand.name')}` },
  description: message('brand.tagline'),
};

const themeScript = `(() => { try { const saved = localStorage.getItem('kilnry-theme'); const dark = saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; } catch { document.documentElement.dataset.theme = 'light'; } })();`;

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): Promise<React.ReactNode> {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
