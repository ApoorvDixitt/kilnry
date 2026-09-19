'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { apiFetch } from '../lib/api-client';
import { appearanceEvent, readAppearance, storeAppearance } from '../lib/appearance';
import { message } from '../lib/messages';

type Theme = 'light' | 'dark';

export function ThemeSwitcher(): React.ReactNode {
  const [theme, setTheme] = useState<Theme>('light');
  const [error, setError] = useState('');

  useEffect(() => {
    const sync = (): void => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    sync();
    window.addEventListener(appearanceEvent, sync);
    return () => window.removeEventListener(appearanceEvent, sync);
  }, []);

  async function toggle(): Promise<void> {
    const previous = readAppearance();
    const next = theme === 'dark' ? 'light' : 'dark';
    const appearance = { ...previous, theme: next } as const;
    setError('');
    storeAppearance(appearance);
    try {
      const response = await apiFetch('/api/settings/appearance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appearance),
      });
      if (response.ok) return;
      const body = (await response.json()) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? message('settings.appearance.saveFailed'));
    } catch (cause) {
      storeAppearance(previous);
      setError(cause instanceof Error ? cause.message : message('settings.appearance.saveFailed'));
    }
  }

  return (
    <>
      {error ? (
        <span className="theme-save-error" role="alert">
          {error}
        </span>
      ) : null}
      <button
        className="icon-button"
        type="button"
        aria-label={message('shell.theme')}
        onClick={() => void toggle()}
      >
        {theme === 'dark' ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
      </button>
    </>
  );
}
