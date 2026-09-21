// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The cast builder form (F-CHR-15, PRD-07 §15). A few trait selects produce one
// anchor and three alternates; the age options never include minors and a
// free-text field naming one blocks Generate. The four images are generated
// through the ordinary estimate-then-generate path, then shown as a pick grid;
// the chosen anchor and the cast parameters are reported to the parent, which
// creates the Character.

import { useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import {
  AGE_RANGES,
  ARCHETYPES,
  LOOKS,
  VIBES,
  WARDROBES,
  canGenerate,
  defaultCastForm,
  mentionsMinor,
  type CastForm,
} from './cast-builder-logic';

export interface CastPick {
  asset_id: string;
  cast_params: Record<string, unknown>;
}

export function CastBuilder({ onPick }: { onPick: (pick: CastPick) => void }): React.ReactNode {
  const [form, setForm] = useState<CastForm>(defaultCastForm());
  const [generating, setGenerating] = useState(false);
  const [tiles, setTiles] = useState<string[]>([]);
  const [params, setParams] = useState<Record<string, unknown> | null>(null);
  const [picked, setPicked] = useState<string>();
  const [error, setError] = useState<string>();

  function set<K extends keyof CastForm>(key: K, value: CastForm[K]): void {
    setForm((prior) => ({ ...prior, [key]: value }));
  }

  const enabled = canGenerate(form, generating);

  function generate(): void {
    if (!enabled) return;
    setGenerating(true);
    setError(undefined);
    void apiFetch('/api/characters/cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((body: { error?: { message?: string } }) => {
              throw new Error(body.error?.message ?? message('characters.cast.failed'));
            }),
      )
      .then(async (body: { params: Record<string, unknown>; generate: Record<string, unknown> }) => {
        setParams(body.params);
        const generated = await apiFetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body.generate),
        });
        const result = (await generated.json()) as { assets?: Array<{ asset_id: string }> };
        setTiles((result.assets ?? []).map((asset) => asset.asset_id));
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : message('characters.cast.failed')),
      )
      .finally(() => setGenerating(false));
  }

  return (
    <div className="cast-builder">
      <div className="cast-builder-form">
        <label>
          {message('characters.cast.archetype')}
          <select value={form.archetype} onChange={(event) => set('archetype', event.target.value as never)}>
            {ARCHETYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          {message('characters.cast.age')}
          <select value={form.age_range} onChange={(event) => set('age_range', event.target.value as never)}>
            {AGE_RANGES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          {message('characters.cast.look')}
          <select value={form.look} onChange={(event) => set('look', event.target.value as never)}>
            {LOOKS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          {message('characters.cast.region')}
          <input
            type="text"
            className="cast-builder-region"
            value={form.region}
            onChange={(event) => set('region', event.target.value)}
          />
        </label>
        <label>
          {message('characters.cast.wardrobe')}
          <select value={form.wardrobe} onChange={(event) => set('wardrobe', event.target.value as never)}>
            {WARDROBES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          {message('characters.cast.vibe')}
          <select value={form.vibe} onChange={(event) => set('vibe', event.target.value as never)}>
            {VIBES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          {message('characters.cast.setting')}
          <input
            type="text"
            value={form.setting_hint}
            onChange={(event) => set('setting_hint', event.target.value)}
          />
        </label>
      </div>

      {mentionsMinor(form.region) || mentionsMinor(form.setting_hint) ? (
        <p className="cast-builder-minor" role="alert">
          {message('characters.cast.noMinors')}
        </p>
      ) : null}

      <button className="btn primary" type="button" disabled={!enabled} onClick={generate}>
        {generating ? message('characters.cast.generating') : message('characters.cast.generate')}
      </button>

      {error ? (
        <p className="characters-error" role="alert">
          {error}
        </p>
      ) : null}

      {tiles.length > 0 ? (
        <div className="cast-builder-grid" role="radiogroup" aria-label={message('characters.cast.pick')}>
          <p className="muted">{message('characters.cast.pickHint')}</p>
          {tiles.map((assetId) => (
            <button
              key={assetId}
              type="button"
              role="radio"
              aria-checked={picked === assetId}
              className={picked === assetId ? 'cast-builder-tile on' : 'cast-builder-tile'}
              onClick={() => {
                setPicked(assetId);
                onPick({ asset_id: assetId, cast_params: params ?? {} });
              }}
            >
              <img src={`/api/media/${assetId}`} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
