// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWorkflow } from './parse.js';
import { checkInputConstraints, inputConstraints } from './constraints.js';

const adMultiplier = parseWorkflow(
  readFileSync(join(import.meta.dirname, '..', 'catalogue', 'kilnry-ad-multiplier.yaml'), 'utf8'),
);

// D-59 / TRD-12 §2: the Ad Multiplier's 4–30 s rule is an intake refusal. The
// planner probes the source (free) and fails the plan with INVALID_INPUT and the
// input's named reason; a source inside the window plans. No approval card.
describe('duration_s intake constraint (D-59, W10)', () => {
  it('the Ad Multiplier declares 4–30 s on its source and has no approval used as a refusal', () => {
    expect(inputConstraints(adMultiplier)).toEqual([{ name: 'source', duration_s: { min: 4, max: 30 } }]);
    expect(adMultiplier.steps.some((step) => step.id === 'duration_gate')).toBe(false);
  });

  it('a 2 s and a 40 s source fail the plan with the named reason before anything else', async () => {
    const probe = (seconds: number) => async () => seconds;
    await expect(
      checkInputConstraints(adMultiplier, { source: 'asset-short', n: 2 }, probe(2)),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'source is 2 s; this workflow takes 4–30 s.',
      options: { details: { input: 'source', duration_s: 2, min: 4, max: 30 } },
    });
    await expect(
      checkInputConstraints(adMultiplier, { source: 'asset-long', n: 2 }, probe(40.04)),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'source is 40 s; this workflow takes 4–30 s.',
    });
  });

  it('a 5 s source plans, and an unprobeable value is not a refusal', async () => {
    await expect(
      checkInputConstraints(adMultiplier, { source: 'asset-ok', n: 2 }, async () => 5),
    ).resolves.toBeUndefined();
    await expect(
      checkInputConstraints(adMultiplier, { source: 'https://x/y.mp4', n: 2 }, async () => undefined),
    ).resolves.toBeUndefined();
    const probed: string[] = [];
    await checkInputConstraints(adMultiplier, { source: '', n: 2 }, async (value) => {
      probed.push(value);
      return 1;
    });
    expect(probed).toEqual([]);
  });
});
