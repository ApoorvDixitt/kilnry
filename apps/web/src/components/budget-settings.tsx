'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

interface BudgetLine {
  scope: string;
  cap_usd: number;
  spent_usd: number;
  behavior: string;
}

export function BudgetSettings(): React.ReactNode {
  const [daily, setDaily] = useState('');
  const [monthly, setMonthly] = useState('');
  const [behavior, setBehavior] = useState<'block' | 'ask'>('block');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch('/api/budget')
      .then((response) => (response.ok ? (response.json() as Promise<{ budgets: BudgetLine[] }>) : null))
      .then((body) => {
        if (!body) return;
        const d = body.budgets.find((line) => line.scope === 'daily');
        const m = body.budgets.find((line) => line.scope === 'monthly');
        if (d) {
          setDaily(String(d.cap_usd));
          setBehavior(d.behavior === 'ask' ? 'ask' : 'block');
        }
        if (m) setMonthly(String(m.cap_usd));
      })
      .catch(() => setStatus(message('settings.budget.saveFailed')));
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setStatus('');
    try {
      for (const [scope, value] of [
        ['daily', daily],
        ['monthly', monthly],
      ] as const) {
        const cap = value.trim() === '' ? null : Number(value);
        const response = await apiFetch('/api/budget', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope, cap_usd: cap, behavior }),
        });
        if (!response.ok) throw new Error(message('settings.budget.saveFailed'));
      }
      setStatus(message('settings.budget.saved'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : message('settings.budget.saveFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="settings-content budget-settings" onSubmit={(event) => void save(event)}>
      <header className="settings-heading">
        <p>{message('settings.budget.eyebrow')}</p>
        <h2>{message('settings.budget.title')}</h2>
        <span>{message('settings.budget.subtitle')}</span>
      </header>

      <label className="budget-field">
        <span>{message('settings.budget.dailyCap')}</span>
        <div className="budget-input">
          <span aria-hidden>$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={daily}
            placeholder={message('settings.budget.capPlaceholder')}
            onChange={(event) => setDaily(event.target.value)}
          />
        </div>
      </label>

      <label className="budget-field">
        <span>{message('settings.budget.monthlyCap')}</span>
        <div className="budget-input">
          <span aria-hidden>$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={monthly}
            placeholder={message('settings.budget.capPlaceholder')}
            onChange={(event) => setMonthly(event.target.value)}
          />
        </div>
      </label>

      <label className="budget-field">
        <span>{message('settings.budget.behavior')}</span>
        <select value={behavior} onChange={(event) => setBehavior(event.target.value as 'block' | 'ask')}>
          <option value="block">{message('settings.budget.behaviorBlock')}</option>
          <option value="ask">{message('settings.budget.behaviorAsk')}</option>
        </select>
      </label>

      <div className="budget-actions">
        <button type="submit" className="budget-save" disabled={pending}>
          {message('settings.budget.save')}
        </button>
        <p className="budget-status" role="status" aria-live="polite">
          {status}
        </p>
      </div>

      <section className="budget-stale-policy" aria-label={message('settings.budget.staleTitle')}>
        <h3>{message('settings.budget.staleTitle')}</h3>
        <p>{message('settings.budget.staleBody')}</p>
      </section>
    </form>
  );
}
