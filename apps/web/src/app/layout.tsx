// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { loadConfig } from '@kilnry/core';
import { AppProviders } from '../components/app-providers';
import { message } from '../lib/messages';
import './globals.css';

export const metadata: Metadata = {
  title: { default: message('brand.name'), template: `%s · ${message('brand.name')}` },
  description: message('brand.tagline'),
};

function appearanceScript(fallback: { theme: string; density: string; reduced_motion: string }): string {
  return `(() => { try { const f=${JSON.stringify(fallback)}; const t=localStorage.getItem('kilnry-theme')||f.theme; const d=localStorage.getItem('kilnry-density')||f.density; const m=localStorage.getItem('kilnry-motion')||f.reduced_motion; const dark=matchMedia('(prefers-color-scheme: dark)').matches; const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches; const r=document.documentElement; r.dataset.themeSetting=t; r.dataset.theme=t==='system'?(dark?'dark':'light'):t; r.dataset.density=d; r.dataset.motion=m==='system'?(reduced?'reduced':'full'):(m==='reduce'?'reduced':'full'); localStorage.setItem('kilnry-theme',t); localStorage.setItem('kilnry-density',d); localStorage.setItem('kilnry-motion',m); } catch { document.documentElement.dataset.theme='light'; document.documentElement.dataset.density='comfortable'; document.documentElement.dataset.motion='full'; document.documentElement.dataset.appearanceError='storage'; } })();`;
}

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): Promise<React.ReactNode> {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const config = loadConfig();
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: appearanceScript({
              theme: config.theme,
              density: config.density,
              reduced_motion: config.reduced_motion,
            }),
          }}
        />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
