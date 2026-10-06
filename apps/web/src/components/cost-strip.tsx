'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { message } from '../lib/messages';
import type { ApiEstimate } from '../lib/composer-types';

// The estimate as the /api/estimate route returns it, straight from the core
// engine. Kilnry never computes a price in the interface.
export type CostEstimate = ApiEstimate;

// A cap the generation would draw down. When spending the estimate would pass
// the cap, the strip turns coral and Generate is blocked (F-PRV-04 supplies
// these values; until then the strip simply shows no budget lines).
export interface BudgetLine {
  scope: 'daily' | 'monthly' | 'folder' | 'provider';
  label: string;
  cap_usd: number;
  spent_usd: number;
  behavior?: 'block' | 'ask' | undefined;
  /** When the cap frees up, in the engine's words (F-19). */
  reset?: string | undefined;
  used_percent?: number | undefined;
}

/** The scope word and the reset the over-budget sentence names (F-19). */
export function capScopeLabel(line: BudgetLine): string {
  switch (line.scope) {
    case 'daily':
      return 'Daily';
    case 'monthly':
      return 'Monthly';
    case 'provider':
      return `${line.label} monthly`;
    case 'folder':
      return line.label || 'Folder';
  }
}

export function capReset(line: BudgetLine): string {
  if (line.reset) return line.reset;
  switch (line.scope) {
    case 'daily':
      return 'midnight';
    case 'monthly':
    case 'provider':
      return 'the first of next month';
    case 'folder':
      return 'you raise the cap';
  }
}

export function formatUsd(amount: number): string {
  const digits = amount < 0.01 ? 4 : amount < 1 ? 3 : 2;
  return `$${amount.toFixed(digits)}`;
}

/**
 * Money in a sentence, PRD-14's way: two decimals, so a cap reads "$0.01" and
 * "$10.00" — the cap-stop sentence said "$0.010" (F-19 as amended by A.4).
 */
export function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// How many fraction digits Kilnry shows for a given amount. NumberFlow is given
// the same minimum and maximum so its rolled figure matches formatUsd exactly:
// small amounts keep more precision so a fraction of a cent is never hidden.
export function usdFractionDigits(amount: number): number {
  return amount < 0.01 ? 4 : amount < 1 ? 3 : 2;
}

export function formatEta(seconds: number): string {
  if (seconds < 120) return `~${Math.round(seconds)} s`;
  return `~${Math.round(seconds / 60)} min`;
}

function priceAgeDays(fetchedAt: string, now: number): number {
  return Math.floor((now - new Date(fetchedAt).getTime()) / 86_400_000);
}

// The output size line: images for image models, seconds for video, characters
// for speech. Derived from the price unit so it always matches what is billed.
export function outputSize(
  unit: string,
  params: { count: number; duration_s?: number | undefined },
  promptChars: number,
  billedUnits?: number,
): string {
  switch (unit) {
    // The engine reports the seconds it priced, so before the duration chip is
    // touched the strip shows that default instead of "0 s" (UX-19).
    case 'second':
      return `${(params.duration_s ?? billedUnits ?? 0) * params.count} s`;
    // Speech is billed by the thousand characters, so the size line counts the
    // characters that will be spoken rather than a number of files.
    case 'character':
    case '1k chars':
      return message('create.cost.chars').replace('{n}', String(promptChars));
    case 'minute':
      return `${params.count} min`;
    default:
      return message(params.count === 1 ? 'create.cost.image' : 'create.cost.images').replace(
        '{n}',
        String(params.count),
      );
  }
}

// Decide how the strip should render and whether Generate may proceed. Kept pure
// so the exact behaviour is testable without a browser.
export function costStripState({
  estimate,
  budgets = [],
}: {
  estimate: CostEstimate | null;
  budgets?: BudgetLine[];
  /** Accepted by the callers; the staleness verdict no longer depends on it. */
  now?: number;
}): {
  status: 'unpriced' | 'over-budget' | 'stale' | 'ok';
  blocked: boolean;
  amount: number | null;
  authoritative: boolean;
  overBudget: BudgetLine | null;
} {
  if (!estimate) {
    return { status: 'unpriced', blocked: true, amount: null, authoritative: false, overBudget: null };
  }
  const amount = estimate.authoritative_usd ?? estimate.estimate_usd;
  const authoritative = estimate.authoritative_usd !== undefined;
  const overBudget = budgets.find((line) => line.spent_usd + amount > line.cap_usd + 1e-9) ?? null;
  if (overBudget) {
    return { status: 'over-budget', blocked: true, amount, authoritative, overBudget };
  }
  // The engine decides staleness against the stored settings.price_max_age_days
  // (PRD-14 §8, D-73a) and says so in the estimate's adjustments. The strip had
  // its own hard-coded 30, so with the setting at anything else the user saw a
  // fresh price and the server refused the submit.
  const stale = Array.isArray(estimate.adjustments) && estimate.adjustments.includes('stale_price');
  return { status: stale ? 'stale' : 'ok', blocked: false, amount, authoritative, overBudget: null };
}

export function CostStrip({
  estimate,
  params,
  promptChars,
  budgets = [],
  now = Date.now(),
  promptEmpty = false,
  pricing = false,
  priceError,
  onRefreshPrices,
  onUseStalePrice,
}: {
  estimate: CostEstimate | null;
  params: { count: number; duration_s?: number | undefined };
  promptChars: number;
  budgets?: BudgetLine[];
  now?: number;
  /** No prompt yet, so there is nothing to price (UX-03). */
  promptEmpty?: boolean;
  /** An estimate request is in flight. */
  pricing?: boolean;
  /** The engine's own message when pricing failed. */
  priceError?: string | undefined;
  onRefreshPrices?: (() => void) | undefined;
  onUseStalePrice?: (() => void) | undefined;
}): React.ReactNode {
  const state = costStripState({ estimate, budgets, now });

  // Three no-estimate states, each saying what is true (UX-03): the strip used
  // to blame stale prices and send the user to Settings whenever there was no
  // estimate — including before they had typed anything.
  if (!estimate || state.status === 'unpriced') {
    const text = promptEmpty
      ? message('create.cost.noPrompt')
      : pricing
        ? message('create.cost.pricing')
        : (priceError ?? message('create.cost.unpriced'));
    return (
      <span className="cost-strip is-unpriced" data-status="unpriced">
        {text}
      </span>
    );
  }

  const amount = state.amount ?? 0;
  const digits = usdFractionDigits(amount);
  const over = state.status === 'over-budget';
  const size = outputSize(estimate.unit_price.unit, params, promptChars, estimate.billed_units);
  const ageDays = priceAgeDays(estimate.unit_price.fetched_at, now);

  const tooltipLines = [
    ...estimate.breakdown.map((line) => `${line.label}: ${formatUsd(line.usd)}`),
    state.authoritative
      ? message('create.cost.providerEstimate').replace('{amount}', formatUsd(amount))
      : message('create.cost.formulaEstimate').replace('{amount}', formatUsd(amount)),
    message('create.cost.priceAge').replace('{days}', String(ageDays)),
    ...budgets.map((line) =>
      message('create.cost.budgetLine')
        .replace('{label}', line.label)
        .replace('{spent}', formatUsd(line.spent_usd))
        .replace('{cap}', formatUsd(line.cap_usd)),
    ),
  ];

  return (
    <span
      className={`cost-strip${state.status === 'over-budget' ? ' is-over-budget' : ''}`}
      data-status={state.status}
      data-money="true"
      title={tooltipLines.join('\n')}
    >
      {state.status === 'stale' ? (
        <>
          <AlertTriangle
            className="cost-strip-stale"
            aria-label={message('create.cost.stale')}
            size={13}
            strokeWidth={2}
          />
          {/* PRD-14 §8 as amended by D-71a: name the model and the age, offer the
              refresh, and let the user acknowledge this one estimate. */}
          <span className="cost-strip-stale-text" data-testid="cost-strip-stale">
            {message('create.cost.staleDetail')
              .replace('{model}', estimate.route.model)
              .replace('{days}', String(ageDays))}
          </span>
          {onRefreshPrices ? (
            <button type="button" className="cost-strip-refresh" onClick={onRefreshPrices}>
              {message('create.cost.refreshToContinue')}
            </button>
          ) : null}
          {onUseStalePrice ? (
            <button type="button" className="cost-strip-use-stale" onClick={onUseStalePrice}>
              {message('create.cost.useAnyway')}
            </button>
          ) : null}
        </>
      ) : null}
      <motion.span
        className="cost-strip-figure"
        data-over={over ? 'true' : 'false'}
        animate={over ? 'over' : 'ok'}
        variants={{
          ok: { color: 'var(--accent-text)' },
          over: { color: 'var(--danger)', scale: [1, 1.04, 1] },
        }}
        transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
      >
        <span className="cost-strip-figure-roll" aria-hidden="true">
          <NumberFlow
            value={amount}
            prefix={state.authoritative ? '' : '≈ '}
            format={{
              style: 'currency',
              currency: 'USD',
              minimumFractionDigits: digits,
              maximumFractionDigits: digits,
            }}
            trend={0}
            spinTiming={{ duration: 300, easing: 'cubic-bezier(.32,.72,0,1)' }}
            transformTiming={{ duration: 200, easing: 'cubic-bezier(.25,1,.5,1)' }}
            respectMotionPreference
          />
        </span>
        <span className="cost-strip-figure-text visually-hidden" aria-live="polite">
          {`${state.authoritative ? '' : '≈ '}${formatUsd(amount)}`}
        </span>
      </motion.span>
      <span className="cost-strip-sep">·</span>
      <span className="cost-strip-size">{size}</span>
      <span className="cost-strip-sep">·</span>
      <span className="cost-strip-eta">{formatEta(estimate.eta_s)}</span>
      {state.overBudget ? (
        <span className="cost-strip-block">
          {/* The scope and the reset vary (PRD-05:191, F-19): a monthly cap does
              not reset at midnight and a folder cap resets when it is raised. */}
          {message('create.cost.overBudget')
            .replace('{scope}', capScopeLabel(state.overBudget))
            .replace('{cap}', money(state.overBudget.cap_usd))
            .replace('{spent}', money(state.overBudget.spent_usd))
            .replace('{reset}', capReset(state.overBudget))}
        </span>
      ) : null}
    </span>
  );
}
