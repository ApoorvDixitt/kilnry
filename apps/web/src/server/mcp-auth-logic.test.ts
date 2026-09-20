// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { mayMutate } from './mcp-auth-logic';

describe('mayMutate (F-MCP-05)', () => {
  it('lets a session mutate', () => {
    expect(mayMutate({ via: 'session' })).toBe(true);
  });

  it('lets a full bearer mutate', () => {
    expect(mayMutate({ via: 'bearer', scope: 'full' })).toBe(true);
  });

  it('refuses a read-only bearer', () => {
    expect(mayMutate({ via: 'bearer', scope: 'read_only' })).toBe(false);
  });
});
