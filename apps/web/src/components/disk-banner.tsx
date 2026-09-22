// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The disk-space banner (F-LIB-13, PRD-06 §14). It polls the disk status every
// 60 seconds and shows an amber warning at 90% used (or under 5 GB free) with a
// Clear cache action, or a coral notice under 1 GB free. Clearing the cache
// empties the regenerable thumbnails and previews.

import { useCallback, useEffect, useState } from 'react';
import { message } from '../lib/messages';
import { pauseBannerText, shouldShowBanner, warnBannerText, type DiskStatusView } from './disk-banner-logic';
import { apiFetch } from '../lib/api-client';

export function DiskBanner(): React.ReactNode {
  const [status, setStatus] = useState<DiskStatusView | null>(null);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(() => {
    void fetch('/api/system/disk')
      .then((response) => (response.ok ? (response.json() as Promise<{ status: DiskStatusView }>) : null))
      .then((body) => setStatus(body?.status ?? null))
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  function clear(): void {
    setClearing(true);
    void apiFetch('/api/system/disk', { method: 'POST' })
      .then((response) => (response.ok ? (response.json() as Promise<{ status: DiskStatusView }>) : null))
      .then((body) => {
        if (body?.status) setStatus(body.status);
      })
      .catch(() => undefined)
      .finally(() => setClearing(false));
  }

  if (!status || !shouldShowBanner(status)) return null;

  return (
    <div className={`disk-banner is-${status.level}`} role="status">
      <span className="disk-banner-text">
        {status.level === 'pause' ? pauseBannerText() : warnBannerText(status)}
      </span>
      {status.level === 'warn' ? (
        <span className="disk-banner-actions">
          <button type="button" className="btn" disabled={clearing} onClick={clear}>
            {clearing ? message('library.disk.clearing') : message('library.disk.clearCache')}
          </button>
          <a href="/settings/workspace" className="disk-banner-link">
            {message('library.disk.openSettings')}
          </a>
        </span>
      ) : null}
    </div>
  );
}
