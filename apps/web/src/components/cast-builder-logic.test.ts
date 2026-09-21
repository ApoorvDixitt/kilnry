// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import {
  AGE_RANGES,
  canGenerate,
  canSaveAfterPick,
  defaultCastForm,
  mentionsMinor,
} from './cast-builder-logic';

describe('cast builder logic (F-CHR-15)', () => {
  it('never offers a minor age range', () => {
    expect(AGE_RANGES).toEqual(['18-24', '25-34', '35-44', '45-54', '55+']);
  });

  it('detects a minor named in free text', () => {
    expect(mentionsMinor('a 15 year old')).toBe(true);
    expect(mentionsMinor('looks about 30')).toBe(false);
    expect(mentionsMinor('')).toBe(false);
  });

  it('blocks Generate when a free-text field names a minor', () => {
    const form = defaultCastForm();
    expect(canGenerate(form, false)).toBe(true);
    expect(canGenerate({ ...form, region: 'a 16yo' }, false)).toBe(false);
    expect(canGenerate({ ...form, setting_hint: 'a 12 year old party' }, false)).toBe(false);
    expect(canGenerate(form, true)).toBe(false);
  });

  it('requires an anchor pick before save', () => {
    expect(canSaveAfterPick(undefined)).toBe(false);
    expect(canSaveAfterPick('asset-1')).toBe(true);
  });
});
