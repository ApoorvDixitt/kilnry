'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { message } from '../lib/messages';

type ProviderId = 'fal' | 'openrouter' | 'pollinations';
interface ProviderSummary {
  id: string;
  display_name: string;
  connected: boolean;
  status: 'ok' | 'degraded' | 'error' | 'not_connected';
  key_prefix?: string;
  model_count: number;
  spend_month_usd: number;
  last_error?: string;
}

interface ApiError {
  error?: { message?: string };
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(body.error?.message ?? message('settings.providers.requestFailed'));
  return body;
}

function detect(value: string): ProviderId | undefined {
  if (/^sk-or-v1-/i.test(value)) return 'openrouter';
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}:[0-9a-f]{32}$/i.test(value)) return 'fal';
  if (/^sk_/i.test(value)) return 'pollinations';
  return undefined;
}

export function ProviderSettings({
  initialProviders,
}: {
  initialProviders?: ProviderSummary[];
} = {}): React.ReactNode {
  const [providers, setProviders] = useState<ProviderSummary[]>(initialProviders ?? []);
  const [key, setKey] = useState('');
  const [provider, setProvider] = useState<ProviderId>('fal');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [recoveryKit, setRecoveryKit] = useState<string>();

  const load = useCallback(async () => {
    const response = await fetch('/api/providers');
    const body = await responseJson<{ providers: ProviderSummary[] }>(response);
    setProviders(body.providers.filter((item) => ['fal', 'openrouter', 'pollinations'].includes(item.id)));
  }, []);

  useEffect(() => {
    if (initialProviders) return;
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : message('settings.providers.requestFailed')),
    );
  }, [initialProviders, load]);

  const detected = useMemo(() => detect(key), [key]);

  async function connect(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    setPending(true);
    try {
      const selected = detected ?? provider;
      const response = await fetch(`/api/providers/${selected}/key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const body = await responseJson<{
        recovery_kit?: string;
        test: { latency_ms?: number; model_count?: number };
      }>(response);
      setRecoveryKit(body.recovery_kit);
      setNotice(
        message('settings.providers.connected')
          .replace('{latency}', String(body.test.latency_ms ?? 0))
          .replace('{count}', String(body.test.model_count ?? 0)),
      );
      setKey('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.providers.requestFailed'));
    } finally {
      setPending(false);
    }
  }

  async function test(id: string): Promise<void> {
    setError(undefined);
    setNotice(undefined);
    setPending(true);
    try {
      const body = await responseJson<{ ok: boolean; latency_ms?: number }>(
        await fetch(`/api/providers/${id}/test`, { method: 'POST' }),
      );
      if (!body.ok) throw new Error(message('settings.providers.testFailed'));
      setNotice(message('settings.providers.testPassed').replace('{latency}', String(body.latency_ms ?? 0)));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.providers.requestFailed'));
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setError(undefined);
    setPending(true);
    try {
      await responseJson(await fetch(`/api/providers/${id}/key`, { method: 'DELETE' }));
      setNotice(message('settings.providers.removed'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.providers.requestFailed'));
    } finally {
      setPending(false);
    }
  }

  async function refreshPrices(id: string): Promise<void> {
    setError(undefined);
    setPending(true);
    try {
      const body = await responseJson<{ models: number }>(
        await fetch('/api/models/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: id }),
        }),
      );
      setNotice(message('settings.providers.pricesRefreshed').replace('{count}', String(body.models)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.providers.requestFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="settings-content">
      <header className="settings-heading">
        <p>{message('settings.providers.eyebrow')}</p>
        <h2>{message('settings.providers.title')}</h2>
        <span>{message('settings.providers.subtitle')}</span>
      </header>
      <form className="provider-connect" onSubmit={(event) => void connect(event)}>
        <div className="provider-connect-icon" aria-hidden="true">
          <KeyRound size={19} />
        </div>
        <label htmlFor="provider-key">{message('settings.providers.keyLabel')}</label>
        <div className="provider-key-row">
          <input
            id="provider-key"
            type="password"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              const found = detect(event.target.value);
              if (found) setProvider(found);
            }}
            placeholder={message('settings.providers.keyPlaceholder')}
            autoComplete="off"
          />
          <select
            aria-label={message('settings.providers.providerLabel')}
            value={detected ?? provider}
            onChange={(event) => setProvider(event.target.value as ProviderId)}
          >
            <option value="fal">fal</option>
            <option value="openrouter">OpenRouter</option>
            <option value="pollinations">Pollinations</option>
          </select>
          <button className="settings-primary" type="submit" disabled={pending || key.length < 8}>
            {pending ? message('settings.providers.testing') : message('settings.providers.testAndSave')}
          </button>
        </div>
        <small>
          {detected
            ? message('settings.providers.detected').replace('{provider}', detected)
            : message('settings.providers.encryptionHelp')}
        </small>
      </form>
      <div className="inline-feedback" aria-live="polite">
        {error ? <p className="form-error">{error}</p> : null}
        {notice ? (
          <p className="form-success">
            <Check size={15} />
            {notice}
          </p>
        ) : null}
      </div>
      <AnimatePresence>
        {recoveryKit ? (
          <motion.section
            className="recovery-inline"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <h3>{message('settings.security.kitSaveTitle')}</h3>
            <p>{message('settings.security.kitSaveBody')}</p>
            <code>{recoveryKit}</code>
            <button type="button" onClick={() => setRecoveryKit(undefined)}>
              {message('settings.security.kitStored')}
            </button>
          </motion.section>
        ) : null}
      </AnimatePresence>
      <div className="provider-grid">
        {providers.map((item) => (
          <section className="provider-card" key={item.id}>
            <header>
              <div>
                <span className="provider-monogram" aria-hidden="true">
                  {item.display_name.slice(0, 1)}
                </span>
                <div>
                  <h3>{item.display_name}</h3>
                  <p>{message(`settings.providers.${item.id}Help`)}</p>
                </div>
              </div>
              <span className={`provider-status is-${item.status}`}>
                <i />
                {message(`settings.providers.status.${item.status}`)}
              </span>
            </header>
            <dl>
              <div>
                <dt>{message('settings.providers.models')}</dt>
                <dd>{item.model_count}</dd>
              </div>
              <div>
                <dt>{message('settings.providers.monthSpend')}</dt>
                <dd data-money="true">${item.spend_month_usd.toFixed(2)}</dd>
              </div>
              <div>
                <dt>{message('settings.providers.key')}</dt>
                <dd>{item.key_prefix ?? message('settings.providers.none')}</dd>
              </div>
            </dl>
            {item.last_error ? <p className="provider-error">{item.last_error}</p> : null}
            <footer>
              <button type="button" disabled={!item.connected || pending} onClick={() => void test(item.id)}>
                <RefreshCw size={15} />
                {message('settings.providers.test')}
              </button>
              <button
                type="button"
                disabled={!item.connected || pending}
                onClick={() => void refreshPrices(item.id)}
              >
                <RefreshCw size={15} />
                {message('settings.providers.refreshPrices')}
              </button>
              <button
                className="danger-text"
                type="button"
                disabled={!item.connected || pending}
                onClick={() => void remove(item.id)}
              >
                <Trash2 size={15} />
                {message('settings.providers.remove')}
              </button>
            </footer>
          </section>
        ))}
      </div>
    </div>
  );
}
