// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

import { useEffect, useState } from 'react';
import NumberFlow from '@number-flow/react';
import { message } from '../lib/messages';

interface BudgetLine {
  scope: string;
  cap_usd: number;
  spent_usd: number;
}

// PRD-14 writes budget figures with two decimals ("Today $3.10 / $10.00").
const USD = {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;

export function money(amount: number): string {
  return new Intl.NumberFormat('en-US', USD).format(amount);
}

// The fill of the bar: the share of today's cap already spent, never past full.
export function meterRatio(line: Pick<BudgetLine, 'cap_usd' | 'spent_usd'> | undefined): number {
  if (!line || line.cap_usd <= 0) return line && line.spent_usd > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, line.spent_usd / line.cap_usd));
}

// "Today $3.10 / $10.00" (PRD-14:187).
export function todayText(line: Pick<BudgetLine, 'cap_usd' | 'spent_usd'>): string {
  return `${message('shell.budgetToday')} ${money(line.spent_usd)} / ${money(line.cap_usd)}`;
}

// The budget meter in the top bar (F-PRV-04, F-17; D-67 places it there): today's
// spend against the daily cap from /api/budget, refreshed whenever the shell's
// event stream reports a change (refreshKey); hover shows the month.
export function BudgetMeter({ refreshKey = 0 }: { refreshKey?: number }): React.ReactNode {
  const [lines, setLines] = useState<BudgetLine[]>();

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/budget')
      .then((response) => (response.ok ? (response.json() as Promise<{ budgets: BudgetLine[] }>) : null))
      .then((body) => {
        if (!cancelled && body) setLines(body.budgets);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const daily = lines?.find((line) => line.scope === 'daily');
  const monthly = lines?.find((line) => line.scope === 'monthly');
  const title = monthly
    ? message('shell.budgetMonth')
        .replace('{spent}', money(monthly.spent_usd))
        .replace('{cap}', money(monthly.cap_usd))
    : undefined;

  return (
    <div className="budget-meter" data-money="true" title={title}>
      {daily ? (
        <span className="budget-meter-label">
          {/* The rolled figure is decoration; the sentence beside it is what a
              screen reader (and a test) reads, as in the cost strip. */}
          <span aria-hidden="true">
            {message('shell.budgetToday')}{' '}
            <NumberFlow value={daily.spent_usd} format={USD} locales="en-US" respectMotionPreference />
            {` / ${money(daily.cap_usd)}`}
          </span>
          <span className="budget-meter-text visually-hidden">{todayText(daily)}</span>
        </span>
      ) : (
        <span className="budget-meter-label">{lines ? message('shell.budgetNoCap') : ''}</span>
      )}
      <i>
        <b style={{ width: `${Math.round(meterRatio(daily) * 100)}%` }} />
      </i>
    </div>
  );
}
