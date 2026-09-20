// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers and types for the Character detail page (F-CHR-03),
// unit-tested without a browser.

export interface Reference {
  id: string;
  asset_id: string;
  preview_url: string;
  role: string;
  view?: string;
  label?: string;
}

export interface FullCharacterView {
  handle: string;
  display_name: string;
  version: number;
  versions: number[];
  description?: string;
  tags: string[];
  is_real_person: boolean;
  consent: { status: string };
  appearance: { descriptor: string; anchors: string[]; negative_traits: string[] };
  references: Reference[];
  trained_identities: Array<{ id: string; provider: string; kind: string; status: string }>;
  voice?: { provider: string; voice_id: string };
  stats: { usage_count: number };
}

export interface UsageAsset {
  asset_id: string;
  preview_url: string;
  path: string;
}

// Partition references into the reference-sheet sections (F-CHR-03 §5.2).
export function partitionReferences(refs: Reference[]): {
  anchorAndTurnaround: Reference[];
  expressions: Reference[];
  outfits: Reference[];
} {
  return {
    anchorAndTurnaround: refs.filter((r) => r.role === 'anchor' || r.role === 'turnaround'),
    expressions: refs.filter((r) => r.role === 'expression'),
    outfits: refs.filter((r) => r.role === 'outfit' || r.role === 'state'),
  };
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Whether the consent banner should read as satisfied for the detail header.
export function consentSatisfiedView(view: Pick<FullCharacterView, 'is_real_person' | 'consent'>): boolean {
  if (!view.is_real_person) return true;
  return view.consent.status === 'self' || view.consent.status === 'written';
}
