// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { defaultExportState, exportRequest, showsC2paNote } from './export-bundle-logic';

describe('export bundle dialog logic (F-LIB-14)', () => {
  it('defaults to a zip with sidecars, kept metadata, an IPTC label and a manifest', () => {
    expect(defaultExportState()).toEqual({
      format: 'zip',
      include_sidecars: true,
      metadata: 'keep',
      provenance: 'iptc',
      include_lineage: false,
      manifest: true,
      rename: false,
    });
  });

  it('shows the C2PA note only when a C2PA label is chosen', () => {
    expect(showsC2paNote('none')).toBe(false);
    expect(showsC2paNote('iptc')).toBe(false);
    expect(showsC2paNote('c2pa')).toBe(true);
    expect(showsC2paNote('both')).toBe(true);
  });

  it('builds the request body from the chosen assets and options', () => {
    const body = exportRequest(['a1', 'a2'], defaultExportState());
    expect(body.asset_ids).toEqual(['a1', 'a2']);
    expect(body.format).toBe('zip');
    expect(body.provenance).toBe('iptc');
  });
});
