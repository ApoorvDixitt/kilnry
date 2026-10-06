// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { toolSpendUsd } from './session-spend.js';

describe('what a tool call adds to the session spend (F-104)', () => {
  it('counts the confirmed estimate of the jobs a generate call started', () => {
    expect(toolSpendUsd('kilnry_generate', { jobs: [], total_estimate_usd: 1.26 })).toBe(1.26);
    expect(
      toolSpendUsd('kilnry_transform', { jobs: [{ job_id: 'j', status: 'queued', estimate_usd: 0.04 }] }),
    ).toBe(0.04);
  });

  it('prefers the settled actual when the tool reports one', () => {
    expect(toolSpendUsd('kilnry_analyze', { text: 'ok', estimate_usd: 0.05, actual_usd: 0.004 })).toBe(0.004);
  });

  it('adds nothing for a confirmation request, an error, or a free tool', () => {
    expect(toolSpendUsd('kilnry_analyze', { needs_confirmation: true, estimate_usd: 0.05 })).toBe(0);
    expect(toolSpendUsd('kilnry_generate', { error: { code: 'BUDGET_EXCEEDED' } })).toBe(0);
    expect(toolSpendUsd('kilnry_estimate', { estimate_usd: 1.26 })).toBe(0);
    expect(toolSpendUsd('kilnry_generate', undefined)).toBe(0);
  });
});
