// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { confirmationDecision } from './confirmation.js';

describe('confirmationDecision (F-MCP-06)', () => {
  it('lets a free request proceed', () => {
    expect(confirmationDecision({ estimateUsd: 0 })).toEqual({ proceed: true, reason: 'free' });
  });

  it('needs confirmation when no cost is acknowledged', () => {
    expect(confirmationDecision({ estimateUsd: 0.5 })).toEqual({
      proceed: false,
      reason: 'needs_confirmation',
    });
  });

  it('proceeds when the acknowledged cost is within ten percent of the estimate', () => {
    expect(confirmationDecision({ estimateUsd: 1, confirmCostUsd: 0.95 })).toEqual({
      proceed: true,
      reason: 'confirmed',
    });
    // Below the ninety-percent floor still needs confirmation.
    expect(confirmationDecision({ estimateUsd: 1, confirmCostUsd: 0.5 }).proceed).toBe(false);
  });

  it('auto-approves an estimate at or below the threshold', () => {
    expect(confirmationDecision({ estimateUsd: 0.02, autoApproveBelowUsd: 0.1 })).toEqual({
      proceed: true,
      reason: 'auto_approved',
    });
    // Above the threshold still needs confirmation.
    expect(confirmationDecision({ estimateUsd: 0.5, autoApproveBelowUsd: 0.1 }).proceed).toBe(false);
  });
});
