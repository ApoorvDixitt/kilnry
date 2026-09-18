// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import catalogue from '@kilnry/ui/messages/en.json';

export function message(path: string): string {
  let value: unknown = catalogue;
  for (const segment of path.split('.')) {
    if (typeof value !== 'object' || value === null || !(segment in value)) {
      throw new Error(`Missing UI message: ${path}`);
    }
    value = (value as Record<string, unknown>)[segment];
  }
  if (typeof value !== 'string') throw new Error(`UI message is not a string: ${path}`);
  return value;
}
