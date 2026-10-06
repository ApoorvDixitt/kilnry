'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The view-once recovery kit and its acknowledgement: one checkbox and Done
// (D-63). The transcription quiz this card used to run proved only that the user
// could read two groups off the screen, cost most of onboarding's 60-second input
// budget, and blocked the step'"'"'s primary button until it was passed (F-14, UX-01).

import { useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

export function RecoveryProof({
  recoveryKit,
  onConfirmed,
}: {
  recoveryKit: string;
  onConfirmed: () => void;
}): React.ReactNode {
  const [stored, setStored] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const response = await apiFetch('/api/security/key-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'acknowledge', stored: true }),
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
      <div className="recovery-proof-fields">
        <label className="recovery-stored">
          <input type="checkbox" checked={stored} onChange={(event) => setStored(event.target.checked)} />
          {message('settings.security.kitStored')}
        </label>
        <button type="button" disabled={pending || !stored} onClick={() => void confirm()}>
          {message('settings.security.kitDone')}
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
