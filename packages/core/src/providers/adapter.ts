// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { KilnryError } from '../errors.js';
import type { ModelManifest, PriceSnapshot } from '../registry/manifest.js';
import type { CanonicalRequest, Estimate, ProviderId } from '../types.js';

export interface KeyDetection {
  pattern: RegExp;
  confidence: 'high' | 'ambiguous';
  mask: (key: string) => string;
}

export interface ProviderOutput {
  kind: 'image' | 'video' | 'audio' | '3d' | 'text' | 'json';
  url?: string;
  bytes?: Uint8Array;
  base64?: string;
  mime?: string;
  width?: number;
  height?: number;
  duration_s?: number;
  seed?: number;
  expires_at?: string;
  text?: string;
  json?: unknown;
}

export interface ProviderResult {
  outputs: ProviderOutput[];
  billing?: {
    actual_usd?: number;
    usage?: Record<string, number>;
    currency_note?: string;
    source: string;
  };
  raw_redacted?: unknown;
}

export interface SubmitHandle {
  provider: ProviderId;
  model_id: string;
  provider_request_id: string;
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
  submitted_at: string;
  inline_result?: ProviderResult;
  payload_redacted: unknown;
}

export type PollStatus =
  | { state: 'queued'; position?: number; eta_s?: number }
  | { state: 'running'; progress?: number; step_label?: string; logs?: string[] }
  | { state: 'completed'; result: ProviderResult }
  | { state: 'failed'; error: KilnryError }
  | { state: 'moderated'; error: KilnryError; billed: 'no' | 'maybe' | 'yes' }
  | { state: 'cancelled' };

export interface AdapterContext {
  key: string;
  fetch: typeof fetch;
  signal: AbortSignal;
  price?: PriceSnapshot;
  log: (level: 'debug' | 'info' | 'warn', event: string, meta?: Record<string, unknown>) => void;
}

export interface ProviderPriceUpdate {
  model_id: string;
  price_rule: ModelManifest['price_rule'];
  source_url: string;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly display_name: string;
  readonly base_url: string;
  readonly key_detection: KeyDetection | null;
  readonly concurrency: { default: number; max_known: number | null; hold_until_terminal?: boolean };
  readonly retention_days: number | null;
  readonly training_on_inputs: boolean;
  readonly supports_authoritative_estimate: boolean;
  readonly idempotency: 'key' | 'none';
  testKey(
    key: string,
    options?: { base_url?: string; fetch?: typeof fetch; signal?: AbortSignal },
  ): Promise<
    | { ok: true; latency_ms: number; balance_usd?: number; account?: string; model_count?: number }
    | { ok: false; error: KilnryError }
  >;
  listModels(
    key?: string,
    options?: { fetch?: typeof fetch; signal?: AbortSignal },
  ): Promise<ModelManifest[]>;
  refreshPrices?(
    key: string,
    options?: { fetch?: typeof fetch; signal?: AbortSignal },
  ): Promise<ProviderPriceUpdate[]>;
  authoritativeEstimate?(
    request: CanonicalRequest,
    estimate: Estimate,
    context: AdapterContext,
  ): Promise<number>;
  submit(request: CanonicalRequest, context: AdapterContext): Promise<SubmitHandle>;
  poll(handle: SubmitHandle, context: AdapterContext): Promise<PollStatus>;
  cancel(handle: SubmitHandle, context: AdapterContext): Promise<{ ok: boolean; reason?: string }>;
  download(
    result: ProviderResult,
    context: AdapterContext,
  ): Promise<Array<{ index: number; bytes: Uint8Array; mime: string; sha256: string }>>;
  normalizeError(error: unknown): KilnryError;
}

export type AdapterRegistry = Readonly<Partial<Record<ProviderId, ProviderAdapter>>>;
