'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { detectProviderKey } from '@kilnry/core/security/key-detection';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import { RecoveryProof, type RecoveryConfirmation } from './recovery-proof';

type ProviderId = 'fal' | 'openrouter' | 'pollinations' | 'higgsfield';
interface ProviderSummary {
  id: string;
  display_name: string;
  connected: boolean;
  status: 'ok' | 'degraded' | 'error' | 'not_connected';
  key_prefix?: string;
  model_count: number;
  spend_month_usd: number;
  last_error?: string;
  monthly_cap_usd?: number;
  max_concurrency?: number;
  price_fetched_at?: string;
  price_stale?: boolean;
}

interface ApiError {
  error?: { message?: string };
}

interface OllamaModel {
  name: string;
  size_bytes: number | null;
  parameter_size: string | null;
  context_length: number | null;
  tools: boolean;
  vision: boolean;
}

interface OllamaDetection {
  detected: boolean;
  base_url: string;
  models: OllamaModel[];
  error?: string;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(body.error?.message ?? message('settings.providers.requestFailed'));
  return body;
}

function detect(value: string): ProviderId | undefined {
  const candidates = detectProviderKey(value);
  if (candidates.length !== 1) return undefined;
  const provider = candidates[0]?.provider;
  return provider === 'fal' ||
    provider === 'openrouter' ||
    provider === 'pollinations' ||
    provider === 'higgsfield'
    ? provider
    : undefined;
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
  const [recoveryConfirmation, setRecoveryConfirmation] = useState<RecoveryConfirmation>();
  const [caps, setCaps] = useState<Record<string, string>>({});
  const [concurrency, setConcurrency] = useState<Record<string, string>>({});
  const [ollama, setOllama] = useState<OllamaDetection>();
  const [higgsfieldAccepted, setHiggsfieldAccepted] = useState(false);

  // Probe the local Ollama runtime on open and every sixty seconds while the
  // Providers page is visible (F-PRV-08). The probe is loopback-only; a missing
  // Ollama resolves to detected:false and never surfaces as an error here.
  useEffect(() => {
    let active = true;
    const probe = async (): Promise<void> => {
      try {
        const response = await fetch('/api/providers/ollama/detect');
        const body = (await response.json()) as OllamaDetection;
        if (active) setOllama(body);
      } catch {
        if (active) setOllama({ detected: false, base_url: 'http://127.0.0.1:11434', models: [] });
      }
    };
    void probe();
    const timer = setInterval(() => void probe(), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

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
  const ambiguous = useMemo(() => detectProviderKey(key).length > 1, [key]);

  async function connect(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    setPending(true);
    try {
      const selected = detected ?? provider;
      const response = await apiFetch(`/api/providers/${selected}/key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, ...(selected === 'higgsfield' ? { accept_tos: true } : {}) }),
      });
      const body = await responseJson<{
        recovery_kit?: string;
        confirmation?: RecoveryConfirmation;
        test: { latency_ms?: number; model_count?: number };
      }>(response);
      setRecoveryKit(body.recovery_kit);
      setRecoveryConfirmation(body.confirmation);
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
        await apiFetch(`/api/providers/${id}/test`, { method: 'POST' }),
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
      await responseJson(await apiFetch(`/api/providers/${id}/key`, { method: 'DELETE' }));
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
        await apiFetch('/api/models/refresh', {
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

  async function saveControls(item: ProviderSummary): Promise<void> {
    setError(undefined);
    setPending(true);
    try {
      const cap = caps[item.id] ?? (item.monthly_cap_usd === undefined ? '' : String(item.monthly_cap_usd));
      const maximum = Number(concurrency[item.id] ?? item.max_concurrency ?? 1);
      await responseJson(
        await apiFetch(`/api/providers/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            monthly_cap_usd: cap.trim() ? Number(cap) : null,
            max_concurrency: maximum,
          }),
        }),
      );
      setNotice(message('settings.providers.controlsSaved'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('settings.providers.requestFailed'));
    } finally {
      setPending(false);
    }
  }

  async function resumeProvider(id: string): Promise<void> {
    setError(undefined);
    setPending(true);
    try {
      await responseJson(
        await apiFetch(`/api/providers/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resume: true }),
        }),
      );
      setNotice(message('settings.providers.resumed'));
      await load();
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
            <option value="higgsfield">Higgsfield</option>
          </select>
          <button
            className="settings-primary"
            type="submit"
            disabled={
              pending || key.length < 8 || ((detected ?? provider) === 'higgsfield' && !higgsfieldAccepted)
            }
          >
            {pending ? message('settings.providers.testing') : message('settings.providers.testAndSave')}
          </button>
        </div>
        {(detected ?? provider) === 'higgsfield' ? (
          <section
            className="provider-notice"
            aria-label={message('settings.providers.higgsfieldNoticeTitle')}
          >
            <h4>{message('settings.providers.higgsfieldNoticeTitle')}</h4>
            <p>{message('settings.providers.higgsfieldNoticeBody')}</p>
            <p>{message('settings.providers.higgsfieldNoticeRouting')}</p>
            <p>{message('settings.providers.higgsfieldNoticeRetention')}</p>
            <a
              href={message('settings.providers.higgsfieldNoticeSource')}
              target="_blank"
              rel="noreferrer noopener"
            >
              {message('settings.providers.higgsfieldNoticeSource')}
            </a>
            <label className="provider-notice-consent">
              <input
                type="checkbox"
                checked={higgsfieldAccepted}
                onChange={(event) => setHiggsfieldAccepted(event.target.checked)}
              />
              {message('settings.providers.higgsfieldNoticeCheckbox')}
            </label>
          </section>
        ) : null}
        <small>
          {detected
            ? message('settings.providers.detected').replace('{provider}', detected)
            : ambiguous
              ? message('settings.providers.ambiguous')
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
        {recoveryKit && recoveryConfirmation ? (
          <motion.section
            className="recovery-inline"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <RecoveryProof
              recoveryKit={recoveryKit}
              confirmation={recoveryConfirmation}
              onConfirmed={() => {
                setRecoveryKit(undefined);
                setRecoveryConfirmation(undefined);
              }}
            />
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
            <div className="provider-controls">
              <label>
                {message('settings.providers.monthlyCap')}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={message('settings.providers.noCap')}
                  value={
                    caps[item.id] ?? (item.monthly_cap_usd === undefined ? '' : String(item.monthly_cap_usd))
                  }
                  onChange={(event) => setCaps((current) => ({ ...current, [item.id]: event.target.value }))}
                />
              </label>
              <label>
                {message('settings.providers.concurrency')}
                <input
                  type="number"
                  min="1"
                  max="32"
                  step="1"
                  value={concurrency[item.id] ?? String(item.max_concurrency ?? 1)}
                  onChange={(event) =>
                    setConcurrency((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                />
              </label>
              <div>
                <span className={item.price_stale ? 'is-stale' : ''}>
                  {item.price_fetched_at
                    ? message('settings.providers.priceAge').replace(
                        '{days}',
                        String(
                          Math.max(
                            0,
                            Math.floor((Date.now() - new Date(item.price_fetched_at).getTime()) / 86_400_000),
                          ),
                        ),
                      )
                    : message('settings.providers.priceUnknown')}
                </span>
                <button type="button" disabled={pending} onClick={() => void saveControls(item)}>
                  {message('settings.providers.saveControls')}
                </button>
              </div>
            </div>
            <footer>
              {item.status === 'degraded' ? (
                <button type="button" disabled={pending} onClick={() => void resumeProvider(item.id)}>
                  {message('settings.providers.resume')}
                </button>
              ) : null}
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
      <section className="provider-card ollama-card" aria-label="Ollama">
        <header>
          <div>
            <span className="provider-monogram" aria-hidden="true">
              O
            </span>
            <div>
              <h3>Ollama</h3>
              <p>{message('settings.providers.ollamaHelp')}</p>
            </div>
          </div>
          <span className={`provider-status is-${ollama?.detected ? 'ok' : 'not_connected'}`}>
            <i />
            {ollama?.detected
              ? message('settings.providers.ollamaDetected').replace('{count}', String(ollama.models.length))
              : message('settings.providers.ollamaMissing')}
          </span>
        </header>
        {ollama?.detected && ollama.models.length > 0 ? (
          <ul className="ollama-models">
            {ollama.models.map((model) => (
              <li key={model.name}>
                <span className="ollama-model-name">{model.name}</span>
                {model.parameter_size ? <span className="ollama-tag">{model.parameter_size}</span> : null}
                {model.context_length ? (
                  <span className="ollama-tag">{Math.round(model.context_length / 1024)}k ctx</span>
                ) : null}
                <span className={`ollama-tag ${model.tools ? 'is-tools' : 'is-disabled'}`}>
                  {model.tools
                    ? message('settings.providers.ollamaTools')
                    : message('settings.providers.ollamaNoTools')}
                </span>
                {model.vision ? (
                  <span className="ollama-tag is-vision">{message('settings.providers.ollamaVision')}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="provider-hint">{ollama?.error ?? message('settings.providers.ollamaMissingHint')}</p>
        )}
      </section>
    </div>
  );
}
