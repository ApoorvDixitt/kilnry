// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers for the product-from-URL Element flow (F-ELM-04),
// unit-tested without a browser.

export interface ProductFactsView {
  title?: string;
  description?: string;
  brand?: string;
  price?: string;
  images: string[];
  claims: string[];
  source_url: string;
  fetched_at: string;
}

// Only an https address may be fetched (the server enforces this too).
export function canFetch(url: string): boolean {
  return /^https:\/\/\S+/i.test(url.trim());
}

// Toggle a claim in the ticked set (claims are unticked by default; only ticked
// claims are ever used by a workflow, PRD-08 §A4).
export function toggleClaim(ticked: Set<string>, claim: string): Set<string> {
  const next = new Set(ticked);
  if (next.has(claim)) next.delete(claim);
  else next.add(claim);
  return next;
}

// The approved claims to store: the extracted claims that were ticked, in order.
export function approvedFrom(claims: string[], ticked: Set<string>): string[] {
  return claims.filter((claim) => ticked.has(claim));
}

// A handle suggestion from the product title (lowercase, underscores, clamped).
export function handleFromTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);
}
