'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { message } from '../lib/messages';
import type { AssetDetail } from '../lib/composer-types';

export function AssetViewer({ assetId }: { assetId: string }): React.ReactNode {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    void fetch(`/api/library/asset/${assetId}`)
      .then((response) => {
        if (!response.ok) throw new Error('missing');
        return response.json() as Promise<{ asset: AssetDetail }>;
      })
      .then((body) => setDetail(body.asset))
      .catch(() => setMissing(true));
  }, [assetId]);

  const back = useCallback(() => {
    if (typeof window !== 'undefined') window.location.assign('/library');
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') back();
      if (event.key === 'i' || event.key === 'I') setShowInfo((prior) => !prior);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [back]);

  if (missing) {
    return (
      <section className="viewer-missing">
        <p>{message('library.viewer.missing')}</p>
        <button type="button" onClick={back}>
          {message('library.viewer.back')}
        </button>
      </section>
    );
  }

  if (!detail) return <section className="viewer" aria-busy="true" />;

  const src = `/api/media/${detail.id}`;
  const prompt = (detail.generation?.prompt as string | undefined) ?? null;

  return (
    <section className="viewer">
      <header className="viewer-bar">
        <button type="button" onClick={back}>
          {message('library.viewer.back')}
        </button>
        <span className="viewer-title">{detail.path.split('/').at(-1)}</span>
        <button
          type="button"
          className="viewer-info-toggle"
          aria-pressed={showInfo}
          aria-label={message('library.viewer.info')}
          onClick={() => setShowInfo((prior) => !prior)}
        >
          <Info aria-hidden size={16} strokeWidth={1.75} />
        </button>
      </header>

      <div className="viewer-stage">
        {detail.kind === 'video' || detail.kind === 'video_edit' ? (
          <video src={src} controls className="viewer-media">
            <track kind="captions" />
          </video>
        ) : detail.kind === 'audio' ? (
          <audio src={src} controls className="viewer-audio" />
        ) : (
          <img src={src} alt={prompt ?? ''} className="viewer-media" />
        )}
      </div>

      {showInfo ? (
        <aside className="viewer-info">
          {prompt ? (
            <p>
              <strong>{message('library.viewer.prompt')}</strong> {prompt}
            </p>
          ) : null}
          <p>
            <strong>{message('library.viewer.model')}</strong> {detail.provider_id ?? '—'} ·{' '}
            {detail.model_id ?? '—'}
          </p>
          <p data-money="true">
            <strong>{message('library.viewer.cost')}</strong>{' '}
            {detail.actual_usd ? `$${detail.actual_usd.toFixed(2)}` : '—'}
          </p>
        </aside>
      ) : null}
    </section>
  );
}
