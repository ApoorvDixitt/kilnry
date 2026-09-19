'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

export interface RecoveryConfirmation {
  challenge_token: string;
  group_numbers: number[];
}

export function RecoveryProof({
  recoveryKit,
  confirmation,
  onConfirmed,
}: {
  recoveryKit: string;
  confirmation: RecoveryConfirmation;
  onConfirmed: () => void;
}): React.ReactNode {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const response = await apiFetch('/api/security/key-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'acknowledge',
          challenge_token: confirmation.challenge_token,
          answers: confirmation.group_numbers.map((group) => ({ group, value: answers[group] ?? '' })),
        }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? message('settings.security.loadFailed'));
      onConfirmed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.security.loadFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="recovery-proof">
      <strong>{message('settings.security.kitSaveTitle')}</strong>
      <p>{message('settings.security.kitSaveBody')}</p>
      <code>{recoveryKit}</code>
      <p>{message('settings.security.confirmGroups')}</p>
      <div className="recovery-proof-fields">
        {confirmation.group_numbers.map((group) => (
          <label key={group}>
            {message('settings.security.groupLabel').replace('{group}', String(group))}
            <input
              maxLength={4}
              value={answers[group] ?? ''}
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [group]: event.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''),
                }))
              }
            />
          </label>
        ))}
        <button
          type="button"
          disabled={
            pending || confirmation.group_numbers.some((group) => (answers[group]?.length ?? 0) !== 4)
          }
          onClick={() => void confirm()}
        >
          {message('settings.security.kitStored')}
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
