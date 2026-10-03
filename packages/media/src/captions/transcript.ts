// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Kilnry transcript a speech-to-text step writes and burn_captions reads
// (TRD-09 §4.1), and the cue builder that turns its words into caption lines
// (§4.2). Pure and unit-tested; no ffmpeg, no provider.

import * as z from 'zod';

export const TranscriptWordSchema = z.object({
  w: z.string(),
  start: z.number(),
  end: z.number(),
  conf: z.number().optional(),
});

export const TranscriptSchema = z.object({
  kilnry_transcript: z.literal(1),
  language: z.string(),
  duration_s: z.number(),
  source: z.enum(['whisper_cpp', 'elevenlabs', 'openai', 'fal', 'openrouter', 'google', 'minimax']),
  words: z.array(TranscriptWordSchema),
  segments: z.array(z.object({ text: z.string(), start: z.number(), end: z.number() })).optional(),
  // Exact script lines when the caller supplied them (Faceless workflow); the
  // displayed spelling is taken from these.
  authored: z.array(z.string()).optional(),
});
export type Transcript = z.infer<typeof TranscriptSchema>;
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface CueOptions {
  maxWords?: number;
  maxChars?: number;
  caps?: boolean;
}

const SENTENCE_END = /[.?!…]$/;
const GAP = 0.6;

// Walk the words into cues (TRD-09 §4.2): a cue closes when the next word would
// exceed max_words or max_chars, after a gap of 0.6 s, or at sentence
// punctuation. A cue starts 0.05 s before its first word and ends 0.15 s after
// its last; while speech continues it holds until the next word starts.
export function buildCues(words: TranscriptWord[], options: CueOptions = {}): Cue[] {
  const maxWords = options.maxWords ?? 5;
  const maxChars = options.maxChars ?? 32;
  const cues: Cue[] = [];
  let current: TranscriptWord[] = [];
  const flush = (nextStart: number | undefined): void => {
    if (current.length === 0) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    const text = current.map((word) => word.w).join(' ');
    const start = Math.max(0, first.start - 0.05);
    const gapAfter = nextStart === undefined ? Infinity : nextStart - last.end;
    const end = gapAfter < GAP && nextStart !== undefined ? nextStart - 0.01 : last.end + 0.15;
    cues.push({ start, end, text: options.caps ? text.toUpperCase() : text });
    current = [];
  };
  words.forEach((word, index) => {
    const next = words[index + 1];
    const prospective = [...current, word];
    const chars = prospective.map((w) => w.w).join(' ').length;
    if (current.length > 0 && (prospective.length > maxWords || chars > maxChars)) {
      flush(word.start);
    }
    current.push(word);
    const gapToNext = next ? next.start - word.end : Infinity;
    if (SENTENCE_END.test(word.w) || gapToNext >= GAP || next === undefined) {
      flush(next?.start);
    }
  });
  flush(undefined);
  return cues;
}

// Words aligned to authored lines keep the authored spelling (TRD-09 §4.2.4):
// the authored tokens, in order, replace the recognised ones one for one when
// the counts match.
export function applyAuthored(words: TranscriptWord[], authored: string[]): TranscriptWord[] {
  const tokens = authored.join(' ').split(/\s+/).filter(Boolean);
  if (tokens.length !== words.length) return words;
  return words.map((word, index) => ({ ...word, w: tokens[index]! }));
}
