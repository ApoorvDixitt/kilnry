'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Eye, EyeOff, FolderOpen, KeyRound, LockKeyhole, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { detectProviderKey } from '@kilnry/core/security/key-detection';
import { BrandMark } from './brand-mark';
import { RecoveryProof, type RecoveryConfirmation } from './recovery-proof';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

interface OnboardingFlowProps {
  defaultLibrary: string;
  docker: boolean;
  initialStep: 1 | 2 | 3;
}

function passwordScore(password: string): number {
  let score = 0;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}

export function OnboardingFlow({
  defaultLibrary,
  docker,
  initialStep,
}: OnboardingFlowProps): React.ReactNode {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(initialStep);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [library, setLibrary] = useState(defaultLibrary);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [providerKey, setProviderKey] = useState('');
  const [provider, setProvider] = useState<'fal' | 'openrouter' | 'pollinations'>('fal');
  const [connected, setConnected] = useState(false);
  const [demoExpanded, setDemoExpanded] = useState(false);
  const [connectionNote, setConnectionNote] = useState<string>();
  const [recoveryKit, setRecoveryKit] = useState<string>();
  const [recoveryConfirmation, setRecoveryConfirmation] = useState<RecoveryConfirmation>();

  function detectProvider(value: string): 'fal' | 'openrouter' | 'pollinations' | undefined {
    const candidates = detectProviderKey(value);
    if (candidates.length !== 1) return undefined;
    const candidate = candidates[0]?.provider;
    return candidate === 'fal' || candidate === 'openrouter' || candidate === 'pollinations'
      ? candidate
      : undefined;
  }

  async function createAccount(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError(message('welcome.emailInvalid'));
    if (password.length < 10) return setError(message('welcome.passwordLength'));
    if (passwordScore(password) < 2) return setError(message('welcome.passwordWeak'));
    if (password !== confirmation) return setError(message('welcome.passwordMismatch'));
    setPending(true);
    try {
      const response = await apiFetch('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: email.split('@')[0] }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string; error?: { message?: string } };
        throw new Error(body.error?.message ?? body.message ?? message('welcome.genericError'));
      }
      setStep(2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('welcome.genericError'));
    } finally {
      setPending(false);
    }
  }

  async function prepareLibrary(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setPending(true);
    try {
      const response = await apiFetch('/api/onboarding/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: library }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? message('welcome.genericError'));
      setStep(3);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('welcome.genericError'));
    } finally {
      setPending(false);
    }
  }

  async function testProvider(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setPending(true);
    try {
      const selected = detectProvider(providerKey) ?? provider;
      const response = await apiFetch(`/api/providers/${selected}/key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: providerKey }),
      });
      const body = (await response.json()) as {
        recovery_kit?: string;
        confirmation?: RecoveryConfirmation;
        test?: { latency_ms?: number; model_count?: number };
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? message('welcome.providerError'));
      setProvider(selected);
      setConnected(true);
      setRecoveryKit(body.recovery_kit);
      setRecoveryConfirmation(body.confirmation);
      setConnectionNote(
        message('welcome.providerConnected')
          .replace('{latency}', String(body.test?.latency_ms ?? 0))
          .replace('{count}', String(body.test?.model_count ?? 0)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('welcome.providerError'));
      setConnected(false);
    } finally {
      setPending(false);
    }
  }

  async function finishProviderStep(): Promise<void> {
    setError(undefined);
    setPending(true);
    try {
      const response = await apiFetch('/api/onboarding/complete', { method: 'POST' });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? message('welcome.genericError'));
      setStep(4);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('welcome.genericError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="onboarding-shell">
      <aside className="onboarding-story">
        <div className="onboarding-brand">
          <BrandMark size={30} />
          <span>{message('brand.name')}</span>
        </div>
        <div className="kiln-illustration" aria-hidden="true">
          <span />
          <i />
          <b />
        </div>
        <p>{message('brand.tagline')}</p>
        <small>{message('welcome.localOnly')}</small>
      </aside>
      <main className="onboarding-main">
        <div
          className="onboarding-progress"
          role="progressbar"
          aria-label={message('welcome.progress')}
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={Math.min(step, 3)}
        >
          {[1, 2, 3].map((value) => (
            <span key={value} className={value <= step ? 'is-on' : ''} />
          ))}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.section
            className="onboarding-card"
            key={step}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
          >
            {step === 1 ? (
              <form onSubmit={(event) => void createAccount(event)}>
                <span className="step-icon">
                  <LockKeyhole size={20} />
                </span>
                <p className="eyebrow">{message('welcome.eyebrow')}</p>
                <h1>{message('welcome.accountTitle')}</h1>
                <p className="onboarding-subtitle">{message('welcome.accountSubtitle')}</p>
                <label htmlFor="email">{message('welcome.email')}</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoFocus
                  autoComplete="email"
                />
                <span className="field-hint">{message('welcome.emailHint')}</span>
                <label htmlFor="password">{message('welcome.password')}</label>
                <div className="password-field">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={message(showPassword ? 'welcome.hidePassword' : 'welcome.showPassword')}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                <div className="strength-meter" aria-hidden="true">
                  {[1, 2, 3, 4].map((value) => (
                    <i key={value} className={value <= passwordScore(password) ? 'is-on' : ''} />
                  ))}
                </div>
                <label htmlFor="confirmation">{message('welcome.confirmPassword')}</label>
                <input
                  id="confirmation"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="new-password"
                />
                {error ? (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <button className="primary-button" type="submit" disabled={pending} aria-busy={pending}>
                  {pending ? message('welcome.working') : message('welcome.continue')}
                </button>
                <p className="privacy-note">{message('welcome.accountWhy')}</p>
              </form>
            ) : null}
            {step === 2 ? (
              <form onSubmit={(event) => void prepareLibrary(event)}>
                <span className="step-icon">
                  <FolderOpen size={20} />
                </span>
                <p className="eyebrow">{message('welcome.eyebrow')}</p>
                <h1>{message('welcome.libraryTitle')}</h1>
                <p className="onboarding-subtitle">{message('welcome.librarySubtitle')}</p>
                <label htmlFor="library">{message('welcome.libraryPath')}</label>
                <input
                  id="library"
                  type="text"
                  value={library}
                  onChange={(event) => setLibrary(event.target.value)}
                  readOnly={docker}
                  autoFocus={!docker}
                />
                {docker ? (
                  <span className="field-hint">{message('welcome.libraryDocker')}</span>
                ) : (
                  <button className="text-button" type="button" onClick={() => setLibrary(defaultLibrary)}>
                    {message('welcome.libraryDefault')}
                  </button>
                )}
                {error ? (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <button className="primary-button" type="submit" disabled={pending} aria-busy={pending}>
                  {pending ? message('welcome.libraryWorking') : message('welcome.continue')}
                </button>
              </form>
            ) : null}
            {step === 3 ? (
              <form onSubmit={(event) => void testProvider(event)}>
                <span className="step-icon">
                  <KeyRound size={20} />
                </span>
                <p className="eyebrow">{message('welcome.eyebrow')}</p>
                <h1>{message('welcome.providerTitle')}</h1>
                <p className="onboarding-subtitle">{message('welcome.providerSubtitle')}</p>
                <label htmlFor="provider-key">{message('welcome.providerKey')}</label>
                <input
                  id="provider-key"
                  type="password"
                  value={providerKey}
                  onChange={(event) => {
                    setProviderKey(event.target.value);
                    const detected = detectProvider(event.target.value);
                    if (detected) setProvider(detected);
                    setConnected(false);
                  }}
                  placeholder={message('welcome.providerPlaceholder')}
                  autoFocus
                  autoComplete="off"
                />
                <select
                  className="onboarding-select"
                  aria-label={message('welcome.providerSelect')}
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as typeof provider)}
                >
                  <option value="fal">fal</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="pollinations">Pollinations</option>
                </select>
                <span className="field-hint">
                  {detectProvider(providerKey)
                    ? message('welcome.providerDetected').replace(
                        '{provider}',
                        detectProvider(providerKey) ?? provider,
                      )
                    : detectProviderKey(providerKey).length > 1
                      ? message('welcome.providerAmbiguous')
                      : message('welcome.providerHelp')}
                </span>
                {connectionNote ? (
                  <p className="form-success">
                    <Check size={15} />
                    {connectionNote}
                  </p>
                ) : null}
                {recoveryKit && recoveryConfirmation ? (
                  <div className="onboarding-recovery">
                    <RecoveryProof
                      recoveryKit={recoveryKit}
                      confirmation={recoveryConfirmation}
                      onConfirmed={() => {
                        setRecoveryKit(undefined);
                        setRecoveryConfirmation(undefined);
                      }}
                    />
                  </div>
                ) : null}
                {error ? (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="onboarding-actions">
                  <button
                    className="secondary-button"
                    type="submit"
                    disabled={pending || providerKey.length < 8}
                  >
                    {pending ? message('welcome.providerTesting') : message('welcome.providerTest')}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={pending || !connected || Boolean(recoveryKit)}
                    onClick={() => void finishProviderStep()}
                  >
                    {message('welcome.continue')}
                  </button>
                </div>
                <div className="demo-divider">
                  <span>{message('welcome.or')}</span>
                </div>
                <button
                  className="demo-button"
                  type="button"
                  onClick={() => {
                    setProvider('pollinations');
                    setConnected(false);
                    setDemoExpanded(true);
                  }}
                >
                  {message('welcome.demo')}
                </button>
                <AnimatePresence>
                  {demoExpanded ? (
                    <motion.div
                      className="demo-instructions"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <strong>{message('welcome.demoTitle')}</strong>
                      <p>{message('welcome.demoBody')}</p>
                      <a href="https://enter.pollinations.ai/keys" target="_blank" rel="noreferrer">
                        {message('welcome.demoLink')}
                      </a>
                      <small>{message('welcome.demoNote')}</small>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
                <button
                  className="text-button"
                  type="button"
                  disabled={pending}
                  onClick={() => void finishProviderStep()}
                >
                  {message('welcome.skipProvider')}
                </button>
              </form>
            ) : null}
            {step === 4 ? (
              <div className="ready-card">
                <span className="step-icon">
                  <Sparkles size={20} />
                </span>
                <p className="eyebrow">{message('welcome.eyebrow')}</p>
                <h1>{message('welcome.readyTitle')}</h1>
                <p className="onboarding-subtitle">{message('welcome.readyBody')}</p>
                <div className="ready-detail">
                  <span>⌘K</span>
                  <p>{message('shell.command')}</p>
                </div>
                <div className="ready-detail">
                  <span>/</span>
                  <p>{message('create.shortcut')}</p>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    router.push('/create');
                    router.refresh();
                  }}
                >
                  {message('welcome.open')}
                </button>
              </div>
            ) : null}
          </motion.section>
        </AnimatePresence>
      </main>
    </div>
  );
}
