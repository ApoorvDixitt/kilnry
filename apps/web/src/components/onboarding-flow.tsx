'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, FolderOpen, LockKeyhole, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { BrandMark } from './brand-mark';
import { message } from '../lib/messages';

interface OnboardingFlowProps {
  defaultLibrary: string;
  docker: boolean;
  initialStep: 1 | 2;
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
  const [step, setStep] = useState<1 | 2 | 3>(initialStep);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [library, setLibrary] = useState(defaultLibrary);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function createAccount(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError(message('welcome.emailInvalid'));
    if (password.length < 10) return setError(message('welcome.passwordLength'));
    if (passwordScore(password) < 2) return setError(message('welcome.passwordWeak'));
    if (password !== confirmation) return setError(message('welcome.passwordMismatch'));
    setPending(true);
    try {
      const response = await fetch('/api/auth/sign-up/email', {
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
      const response = await fetch('/api/onboarding/library', {
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
          aria-valuenow={step}
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
