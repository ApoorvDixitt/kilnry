// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers and types for the Character detail page (F-CHR-03),
// unit-tested without a browser.

// One step of a reference-sheet run as shown on the detail page (F-CHR-04).
export interface SheetStepView {
  id: string;
  name: string;
  kind: string;
  status?: string;
}

// The reference-sheet run state the detail page tracks.
export interface SheetState {
  steps: SheetStepView[];
  runId: string | null;
  status: string | null;
}

// The response shape from build_sheet / approve_sheet / deny_sheet.
export interface SheetResponse {
  run_id?: string;
  status?: string;
  plan?: { steps: SheetStepView[] };
  run?: { status: string; steps: SheetStepView[] };
}

// Fold a sheet response into the next detail-page state: the run's live steps
// win over the initial plan; the run id is remembered; the status comes from the
// run or the top-level field.
export function sheetView(previous: SheetState, body: SheetResponse | null): SheetState {
  if (!body) return { ...previous, steps: [] };
  const steps = body.run?.steps ?? body.plan?.steps ?? previous.steps;
  return {
    steps,
    runId: body.run_id ?? previous.runId,
    status: body.run?.status ?? body.status ?? previous.status,
  };
}

export interface Reference {
  id: string;
  asset_id: string;
  preview_url: string;
  role: string;
  view?: string;
  label?: string;
}

export interface VersionRowView {
  version: number;
  frozen: boolean;
  current: boolean;
  jobs: number;
}

export interface FullCharacterView {
  handle: string;
  display_name: string;
  version: number;
  versions: VersionRowView[];
  description?: string;
  tags: string[];
  is_real_person: boolean;
  consent: { status: string };
  // PRD-07 §7: the version reads as a minor; Train and Clone are refused.
  minor_suspected?: boolean;
  appearance: { descriptor: string; anchors: string[]; negative_traits: string[] };
  references: Reference[];
  trained_identities: Array<{ id: string; provider: string; kind: string; status: string }>;
  voice?: { provider: string; voice_id: string };
  stats: { usage_count: number; last_used_at?: string; avg_consistency?: number };
}

export interface UsageAsset {
  asset_id: string;
  preview_url: string;
  path: string;
  kind?: string;
  version?: number;
  strategy?: string;
  actual_usd?: number;
}

export interface UsageFilters {
  version: string;
  type: string;
  strategy: string;
}

/**
 * The Usage tab's header line and its filters (PRD-07:580). The tab rendered a
 * thumbnail strip and nothing else, so a Character's own cost report did not
 * exist (F-113).
 */
export function usageSummary(
  assets: UsageAsset[],
  avgConsistency?: number,
): { count: number; spentUsd: number; consistency: 'high' | 'medium' | 'low' | null } {
  const spentUsd =
    Math.round(assets.reduce((sum, asset) => sum + (asset.actual_usd ?? 0), 0) * 1_000_000) / 1_000_000;
  // PRD-07:580 words the average as a band, not a number.
  const consistency =
    avgConsistency === undefined
      ? null
      : avgConsistency >= 0.8
        ? 'high'
        : avgConsistency >= 0.6
          ? 'medium'
          : 'low';
  return { count: assets.length, spentUsd, consistency };
}

export function filterUsage(assets: UsageAsset[], filters: UsageFilters): UsageAsset[] {
  return assets.filter(
    (asset) =>
      (filters.version === 'all' || String(asset.version ?? '') === filters.version) &&
      (filters.type === 'all' || (asset.kind ?? '') === filters.type) &&
      (filters.strategy === 'all' || (asset.strategy ?? '') === filters.strategy),
  );
}

/** The distinct values present, so a filter never offers an empty choice. */
export function usageOptions(assets: UsageAsset[]): {
  versions: string[];
  types: string[];
  strategies: string[];
} {
  const unique = (values: Array<string | undefined>): string[] =>
    [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
  return {
    versions: unique(
      assets.map((asset) => (asset.version === undefined ? undefined : String(asset.version))),
    ),
    types: unique(assets.map((asset) => asset.kind)),
    strategies: unique(assets.map((asset) => asset.strategy)),
  };
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

// The switcher label for one version, e.g. "v2 · current · 4 jobs" or
// "v1 · frozen · 31 jobs" (PRD-07 §11). "job"/"jobs" is pluralised.
export function versionLabel(row: VersionRowView): string {
  const parts = [`v${row.version}`];
  if (row.current) parts.push('current');
  if (row.frozen) parts.push('frozen');
  parts.push(row.jobs === 1 ? '1 job' : `${row.jobs} jobs`);
  return parts.join(' · ');
}
