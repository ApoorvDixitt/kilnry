// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { monotonicFactory } from 'ulidx';
import { KilnryError } from './errors.js';

const createUlid = monotonicFactory();

export function ulid(): string {
  return createUlid();
}

export function parseUlid(value: string, label = 'id'): string {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)) {
    throw new KilnryError('INVALID_INPUT', `Invalid ${label}.`);
  }
  return value;
}
