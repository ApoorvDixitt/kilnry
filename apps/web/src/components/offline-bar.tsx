'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The thin amber bar PRD-15:152 puts under the top bar on every page. It lived
// in the Jobs view only, so Create went offline silently and a generation there
// showed the browser's raw "Failed to fetch" (F-117).
//
// The state it reads is the server's observed one (/api/network, D-70). The browser's `navigator.onLine` only shows the bar early
// — it never changes a job — and a health request that cannot be made at all is
// itself evidence the machine is offline.

import { useEffect, useState } from 'react';
import { message } from '../lib/messages';

const POLL_MS = 5_000;

export function useNetworkOffline(pollMs = POLL_MS): boolean {
  const [serverOffline, setServerOffline] = useState(false);
  const [browserOffline, setBrowserOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const read = async (): Promise<void> => {
      try {
        const response = await fetch('/api/network', { cache: 'no-store' });
        const body = (await response.json()) as { online?: boolean };
        if (!cancelled) setServerOffline(body.online === false);
      } catch {
        // The local server could not be reached: the machine is offline.
        if (!cancelled) setServerOffline(true);
      }
    };
    void read();
    const timer = setInterval(() => void read(), pollMs);
    const goOffline = (): void => setBrowserOffline(true);
    const goOnline = (): void => {
      setBrowserOffline(false);
      void read();
    };
    setBrowserOffline(!window.navigator.onLine);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [pollMs]);

  return serverOffline || browserOffline;
}

export function OfflineBar(): React.ReactNode {
  const offline = useNetworkOffline();
  if (!offline) return null;
  return (
    <p className="offline-bar" role="status">
      {message('jobs.offlineBar')}
    </p>
  );
}
