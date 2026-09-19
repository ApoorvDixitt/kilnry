// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { KilnryError, type ProviderId } from '@kilnry/core';
import { providerHttpError, providerNetworkError } from './errors.js';

export interface JsonRequestOptions {
  provider: ProviderId;
  fetch: typeof fetch;
  url: string;
  init?: RequestInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  ambiguousOnNetworkError?: boolean;
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (response.ok) {
      throw new KilnryError('PROVIDER_ERROR', 'The provider returned malformed JSON.', {
        retryable: true,
        details: { http_status: response.status },
        cause: error,
      });
    }
    return { message: text.slice(0, 200) };
  }
}

export async function requestJson<T>(options: JsonRequestOptions): Promise<T> {
  let response: Response;
  try {
    response = await options.fetch(options.url, {
      ...options.init,
      signal: combinedSignal(options.signal, options.timeoutMs ?? 30_000),
    });
  } catch (error) {
    throw providerNetworkError(options.provider, error, options.ambiguousOnNetworkError ?? false);
  }
  const body = await responseBody(response);
  if (!response.ok) throw providerHttpError(options.provider, response.status, body, response.headers);
  return body as T;
}

export async function requestBytes(
  options: JsonRequestOptions,
): Promise<{ bytes: Uint8Array; mime: string }> {
  let response: Response;
  try {
    response = await options.fetch(options.url, {
      ...options.init,
      signal: combinedSignal(options.signal, options.timeoutMs ?? 120_000),
    });
  } catch (error) {
    throw providerNetworkError(options.provider, error, false);
  }
  if (!response.ok) {
    const body = await responseBody(response);
    throw providerHttpError(options.provider, response.status, body, response.headers);
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mime: response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream',
  };
}
