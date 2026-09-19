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
}

const STALE_PRICE_DAYS = 30;

export function formatUsd(amount: number): string {
  const digits = amount < 0.01 ? 4 : amount < 1 ? 3 : 2;
  return `$${amount.toFixed(digits)}`;
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
): string {
  switch (unit) {
    case 'second':
      return `${(params.duration_s ?? 0) * params.count} s`;
    case 'character':
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
  now = Date.now(),
}: {
  estimate: CostEstimate | null;
  budgets?: BudgetLine[];
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
  const stale = priceAgeDays(estimate.unit_price.fetched_at, now) > STALE_PRICE_DAYS;
  return { status: stale ? 'stale' : 'ok', blocked: false, amount, authoritative, overBudget: null };
}

export function CostStrip({
  estimate,
  params,
  promptChars,
  budgets = [],
  now = Date.now(),
}: {
  estimate: CostEstimate | null;
  params: { count: number; duration_s?: number | undefined };
  promptChars: number;
  budgets?: BudgetLine[];
  now?: number;
}): React.ReactNode {
  const state = costStripState({ estimate, budgets, now });

  if (!estimate || state.status === 'unpriced') {
    return (
      <span className="cost-strip is-unpriced" data-status="unpriced">
        {message('create.cost.unpriced')}
      </span>
    );
  }

  const amount = state.amount ?? 0;
  const digits = usdFractionDigits(amount);
  const over = state.status === 'over-budget';
  const size = outputSize(estimate.unit_price.unit, params, promptChars);
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
        <AlertTriangle
          className="cost-strip-stale"
          aria-label={message('create.cost.stale')}
          size={13}
          strokeWidth={2}
        />
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
          {message('create.cost.overBudget')
            .replace('{cap}', formatUsd(state.overBudget.cap_usd))
            .replace('{spent}', formatUsd(state.overBudget.spent_usd))}
        </span>
      ) : null}
    </span>
  );
}
