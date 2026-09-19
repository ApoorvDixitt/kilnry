// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { NextConfig } from 'next';

const config: NextConfig = {
  devIndicators: false,
  output: 'standalone',
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  outputFileTracingIncludes: {
    '/*': ['../../packages/db/migrations/**/*', '../../packages/ui/messages/**/*'],
  },
  serverExternalPackages: [
    '@electric-sql/pglite',
    '@napi-rs/keyring',
    'chokidar',
    'pg-boss',
    'pino',
    'pino-roll',
    'sharp',
  ],
  transpilePackages: ['@kilnry/core', '@kilnry/db', '@kilnry/media', '@kilnry/providers', '@kilnry/ui'],
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3123', '127.0.0.1:3123'],
    },
  },
};

export default config;
