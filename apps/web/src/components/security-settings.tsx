'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

interface KeyStatus {
  initialized: boolean;
  locked: boolean;
  source?: 'keychain' | 'env' | 'file' | 'machine';
  weaker_machine_key: boolean;
  fingerprint?: string;
}

interface RecoveryConfirmation {
  challenge_token: string;
  group_numbers: number[];
}

interface NetworkStatus {
  configured: boolean;
  active: boolean;
  restart_required: boolean;
}

interface SessionSummary {
  id: string;
  created_at: string;
  expires_at: string;
  ip_address?: string | null;
  user_agent?: string | null;
  current: boolean;
}

export function SecuritySettings(): React.ReactNode {
  const [status, setStatus] = useState<KeyStatus>();
  const [password, setPassword] = useState('');
  const [kit, setKit] = useState<string>();
  const [confirmation, setConfirmation] = useState<RecoveryConfirmation>();
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [restore, setRestore] = useState('');
  const [network, setNetwork] = useState<NetworkStatus>();
  const [networkPassword, setNetworkPassword] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetch('/api/security/key-store').then(async (response) => {
        const body = (await response.json()) as { status?: KeyStatus; error?: { message?: string } };
        if (!response.ok || !body.status)
          throw new Error(body.error?.message ?? message('settings.security.loadFailed'));
        setStatus(body.status);
      }),
      fetch('/api/security/network').then(async (response) => {
        const body = (await response.json()) as NetworkStatus & { error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? message('settings.security.loadFailed'));
        setNetwork(body);
      }),
      fetch('/api/security/sessions').then(async (response) => {
        const body = (await response.json()) as {
          sessions?: SessionSummary[];
          error?: { message?: string };
        };
        if (!response.ok || !body.sessions)
          throw new Error(body.error?.message ?? message('settings.security.loadFailed'));
        setSessions(body.sessions);
      }),
    ]).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : message('settings.security.loadFailed')),
    );
  }, []);

  async function action(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    setPending(true);
    setError(undefined);
    try {
      const response = await apiFetch('/api/security/key-store', {
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
      if (
        typeof value.recovery_kit !== 'string' ||
        typeof value.confirmation !== 'object' ||
        value.confirmation === null
      ) {
        throw new Error(message('settings.security.loadFailed'));
      }
      setKit(value.recovery_kit);
      setConfirmation(value.confirmation as unknown as RecoveryConfirmation);
      setAnswers({});
      setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.security.loadFailed'));
    }
  }

  async function confirmKit(): Promise<void> {
    if (!confirmation) return;
    try {
      await action({
        action: 'acknowledge',
        challenge_token: confirmation.challenge_token,
        answers: confirmation.group_numbers.map((group) => ({ group, value: answers[group] ?? '' })),
      });
      setKit(undefined);
      setConfirmation(undefined);
      setAnswers({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.security.loadFailed'));
    }
  }

  async function changeNetwork(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const response = await apiFetch('/api/security/network', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !network?.configured, password: networkPassword }),
      });
      const body = (await response.json()) as NetworkStatus & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? message('settings.security.loadFailed'));
      setNetwork(body);
      setNetworkPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.security.loadFailed'));
    } finally {
      setPending(false);
    }
  }

  async function revokeSession(sessionId: string, current: boolean): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const response = await apiFetch('/api/security/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? message('settings.security.loadFailed'));
      if (current) {
        window.location.assign('/login');
        return;
      }
      setSessions((items) => items.filter((item) => item.id !== sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.security.loadFailed'));
    } finally {
      setPending(false);
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
              {confirmation ? (
                <div className="recovery-confirm">
                  <p>{message('settings.security.confirmGroups')}</p>
                  <div>
                    {confirmation.group_numbers.map((group) => (
                      <label key={group}>
                        {message('settings.security.groupLabel').replace('{group}', String(group))}
                        <input
                          maxLength={4}
                          autoComplete="off"
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
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                disabled={
                  pending ||
                  !confirmation ||
                  confirmation.group_numbers.some((group) => (answers[group]?.length ?? 0) !== 4)
                }
                onClick={() => void confirmKit()}
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
      <section className="security-card security-network">
        <ShieldCheck size={22} />
        <div>
          <h3>{message('settings.security.networkTitle')}</h3>
          <p>
            {message(
              network?.active
                ? 'settings.security.networkActive'
                : network?.configured
                  ? 'settings.security.networkPending'
                  : 'settings.security.networkOff',
            )}
          </p>
          <div className="password-confirm-row">
            <input
              type="password"
              aria-label={message('settings.security.networkPassword')}
              placeholder={message('settings.security.passwordPlaceholder')}
              value={networkPassword}
              onChange={(event) => setNetworkPassword(event.target.value)}
            />
            <button
              type="button"
              disabled={pending || !networkPassword || !network}
              onClick={() => void changeNetwork()}
            >
              {message(
                network?.configured ? 'settings.security.disableNetwork' : 'settings.security.enableNetwork',
              )}
            </button>
          </div>
        </div>
      </section>
      <section className="session-card">
        <h3>{message('settings.security.sessionsTitle')}</h3>
        <p>{message('settings.security.sessionsBody')}</p>
        <div className="session-list">
          {sessions.map((session) => (
            <div key={session.id}>
              <div>
                <strong>
                  {session.current
                    ? message('settings.security.currentSession')
                    : message('settings.security.otherSession')}
                </strong>
                <span>{session.user_agent ?? message('settings.security.unknownDevice')}</span>
                <small>
                  {(session.ip_address ?? message('settings.security.localAddress')) +
                    ` · ${new Date(session.expires_at).toLocaleDateString()}`}
                </small>
              </div>
              <button type="button" onClick={() => void revokeSession(session.id, session.current)}>
                {session.current
                  ? message('settings.security.signOut')
                  : message('settings.security.revokeSession')}
              </button>
            </div>
          ))}
        </div>
      </section>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
