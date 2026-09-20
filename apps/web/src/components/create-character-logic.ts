// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers for the Create Character flow (F-CHR-02), unit-tested
// without a browser.

export type CreatePath = 'photo' | 'library' | 'text' | 'cast';

const HANDLE_RE = /^[a-z0-9_-]{2,32}$/;
const RESERVED = new Set(['all', 'none', 'auto', 'me', 'self', 'element', 'voice', 'character']);

export type HandleValidity = 'empty' | 'invalid' | 'reserved' | 'ok';

// Suggest a handle from a display name: lowercase, spaces to underscores, strip
// anything outside the charset, clamp to 32.
export function suggestHandle(displayName: string): string {
  return displayName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);
}

export function handleValidity(handle: string): HandleValidity {
  const value = handle.trim().toLowerCase().replace(/^@/, '');
  if (!value) return 'empty';
  if (/^v[1-9][0-9]*$/.test(value) || /^image([1-9]|1[0-6])$/.test(value) || RESERVED.has(value)) {
    return 'reserved';
  }
  if (!HANDLE_RE.test(value)) return 'invalid';
  return 'ok';
}

// Whether the Create button may be enabled for a path and its fields. The cast
// builder is never submittable in this milestone.
export function canCreate(input: {
  path: CreatePath;
  displayName: string;
  handleValidity: HandleValidity;
  handleAvailable: boolean;
  textBody?: string;
  anchorAssetId?: string;
  photoCount?: number;
}): boolean {
  if (input.path === 'cast') return false;
  if (!input.displayName.trim()) return false;
  if (input.handleValidity !== 'ok' || !input.handleAvailable) return false;
  if (input.path === 'text') return Boolean(input.textBody && input.textBody.trim());
  if (input.path === 'library') return Boolean(input.anchorAssetId && input.anchorAssetId.trim());
  if (input.path === 'photo') return (input.photoCount ?? 0) > 0;
  return false;
}
