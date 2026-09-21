// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Session metering and the session budget cap (F-CHT-02, TRD-11 §9).
//
// The model's own tokens cost money, so they are metered like every other spend:
// each step's usage is priced from the model's registry snapshot, written to the
// spend ledger as an entry of kind "llm", added to the session's running total,
// and announced so the Chat header and the Cost tab can follow along. A local
// model still meters its tokens, at zero.
//
// The session budget is enforced in two places. The approval policy asks before
// a tool spend would pass the cap; here, the token spend itself is checked, and
// when the next step would pass the cap the loop stops with a sentence naming
// the cap so the user can raise it.

import { eventHub, type EventHub } from '@kilnry/core';
import type { LlmPrice, LlmRef } from './model.js';
import { tokensToUsd } from './model.js';

/** What one finished step reports about its token use. */
export interface StepUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
  reasoningTokens?: number | undefined;
}

/** Writes one entry to the spend ledger; supplied by the application. */
export type LedgerWriter = (entry: {
  provider_id: string;
  model_id: string;
  folder?: string;
  kind: 'llm';
  estimate_usd: number;
  actual_usd: number;
  currency_note: string;
}) => Promise<void>;

/** Adds the step's cost to the session's running total; supplied by the app. */
export type SpendRecorder = (sessionId: string, deltaUsd: number) => Promise<void>;

export interface MeterInput {
  session: { id: string; folder?: string; budget_usd?: number; spent_usd: number };
  llm: { ref: LlmRef; price: LlmPrice };
  writeLedger: LedgerWriter;
  recordSpend: SpendRecorder;
  hub?: EventHub;
}

export interface MeteredStep {
  cost_usd: number;
  session_spent_usd: number;
  /** True when the session has now reached or passed its budget. */
  budget_reached: boolean;
}

/** The note that explains how an LLM cost was derived, for the ledger row. */
const CURRENCY_NOTE = 'provider:usage×snapshot';

/**
 * Meter one finished step: price its tokens, write the ledger entry, add it to
 * the session total and announce it (TRD-11 §9). Returns the step's cost and the
 * new session total so the caller can decide whether to continue.
 */
export async function meterStep(input: MeterInput, usage: StepUsage): Promise<MeteredStep> {
  const cost = tokensToUsd(usage, input.llm.price);
  const spent = round6(input.session.spent_usd + cost);

  await input.writeLedger({
    provider_id: input.llm.ref.provider,
    model_id: input.llm.ref.model,
    ...(input.session.folder ? { folder: input.session.folder } : {}),
    kind: 'llm',
    estimate_usd: cost,
    actual_usd: cost,
    currency_note: CURRENCY_NOTE,
  });
  await input.recordSpend(input.session.id, cost);

  (input.hub ?? eventHub).emit({
    type: 'chat.usage',
    session_id: input.session.id,
    step_cost_usd: cost,
    session_spent_usd: spent,
    ts: new Date().toISOString(),
  });

  return {
    cost_usd: cost,
    session_spent_usd: spent,
    budget_reached: typeof input.session.budget_usd === 'number' && spent >= input.session.budget_usd,
  };
}

/**
 * Whether the next step would take the session past its budget. The projection
 * uses the last step's cost, because that is the best estimate of the next one.
 */
export function wouldExceedSessionBudget(
  session: { spent_usd: number; budget_usd?: number },
  projectedStepUsd: number,
): boolean {
  if (typeof session.budget_usd !== 'number') return false;
  return session.spent_usd + projectedStepUsd > session.budget_usd;
}

/**
 * The sentence the assistant ends on when the session budget is reached
 * (TRD-11 §9). It names the cap so the user knows what to raise.
 */
export function sessionBudgetReachedText(budgetUsd: number): string {
  return `Session budget reached ($${budgetUsd.toFixed(2)}). Raise it in the header to continue.`;
}

/** The running totals the Chat header shows (TRD-11 §9). */
export function headerMeter(input: { llm_usd: number; tools_usd: number; budget_usd?: number }): string {
  const money = (usd: number): string => `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
  const session = input.llm_usd + input.tools_usd;
  const cap = typeof input.budget_usd === 'number' ? ` / ${money(input.budget_usd)}` : '';
  return `LLM ${money(input.llm_usd)} · tools ${money(input.tools_usd)} · session ${money(session)}${cap}`;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
