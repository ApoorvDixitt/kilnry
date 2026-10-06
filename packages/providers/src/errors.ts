// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { KilnryError, markNetworkOffline, redactString, type ProviderId } from '@kilnry/core';

interface ProviderBody {
  error?: { code?: string | number; message?: string; metadata?: Record<string, unknown> };
  detail?: unknown;
  message?: string;
  msg?: string;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (typeof entry === 'object' && entry !== null && 'msg' in entry && typeof entry.msg === 'string')
          return entry.msg;
        return undefined;
      })
      .filter(Boolean)
      .join('; ');
  }
  return undefined;
}

function excerpt(body: ProviderBody | undefined): string | undefined {
  const value = body?.error?.message ?? text(body?.detail) ?? body?.message ?? body?.msg;
  return value ? redactString(value).slice(0, 200) : undefined;
}

/**
 * Kilnry's sentence, then the provider's own message verbatim behind the canon
 * prefix "<provider> (<status>): " (PRD-15:104, F-59). It used to read
 * `Provider said: "…"`, which carried neither the provider's name nor the status
 * the user needs to look the failure up.
 */
function message(sentence: string, providerText?: string, origin?: string): string {
  if (!providerText) return sentence;
  return origin ? `${sentence} ${origin}: ${providerText}` : `${sentence} ${providerText}`;
}

export function providerHttpError(
  provider: ProviderId,
  status: number,
  body: unknown,
  headers?: Headers,
): KilnryError {
  const value = typeof body === 'object' && body !== null ? (body as ProviderBody) : undefined;
  const providerText = excerpt(value);
  const origin = `${provider} (${status})`;
  const retryAfter = Number(headers?.get('retry-after') ?? 0) || undefined;
  const detailArray = Array.isArray(value?.detail) ? value.detail : [];
  const falModerated = detailArray.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      'type' in entry &&
      entry.type === 'content_policy_violation',
  );
  const metadata = value?.error?.metadata;
  const openRouterModerated =
    status === 403 && Boolean(metadata && ('reasons' in metadata || 'patterns' in metadata));
  const openaiModerated = value?.error?.code === 'moderation_blocked';
  const details = {
    http_status: status,
    billed: falModerated ? 'maybe' : 'no',
    ...(retryAfter === undefined ? {} : { retry_after_s: retryAfter }),
  };

  if (falModerated || openRouterModerated || openaiModerated) {
    return new KilnryError(
      'MODERATION_REJECTED',
      message("Blocked by the provider's content filter. Not charged.", providerText, origin),
      {
        provider,
        provider_code: falModerated
          ? 'content_policy_violation'
          : openaiModerated
            ? 'moderation_blocked'
            : 'moderation',
        retryable: false,
        details,
      },
    );
  }
  const insufficientFunds =
    status === 402 || (status === 403 && /(?:balance|credit|funds|billing)/i.test(providerText ?? ''));
  if (insufficientFunds) {
    return new KilnryError(
      'INSUFFICIENT_FUNDS',
      message(`${provider} says your account is out of balance. Top up, then retry.`, providerText, origin),
      {
        provider,
        provider_code: String(value?.error?.code ?? status),
        retryable: false,
        details,
      },
    );
  }
  if (status === 401 || status === 403) {
    return new KilnryError(
      'INVALID_INPUT',
      message(`${provider} rejected that key (${status}).`, providerText, origin),
      {
        provider,
        provider_code: String(value?.error?.code ?? status),
        retryable: false,
        details,
      },
    );
  }
  if (status === 404) {
    return new KilnryError(
      'NOT_FOUND',
      // PRD-15:109's wording (F-58).
      message(`Something this job needs is missing: ${providerText ?? 'the model or job'}.`, undefined),
      {
        provider,
        provider_code: '404',
        retryable: false,
        details,
      },
    );
  }
  if (status === 408 || status === 504 || status === 524) {
    return new KilnryError(
      'TIMEOUT',
      // PRD-15:116's wording (F-58). The elapsed minutes are the caller's to
      // fill when it knows them; the sentence is otherwise verbatim.
      message(
        `No answer from ${provider}. Kilnry hasn't resubmitted, so you won't be charged twice. Checking their status first.`,
        providerText,
        origin,
      ),
      {
        provider,
        provider_code: String(status),
        retryable: true,
        details,
      },
    );
  }
  if (status === 429) {
    // PRD-15:113 includes the retry timing (F-57): the Retry-After seconds when
    // the provider sent one, else the first step of the engine's own schedule.
    return new KilnryError(
      'RATE_LIMITED',
      message(
        `${provider} is rate-limiting requests. Kilnry will retry in ${retryAfter ?? 2} s.`,
        providerText,
        origin,
      ),
      {
        provider,
        provider_code: String(status),
        retryable: true,
        details,
      },
    );
  }
  if (status >= 500) {
    return new KilnryError(
      'PROVIDER_ERROR',
      message(
        `${provider} returned an error. Not charged unless their message says otherwise.`,
        providerText,
        origin,
      ),
      {
        provider,
        provider_code: String(status),
        retryable: true,
        details,
      },
    );
  }
  return new KilnryError(
    'INVALID_INPUT',
    // PRD-15:108's wording (F-58).
    message(`Kilnry couldn't send this: ${providerText ?? `${provider} rejected the request`}.`, undefined),
    {
      provider,
      provider_code: String(value?.error?.code ?? status),
      retryable: false,
      details,
    },
  );
}

export function providerNetworkError(
  provider: ProviderId,
  error: unknown,
  ambiguousSubmit: boolean,
): KilnryError {
  // A provider request that never reached the network marks the process offline,
  // so chat drops its spend tools until a later request succeeds (F40).
  markNetworkOffline();
  const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
  const aborted = error instanceof DOMException && error.name === 'AbortError';
  const reason = timedOut || aborted ? 'timed out' : 'lost the connection';
  return new KilnryError(
    'TIMEOUT',
    `Kilnry ${reason} while contacting ${provider}. Kilnry has not resubmitted, so the request will not be sent twice automatically.`,
    {
      provider,
      provider_code: ambiguousSubmit ? 'ambiguous_submit' : 'network',
      retryable: true,
      details: { ambiguous_submit: ambiguousSubmit, billed: ambiguousSubmit ? 'maybe' : 'no' },
      cause: error,
    },
  );
}
