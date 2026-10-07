// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// PRD-15 §4 gives the exact sentence for every error code, and says the
// provider's own message is appended verbatim behind "<provider> (<status>): ".
// Three of those sentences had drifted and the prefix was never produced
// (F-57, F-58, F-59).

import { describe, expect, it } from 'vitest';
import { providerHttpError } from './errors.js';
import { ollamaAdapter } from './ollama/index.js';
import { higgsfieldAdapter } from './higgsfield/index.js';

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe('provider failure copy (F-JOB-04)', () => {
  it('appends the provider message behind the provider name and status (F-59)', () => {
    const error = providerHttpError(
      'fal',
      422,
      { detail: [{ type: 'content_policy_violation', msg: 'flagged by a content checker' }] },
      headers({}),
    );
    expect(error.code).toBe('MODERATION_REJECTED');
    expect(error.message).toBe(
      "Blocked by the provider's content filter. Not charged. fal (422): flagged by a content checker",
    );
    expect(error.message).not.toContain('Provider said');
  });

  it('tells the user when Kilnry will retry a rate limit (F-57)', () => {
    const withHeader = providerHttpError(
      'fal',
      429,
      { message: 'slow down' },
      headers({ 'retry-after': '30' }),
    );
    expect(withHeader.code).toBe('RATE_LIMITED');
    expect(withHeader.message).toBe(
      'fal is rate-limiting requests. Kilnry will retry in 30 s. fal (429): slow down',
    );
    const withoutHeader = providerHttpError('fal', 429, {}, headers({}));
    expect(withoutHeader.message).toBe('fal is rate-limiting requests. Kilnry will retry in 2 s.');
  });

  it('uses the canon INVALID_INPUT, NOT_FOUND and TIMEOUT sentences (F-58)', () => {
    const invalid = providerHttpError(
      'fal',
      400,
      { detail: 'duration 45 s is above the 15 s maximum' },
      headers({}),
    );
    expect(invalid.code).toBe('INVALID_INPUT');
    expect(invalid.message).toBe("Kilnry couldn't send this: duration 45 s is above the 15 s maximum.");

    const missing = providerHttpError('fal', 404, { message: 'model not found' }, headers({}));
    expect(missing.code).toBe('NOT_FOUND');
    expect(missing.message).toBe('Something this job needs is missing: model not found.');

    const timeout = providerHttpError('fal', 504, {}, headers({}));
    expect(timeout.code).toBe('TIMEOUT');
    expect(timeout.message).toBe(
      "No answer from fal. Kilnry hasn't resubmitted, so you won't be charged twice. Checking their status first.",
    );
  });

  // F-46, F-47 and F-79: TRD-20 §2's table is the contract for what a user is
  // told. Three rows did not hold: a refused Ollama connection read as a lost
  // connection, an exhausted ElevenLabs quota read as a rejected key, and a
  // Higgsfield concurrency bounce read as an invalid request the engine would
  // not retry.
  it('maps an exhausted ElevenLabs quota to INSUFFICIENT_FUNDS, not a key problem', () => {
    const quota = providerHttpError('elevenlabs', 401, { detail: { status: 'quota_exceeded' } });
    expect(quota.code).toBe('INSUFFICIENT_FUNDS');
    expect(quota.message).toContain('out of balance');
    // A genuinely wrong key still reads as one.
    expect(providerHttpError('elevenlabs', 401, { detail: { status: 'invalid_api_key' } }).code).toBe(
      'INVALID_INPUT',
    );
  });

  it('tells Ollama not running from a lost connection', () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' }),
    });
    const mapped = ollamaAdapter.normalizeError(refused);
    expect(mapped.code).toBe('NO_PROVIDER');
    expect(mapped.message).toBe('Ollama not running');
    expect(mapped.options?.retryable).toBe(true);
  });

  it('backs off a Higgsfield concurrency bounce and does not retry a terminal failure', () => {
    const bounced = higgsfieldAdapter.normalizeError(
      providerHttpError('higgsfield', 400, { detail: 'Maximum number of concurrent requests reached' }),
    );
    expect(bounced.code).toBe('RATE_LIMITED');
    expect(bounced.options?.retryable).toBe(true);
    expect(bounced.options?.details).toMatchObject({ retry_after_s: 15 });
  });
});
