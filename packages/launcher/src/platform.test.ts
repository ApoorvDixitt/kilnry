// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { nodeVersionCheck } from './commands/doctor.js';
import { platformKey } from './platform.js';

describe('launcher environment checks', () => {
  it('maps supported operating-system and architecture pairs', () => {
    expect(platformKey('darwin', 'arm64')).toBe('darwin-arm64');
    expect(platformKey('win32', 'x64')).toBe('win32-x64');
    expect(() => platformKey('freebsd', 'x64')).toThrow(/Docker/);
  });

  it('enforces the Node 22.12 floor and recommends Node 24', () => {
    expect(nodeVersionCheck('22.11.0').status).toBe('fail');
    expect(nodeVersionCheck('24.21.0').status).toBe('pass');
    expect(nodeVersionCheck('26.0.0').status).toBe('warn');
  });
});
