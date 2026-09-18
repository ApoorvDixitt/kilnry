'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';
import { BrandMark } from './brand-mark';
import { message } from '../lib/messages';

export function LoginForm(): React.ReactNode {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error(message('login.error'));
      router.push('/create');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('login.error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <div className="login-brand">
          <BrandMark size={28} />
          <span>{message('brand.name')}</span>
        </div>
        <span className="step-icon">
          <LockKeyhole size={20} />
        </span>
        <h1>{message('login.title')}</h1>
        <p>{message('login.subtitle')}</p>
        <label htmlFor="login-email">{message('welcome.email')}</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          autoFocus
        />
        <label htmlFor="login-password">{message('welcome.password')}</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? message('login.working') : message('login.submit')}
        </button>
        <small>{message('login.lost')}</small>
      </form>
    </div>
  );
}
