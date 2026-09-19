'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { message } from '../lib/messages';

export interface ChecklistStatus {
  generate: boolean;
  organise: boolean;
  workflow: boolean;
  mcp: boolean;
  completed: number;
  total: number;
}

const ITEMS: Array<{ key: keyof ChecklistStatus; label: string; href: string }> = [
  { key: 'generate', label: 'onboarding.generate', href: '/create' },
  { key: 'organise', label: 'onboarding.organise', href: '/library' },
  { key: 'workflow', label: 'onboarding.workflow', href: '/workflows' },
  { key: 'mcp', label: 'onboarding.mcp', href: '/settings/mcp' },
];

const DISMISS_KEY = 'kilnry-checklist-dismissed';

// Whether the widget should be hidden: the user dismissed it, or all four items
// are done (it lingers one session then goes; here it hides once complete).
export function checklistHidden(status: ChecklistStatus | null, dismissed: boolean): boolean {
  if (dismissed) return true;
  if (!status) return false;
  return status.completed >= status.total;
}

export function ChecklistWidget(): React.ReactNode {
  const [status, setStatus] = useState<ChecklistStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1');
    void fetch('/api/onboarding/checklist')
      .then((response) => (response.ok ? (response.json() as Promise<{ checklist: ChecklistStatus }>) : null))
      .then((body) => {
        if (body) setStatus(body.checklist);
      })
      .catch(() => setStatus(null));
  }, []);

  if (checklistHidden(status, dismissed) || !status) return null;

  return (
    <div className="getting-started" aria-label={message('onboarding.checklistTitle')}>
      <p>
        {message('onboarding.checklistTitle')} ·{' '}
        {message('onboarding.checklistProgress')
          .replace('{done}', String(status.completed))
          .replace('{total}', String(status.total))}
      </p>
      {ITEMS.map((item) => {
        const done = Boolean(status[item.key]);
        return (
          <a key={item.key} href={item.href} className={done ? 'checklist-item is-done' : 'checklist-item'}>
            <i>{done ? <Check aria-hidden size={12} strokeWidth={2.5} /> : null}</i>
            {message(item.label)}
          </a>
        );
      })}
      <button
        type="button"
        className="checklist-hide"
        onClick={() => {
          window.localStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
      >
        {message('onboarding.hide')}
      </button>
    </div>
  );
}
