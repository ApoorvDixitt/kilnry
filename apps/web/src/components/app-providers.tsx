'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { MotionConfig, type ReducedMotionConfig } from 'motion/react';
import { Toaster } from 'sonner';
import { appearanceEvent, readAppearance, renderAppearance, type AppearanceValue } from '../lib/appearance';
import { message } from '../lib/messages';

export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  const [reducedMotion, setReducedMotion] = useState<ReducedMotionConfig>('user');
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    const color = matchMedia('(prefers-color-scheme: dark)');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (next?: AppearanceValue): void => {
      const value = next ?? readAppearance();
      renderAppearance(value);
      setReducedMotion(
        value.reduced_motion === 'reduce'
          ? 'always'
          : value.reduced_motion === 'no-preference'
            ? 'never'
            : 'user',
      );
    };
    const changed = (event: Event): void => sync((event as CustomEvent<AppearanceValue>).detail);
    const mediaChanged = (): void => sync();
    sync();
    setStorageError(document.documentElement.dataset.appearanceError === 'storage');
    window.addEventListener(appearanceEvent, changed);
    color.addEventListener('change', mediaChanged);
    motion.addEventListener('change', mediaChanged);
    return () => {
      window.removeEventListener(appearanceEvent, changed);
      color.removeEventListener('change', mediaChanged);
      motion.removeEventListener('change', mediaChanged);
    };
  }, []);

  return (
    <MotionConfig reducedMotion={reducedMotion}>
      {storageError ? (
        <p className="appearance-storage-error" role="alert">
          {message('settings.appearance.storageFailed')}
        </p>
      ) : null}
      {children}
      <Toaster position="bottom-right" visibleToasts={3} duration={6000} />
    </MotionConfig>
  );
}
