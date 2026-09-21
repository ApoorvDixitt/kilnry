// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { ErrorCode } from '../errors.js';
import type { JobStatus, ProviderId } from '../types.js';

export type KilnryEvent =
  | {
      type: 'job.updated';
      job_id: string;
      status: JobStatus;
      step_label?: string;
      progress?: number;
      provider_request_id?: string;
      estimate_usd: number;
      ts: string;
    }
  | {
      type: 'job.completed';
      job_id: string;
      asset_ids: string[];
      paths: string[];
      actual_usd: number;
      duration_ms: number;
      ts: string;
    }
  | {
      type: 'job.failed';
      job_id: string;
      error: { code: ErrorCode; message: string; retryable: boolean; provider?: string };
      ts: string;
    }
  | { type: 'job.moderated'; job_id: string; reason: string; billed: boolean; ts: string }
  | { type: 'library.imported'; asset_id: string; folder: string; ts: string }
  | { type: 'library.reindex.progress'; done: number; total: number; ts: string }
  | {
      type: 'provider.status';
      provider: ProviderId;
      status: 'ok' | 'degraded' | 'error';
      until?: string;
      ts: string;
    }
  | { type: 'runtime.online'; online: boolean; ts: string }
  | {
      type: 'chat.usage';
      session_id: string;
      step_cost_usd: number;
      session_spent_usd: number;
      ts: string;
    };

export interface SequencedEvent {
  id: number;
  event: KilnryEvent;
}

export class EventHub {
  readonly #listeners = new Set<(event: SequencedEvent) => void>();
  readonly #ring: SequencedEvent[] = [];
  #sequence = 0;

  emit(event: KilnryEvent): SequencedEvent {
    const sequenced = { id: ++this.#sequence, event };
    this.#ring.push(sequenced);
    if (this.#ring.length > 500) this.#ring.shift();
    for (const listener of this.#listeners) listener(sequenced);
    return sequenced;
  }

  since(id: number): SequencedEvent[] {
    return this.#ring.filter((event) => event.id > id);
  }

  subscribe(listener: (event: SequencedEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export const eventHub = new EventHub();
