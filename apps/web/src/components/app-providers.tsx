'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { Toaster } from 'sonner';

export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  return (
    <MotionConfig reducedMotion="user">
      {children}
      <Toaster position="bottom-right" visibleToasts={3} duration={6000} />
    </MotionConfig>
  );
}
