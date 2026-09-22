// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Pricing a call before it runs (F-CHT-03, TRD-11 §5). The approval card has to
// show the real cost, so the policy prices a pending call with the same engine
// estimate the tool itself will use — not a second pricing path that could
// disagree with it. A generate call may carry several requests; each is priced
// and the total is what the card shows, with one line per request so the user
// sees what makes up the number.

import { capabilityFor, type Kind } from '@kilnry/core';
import type { PreEstimate } from './approval.js';

/** The estimate the engine returns, narrowed to what the card needs. */
export interface EngineEstimate {
  estimate: {
    estimate_usd: number;
    authoritative_usd?: number;
    route: { provider: string; model: string };
    eta_s?: number;
    budget?: { would_exceed?: boolean };
  };
}

/** The engine's estimate call, passed in so this stays testable. */
export type EngineEstimator = (request: unknown, constraints: unknown) => Promise<EngineEstimate>;

/** One planned call, as the approval card lists it. */
export interface PlannedCall {
  kind: string;
  model: string;
  count: number;
  estimate_usd: number;
}

export interface ChatPreEstimate extends PreEstimate {
  calls: PlannedCall[];
}

/**
 * Build the pre-estimate function the approval policy calls. Returns the total
 * for the pending call, whether it would pass a budget cap, and the per-request
 * lines the approval card shows.
 */
export function enginePreEstimate(estimate: EngineEstimator) {
  return async (name: string, input: Record<string, unknown>): Promise<ChatPreEstimate> => {
    const requests = pendingRequests(name, input);
    if (requests.length === 0) return { estimate_usd: 0, calls: [] };

    const calls: PlannedCall[] = [];
    let total = 0;
    let wouldExceed = false;

    for (const request of requests) {
      try {
        const priced = await estimate(
          {
            kind: request.kind,
            capability: capabilityFor(request.kind as Kind, []),
            prompt: request.prompt,
            params: request.params,
            medias: [],
            count: request.count,
            injections: [],
          },
          request.model === 'auto' ? {} : { pinned_model: request.model },
        );
        const usd = priced.estimate.authoritative_usd ?? priced.estimate.estimate_usd;
        total += usd;
        if (priced.estimate.budget?.would_exceed === true) wouldExceed = true;
        calls.push({
          kind: request.kind,
          model: priced.estimate.route.model,
          count: request.count,
          estimate_usd: usd,
        });
      } catch {
        // A request that cannot be priced is shown without a number rather than
        // with a guess; the tool will report the real error when it runs.
        calls.push({ kind: request.kind, model: request.model, count: request.count, estimate_usd: 0 });
      }
    }

    return { estimate_usd: round4(total), would_exceed_caps: wouldExceed, calls };
  };
}

interface PendingRequest {
  kind: string;
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  count: number;
}

/** The requests a pending tool call would submit, in the shape pricing needs. */
export function pendingRequests(name: string, input: Record<string, unknown>): PendingRequest[] {
  if (name === 'kilnry_generate') {
    const requests = Array.isArray(input['requests']) ? input['requests'] : [];
    return requests.map((entry) => one(entry as Record<string, unknown>));
  }
  if (name === 'kilnry_transform') {
    return [
      {
        kind: typeof input['op'] === 'string' ? input['op'] : 'transform',
        model: typeof input['model'] === 'string' ? input['model'] : 'auto',
        prompt: '',
        params: asRecord(input['params']),
        count: 1,
      },
    ];
  }
  return [];
}

function one(entry: Record<string, unknown>): PendingRequest {
  return {
    kind: typeof entry['kind'] === 'string' ? entry['kind'] : 'image',
    model: typeof entry['model'] === 'string' ? entry['model'] : 'auto',
    prompt: typeof entry['prompt'] === 'string' ? entry['prompt'] : '',
    params: asRecord(entry['params']),
    count: typeof entry['count'] === 'number' ? entry['count'] : 1,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
