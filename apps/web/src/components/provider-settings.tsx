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
import { providerLabel } from '../lib/provider-names';
import { priceAgeLine } from './provider-settings-logic';
import { RecoveryProof } from './recovery-proof';

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
  accepted_tos_at?: string;
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

// "18 Sep 2026" — the acknowledgement date as the collapsed notice shows it.
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function acknowledgedDate(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, '0')} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
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
  const [caps, setCaps] = useState<Record<string, string>>({});
  const [concurrency, setConcurrency] = useState<Record<string, string>>({});
  const [ollama, setOllama] = useState<OllamaDetection>();
  const [locked, setLocked] = useState(false);
  const [restoreKit, setRestoreKit] = useState('');
  const [restoreError, setRestoreError] = useState<string>();
  const [higgsfieldAccepted, setHiggsfieldAccepted] = useState(false);
  const [noticeExpanded, setNoticeExpanded] = useState(false);
  const [priceMaxAge, setPriceMaxAge] = useState('30');
  // Once the training clause is acknowledged the full notice collapses to one line
  // with a Show link, and a later key for the same provider saves without re-ticking.
  const higgsfieldAcknowledgedAt = providers.find((item) => item.id === 'higgsfield')?.accepted_tos_at;

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
    setProviders(
      body.providers.filter((item) => ['fal', 'openrouter', 'pollinations', 'higgsfield'].includes(item.id)),
    );
  }, []);

  // The stored staleness threshold (D-73a); 30 until the first read answers.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/settings/providers')
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body: { providers?: { price_max_age_days?: number } } | undefined) => {
        if (!cancelled && typeof body?.providers?.price_max_age_days === 'number') {
          setPriceMaxAge(String(body.providers.price_max_age_days));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Check whether the master key is missing from this machine's keychain. When
  // it is, the Providers page leads with the recovery-kit banner so the owner
  // can restore the encrypted keys without re-entering them (S-22).
  useEffect(() => {
    void fetch('/api/security/key-store')
      .then((response) =>
        response.ok ? (response.json() as Promise<{ status?: { locked?: boolean } }>) : null,
      )
      .then((body) => setLocked(body?.status?.locked === true))
      .catch(() => setLocked(false));
  }, []);

  async function restore(): Promise<void> {
    setRestoreError(undefined);
    setPending(true);
    try {
      const response = await apiFetch('/api/security/key-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', recovery_kit: restoreKit }),
      });
      const body = (await response.json()) as {
        status?: { locked?: boolean };
        error?: { message?: string; details?: { checksum_words?: string } };
      };
      if (!response.ok) {
        const words = body.error?.details?.checksum_words;
        throw new Error(
          words
            ? message('settings.providers.lockedMismatch').replace('{words}', words)
            : (body.error?.message ?? message('settings.providers.requestFailed')),
        );
      }
      setLocked(body.status?.locked === true);
      setRestoreKit('');
      setNotice(message('settings.providers.lockedRestored'));
      await load();
    } catch (cause) {
      setRestoreError(cause instanceof Error ? cause.message : message('settings.providers.requestFailed'));
    } finally {
      setPending(false);
    }
  }

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

  async function savePriceMaxAge(): Promise<void> {
    setError(undefined);
    setPending(true);
    try {
      const body = await responseJson<{ providers: { price_max_age_days: number } }>(
        await apiFetch('/api/settings/providers', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ price_max_age_days: Number(priceMaxAge) }),
        }),
      );
      setPriceMaxAge(String(body.providers.price_max_age_days));
      setNotice(
        message('settings.providers.priceMaxAgeSaved').replace(
          '{days}',
          String(body.providers.price_max_age_days),
        ),
      );
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
      {locked ? (
        <section className="provider-locked" role="alert">
          <KeyRound size={19} />
          <div>
            <h3>{message('settings.providers.lockedTitle')}</h3>
            <p>{message('settings.providers.lockedBody')}</p>
            <label htmlFor="provider-recovery-kit">{message('settings.providers.lockedKitLabel')}</label>
            <textarea
              id="provider-recovery-kit"
              value={restoreKit}
              autoComplete="off"
              onChange={(event) => setRestoreKit(event.target.value)}
            />
            <button
              type="button"
              className="settings-primary"
              disabled={pending || restoreKit.replace(/[\s-]/g, '').length < 20}
              onClick={() => void restore()}
            >
              {message('settings.providers.lockedRestore')}
            </button>
            {restoreError ? <p className="form-error">{restoreError}</p> : null}
          </div>
        </section>
      ) : null}
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
              pending ||
              key.length < 8 ||
              ((detected ?? provider) === 'higgsfield' && !higgsfieldAccepted && !higgsfieldAcknowledgedAt)
            }
          >
            {pending ? message('settings.providers.testing') : message('settings.providers.testAndSave')}
          </button>
        </div>
        {(detected ?? provider) === 'higgsfield' ? (
          higgsfieldAcknowledgedAt && !noticeExpanded ? (
            <section
              className="provider-notice provider-notice-acknowledged"
              aria-label={message('settings.providers.higgsfieldNoticeTitle')}
            >
              <span>
                {message('settings.providers.higgsfieldAcknowledged').replace(
                  '{date}',
                  acknowledgedDate(higgsfieldAcknowledgedAt),
                )}
              </span>
              <span className="provider-notice-sep" aria-hidden>
                {' · '}
              </span>
              <button type="button" className="provider-notice-show" onClick={() => setNoticeExpanded(true)}>
                {message('settings.providers.higgsfieldAcknowledgedShow')}
              </button>
            </section>
          ) : (
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
          )
        ) : null}
        <small>
          {detected
            ? message('settings.providers.detected').replace('{provider}', providerLabel(detected))
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
        {recoveryKit ? (
          <motion.section
            className="recovery-inline"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <RecoveryProof recoveryKit={recoveryKit} onConfirmed={() => setRecoveryKit(undefined)} />
          </motion.section>
        ) : null}
      </AnimatePresence>
      {/* The workspace-wide staleness threshold PRD-14 §8 names (D-73a). It sits
          with the per-provider price-age lines because it is what makes them
          amber. */}
      <label className="provider-price-age">
        <span>{message('settings.providers.priceMaxAge').replace('{days}', '')}</span>
        <input
          type="number"
          min={1}
          max={3650}
          step={1}
          aria-label={message('settings.providers.priceMaxAge').replace('{days}', 'N')}
          data-testid="price-max-age"
          value={priceMaxAge}
          onChange={(event) => setPriceMaxAge(event.target.value)}
        />
        <button type="button" disabled={pending} onClick={() => void savePriceMaxAge()}>
          {message('settings.providers.priceMaxAgeSave')}
        </button>
      </label>
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
                {/* UX-10: "Prices 16 days old" from the first day reads as a
                    warning with no threshold. The age appears in the last ten
                    days before the limit, with the limit named; before that the
                    line says the prices are current. */}
                <span className={item.price_stale ? 'is-stale' : ''}>
                  {priceAgeLine(item.price_fetched_at, Number(priceMaxAge) || 30)}
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
