// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { canCreate, handleValidity, suggestHandle } from './create-character-logic';

describe('suggestHandle', () => {
  it('derives a valid handle from a display name', () => {
    expect(suggestHandle('Maya Rao')).toBe('maya_rao');
    expect(suggestHandle('  Chai Glass!  ')).toBe('chai_glass');
  });
});

describe('handleValidity', () => {
  it('accepts valid handles and flags empty, invalid and reserved', () => {
    expect(handleValidity('maya')).toBe('ok');
    expect(handleValidity('@maya')).toBe('ok');
    expect(handleValidity('')).toBe('empty');
    expect(handleValidity('a')).toBe('invalid');
    expect(handleValidity('has space')).toBe('invalid');
    expect(handleValidity('auto')).toBe('reserved');
    expect(handleValidity('v2')).toBe('reserved');
    expect(handleValidity('image3')).toBe('reserved');
  });
});

describe('canCreate', () => {
  const base = {
    displayName: 'Maya',
    handleValidity: 'ok' as const,
    handleAvailable: true,
  };

  it('blocks the cast builder until an anchor is picked, then allows it', () => {
    expect(canCreate({ ...base, path: 'cast' })).toBe(false);
    expect(canCreate({ ...base, path: 'cast', castPickedAssetId: 'asset-1' })).toBe(true);
  });

  it('requires a display name and an available valid handle', () => {
    expect(canCreate({ ...base, path: 'text', displayName: '', textBody: 'x' })).toBe(false);
    expect(canCreate({ ...base, path: 'text', handleAvailable: false, textBody: 'x' })).toBe(false);
    expect(canCreate({ ...base, path: 'text', handleValidity: 'taken' as never, textBody: 'x' })).toBe(false);
  });

  it('needs text for the text path, an asset for the library path, a photo for the photo path', () => {
    expect(canCreate({ ...base, path: 'text', textBody: '' })).toBe(false);
    expect(canCreate({ ...base, path: 'text', textBody: 'a woman' })).toBe(true);
    expect(canCreate({ ...base, path: 'library', anchorAssetId: '' })).toBe(false);
    expect(canCreate({ ...base, path: 'library', anchorAssetId: '01ABC' })).toBe(true);
    expect(canCreate({ ...base, path: 'photo', photoCount: 0 })).toBe(false);
    expect(canCreate({ ...base, path: 'photo', photoCount: 1 })).toBe(true);
  });
});
