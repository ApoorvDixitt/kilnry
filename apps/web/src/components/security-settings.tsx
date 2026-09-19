'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { message } from '../lib/messages';

interface KeyStatus {
  initialized: boolean;
  locked: boolean;
  source?: 'keychain' | 'env' | 'file' | 'machine';
  weaker_machine_key: boolean;
  fingerprint?: string;
}

export function SecuritySettings(): React.ReactNode {
  const [status, setStatus] = useState<KeyStatus>();
  const [password, setPassword] = useState('');
  const [kit, setKit] = useState<string>();
  const [restore, setRestore] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch('/api/security/key-store')
      .then(async (response) => {
        const body = (await response.json()) as { status?: KeyStatus; error?: { message?: string } };
        if (!response.ok || !body.status)
          throw new Error(body.error?.message ?? message('settings.security.loadFailed'));
        setStatus(body.status);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : message('settings.security.loadFailed')),
      );
  }, []);

  async function action(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch('/api/security/key-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const value = (await response.json()) as Record<string, unknown> & { error?: { message?: string } };
      if (!response.ok) throw new Error(value.error?.message ?? message('settings.security.loadFailed'));
      return value;
    } finally {
      setPending(false);
    }
  }

  async function viewKit(): Promise<void> {
    try {
      const value = await action({ action: 'view', password });
      if (typeof value.recovery_kit !== 'string') throw new Error(message('settings.security.loadFailed'));
      setKit(value.recovery_kit);
      setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.security.loadFailed'));
    }
  }

  async function restoreKit(): Promise<void> {
    try {
      const value = await action({ action: 'restore', recovery_kit: restore });
      if (typeof value.status === 'object' && value.status !== null) setStatus(value.status as KeyStatus);
      setRestore('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.security.loadFailed'));
    }
  }

  return (
    <div className="settings-content">
      <header className="settings-heading">
        <p>{message('settings.security.eyebrow')}</p>
        <h2>{message('settings.security.title')}</h2>
        <span>{message('settings.security.subtitle')}</span>
      </header>
      <section className="security-card">
        <ShieldCheck size={22} />
        <div>
          <h3>{message('settings.security.encryptionTitle')}</h3>
          <p>
            {message('settings.security.encryptionBody').replace(
              '{source}',
              status?.source
                ? message(`settings.security.source.${status.source}`)
                : message('settings.security.source.pending'),
            )}
          </p>
          {status?.weaker_machine_key ? <small>{message('settings.security.machineWarning')}</small> : null}
        </div>
      </section>
      {status?.locked ? (
        <section className="security-card is-warning">
          <KeyRound size={22} />
          <div>
            <h3>{message('settings.security.lockedTitle')}</h3>
            <p>{message('settings.security.lockedBody')}</p>
            <textarea
              aria-label={message('settings.security.restoreLabel')}
              value={restore}
              onChange={(event) => setRestore(event.target.value)}
            />
            <button type="button" disabled={pending || restore.length < 20} onClick={() => void restoreKit()}>
              {message('settings.security.restore')}
            </button>
          </div>
        </section>
      ) : (
        <section className="recovery-card">
          <h3>{message('settings.security.kitTitle')}</h3>
          <p>{message('settings.security.kitIntro')}</p>
          {kit ? (
            <>
              <code>{kit}</code>
              <button
                type="button"
                onClick={() => {
                  void action({ action: 'acknowledge' })
                    .then(() => setKit(undefined))
                    .catch((cause: unknown) =>
                      setError(
                        cause instanceof Error ? cause.message : message('settings.security.loadFailed'),
                      ),
                    );
                }}
              >
                {message('settings.security.kitStored')}
              </button>
            </>
          ) : (
            <div className="password-confirm-row">
              <input
                type="password"
                aria-label={message('settings.security.passwordLabel')}
                placeholder={message('settings.security.passwordPlaceholder')}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button type="button" disabled={pending || !password} onClick={() => void viewKit()}>
                {message('settings.security.viewKit')}
              </button>
            </div>
          )}
        </section>
      )}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
