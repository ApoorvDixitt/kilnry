// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers for the export bundle dialog (F-LIB-14), unit-tested
// without a browser.

export interface ExportDialogState {
  format: 'zip' | 'folder';
  include_sidecars: boolean;
  metadata: 'keep' | 'strip' | 'embed_if_missing';
  provenance: 'none' | 'iptc' | 'c2pa' | 'both';
  include_lineage: boolean;
  manifest: boolean;
  rename: boolean;
}

// The dialog's defaults (PRD-06 §15: zip, sidecars on, keep metadata, IPTC
// label, no lineage, manifest on, no rename).
export function defaultExportState(): ExportDialogState {
  return {
    format: 'zip',
    include_sidecars: true,
    metadata: 'keep',
    provenance: 'iptc',
    include_lineage: false,
    manifest: true,
    rename: false,
  };
}

// Whether the C2PA note should be shown (PRD-06 §15).
export function showsC2paNote(provenance: ExportDialogState['provenance']): boolean {
  return provenance === 'c2pa' || provenance === 'both';
}

// Build the request body for the export route from the chosen assets and state.
export function exportRequest(assetIds: string[], state: ExportDialogState): Record<string, unknown> {
  return { asset_ids: assetIds, ...state };
}
