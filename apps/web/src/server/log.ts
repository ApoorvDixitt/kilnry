// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { join } from 'node:path';
import pino from 'pino';
import { defaultDataDir, ensureDataDir } from '@kilnry/core/config';
import { redact, redactString } from '@kilnry/core/security/redact';

const dataDir = defaultDataDir();
const building = process.env.NEXT_PHASE === 'phase-production-build';
if (!building) ensureDataDir(dataDir);

export const log = building
  ? pino({ enabled: false })
  : pino(
      {
        level: process.env.KILNRY_LOG ?? 'info',
        base: { app: 'kilnry', pid: process.pid, version: process.env.npm_package_version ?? '0.0.0' },
        timestamp: pino.stdTimeFunctions.isoTime,
        redact: {
          censor: '[redacted]',
          paths: [
            '*.authorization',
            '*.cookie',
            '*.api_key',
            '*.apiKey',
            '*.key',
            '*.secret',
            '*.token',
            '*.password',
          ],
        },
        hooks: {
          logMethod(arguments_, method) {
            const safe = arguments_.map((value) =>
              typeof value === 'string' ? redactString(value) : redact(value),
            );
            method.apply(this, safe as [object: unknown, message?: string, ...arguments_: unknown[]]);
          },
        },
      },
      pino.destination({ dest: join(dataDir, 'logs', 'kilnry.log'), mkdir: true, sync: false }),
    );
