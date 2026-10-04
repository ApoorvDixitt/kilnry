// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// fal is a queue provider. A submit returns { request_id, status_url,
// response_url }; the result is read from response_url only after the status
// turns COMPLETED (https://docs.fal.ai/model-apis/model-endpoints/queue —
// "Submit a Request" and "Check Status"). The engine's adapter already does
// this (packages/providers/src/fal/index.ts submit/poll); voice design and
// clone run outside the job engine, so they share this small helper rather than
// reading a voice id straight off the submit response (which fal never returns).

import { KilnryError } from '../errors.js';

const FAL_BASE = 'https://queue.fal.run';
const POLL_BUDGET_MS = 120_000;
const POLL_INTERVAL_MS = 2000;

export interface FalQueueResult {
  output: Record<string, unknown>;
  request_id: string;
}

interface FalSubmit {
  request_id?: string;
  status_url?: string;
  response_url?: string;
}

interface FalStatus {
  status?: string;
  error?: string;
}

// Thrown when fal accepts a request but does not reach COMPLETED within the
// budget. The caller records a ledger row at the estimate so the spend fal will
// bill is never invisible, naming this request id (voice-{design,clone}.ts).
export class FalQueueTimeout extends Error {
  constructor(public readonly request_id: string) {
    super(`fal did not finish within ${POLL_BUDGET_MS / 1000}s (request ${request_id}).`);
    this.name = 'FalQueueTimeout';
  }
}

async function falFetch(
  fetchImpl: typeof fetch,
  url: string,
  key: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}`, ...(init?.headers ?? {}) },
  });
  if (!response.ok)
    throw new KilnryError('PROVIDER_ERROR', `fal returned ${response.status}.`, {
      provider: 'fal',
      retryable: response.status >= 500,
    });
  return response.json();
}

// Submit to fal's queue, poll status to COMPLETED, and return the output body.
export async function submitAndPollFalQueue(
  fetchImpl: typeof fetch,
  model: string,
  key: string,
  input: Record<string, unknown>,
  options: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    budgetMs?: number;
    intervalMs?: number;
  } = {},
): Promise<FalQueueResult> {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const budgetMs = options.budgetMs ?? POLL_BUDGET_MS;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;

  const submit = (await falFetch(fetchImpl, `${FAL_BASE}/${model}`, key, {
    method: 'POST',
    body: JSON.stringify(input),
  })) as FalSubmit;
  if (!submit.request_id)
    throw new KilnryError('PROVIDER_ERROR', 'fal accepted the request without a request id.', {
      provider: 'fal',
      retryable: true,
    });
  const requestId = submit.request_id;
  const statusUrl = submit.status_url ?? `${FAL_BASE}/${model}/requests/${requestId}/status`;
  const responseUrl = submit.response_url ?? `${FAL_BASE}/${model}/requests/${requestId}`;

  const deadline = now() + budgetMs;
  for (;;) {
    const status = (await falFetch(
      fetchImpl,
      `${statusUrl}${statusUrl.includes('?') ? '&' : '?'}logs=1`,
      key,
    )) as FalStatus;
    const state = status.status?.toUpperCase();
    if (state === 'COMPLETED') break;
    if (state === 'FAILED' || status.error)
      throw new KilnryError(
        'PROVIDER_ERROR',
        `fal returned an error. ${status.error ?? 'The request failed.'}`,
        {
          provider: 'fal',
          retryable: false,
        },
      );
    if (now() >= deadline) throw new FalQueueTimeout(requestId);
    await sleep(intervalMs);
  }

  const output = (await falFetch(fetchImpl, responseUrl, key)) as Record<string, unknown>;
  return { output, request_id: requestId };
}
