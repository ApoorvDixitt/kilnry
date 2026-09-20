// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free voice list helpers for the Voices tab (F-VOI-01), unit-tested
// without a browser.

export interface VoiceRow {
  provider: string;
  voice_id: string;
  name: string;
  language: string;
  gender: string;
  tags: string[];
  is_clone: boolean;
  price_label: string;
  preview_url?: string;
}

// The providers offered in the filter, in the order the reference lists them.
export const VOICE_FILTER_PROVIDERS = ['elevenlabs', 'minimax', 'openai', 'google', 'kokoro'];

// Client-side filter for the loaded voice rows (the route also filters; this keeps
// the table responsive as the provider dropdown changes).
export function filterVoiceRows(rows: VoiceRow[], provider: string, language: string): VoiceRow[] {
  return rows.filter((row) => {
    if (provider && row.provider !== provider) return false;
    if (language && !row.language.toLowerCase().startsWith(language.toLowerCase())) return false;
    return true;
  });
}
