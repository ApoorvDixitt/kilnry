'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Search } from 'lucide-react';
import { LayoutGroup, motion } from 'motion/react';
import { message } from '../lib/messages';
import type { ApiModel } from '../lib/composer-types';

// The composer modes and the capabilities each one can route to. F-CRE-03 shows
// only the models whose capabilities overlap the current mode.
export type ComposerMode = 'image' | 'video' | 'audio' | 'workflow';

const MODE_CAPABILITIES: Record<ComposerMode, string[]> = {
  image: ['text2image', 'image_edit'],
  video: ['text2video', 'image2video', 'reference2video', 'video2video'],
  audio: ['tts', 'voice_clone', 'music', 'sfx'],
  workflow: [],
};

// A registry model as the /api/models route returns it, derived from the core
// manifest so the picker never drifts from the engine's registry.
export type PickerModel = ApiModel;

const PROVIDER_NAMES: Record<string, string> = {
  fal: 'fal',
  openrouter: 'OpenRouter',
  google: 'Google',
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  minimax: 'MiniMax',
  higgsfield: 'Higgsfield',
  replicate: 'Replicate',
  kie: 'kie.ai',
  wavespeed: 'WaveSpeed',
  ollama: 'Ollama',
  pollinations: 'Pollinations',
};

const UNIT_SUFFIX: Record<string, string> = {
  image: '/img',
  second: '/s',
  megapixel: '/MP',
  minute: '/min',
  character: '/1k chars',
  run: '/run',
  clone: '/clone',
  generation: '/gen',
};

const STALE_PRICE_DAYS = 30;

/** A provider's own spelling of its name (DES-01 §6). */
export function providerLabel(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider;
}

export function formatPrice(price: { unit: string; amount_usd: number; estimated?: boolean }): string {
  const suffix = UNIT_SUFFIX[price.unit] ?? `/${price.unit}`;
  const amount = price.unit === 'character' ? price.amount_usd * 1000 : price.amount_usd;
  const digits = amount < 0.01 ? 4 : amount < 1 ? 3 : 2;
  // Estimates carry ≈; actuals do not (design contract rule 11). A token-billed
  // model's per-image figure is computed, so it is an estimate (F-15).
  return `${price.estimated ? '≈ ' : ''}$${amount.toFixed(digits)}${suffix}`;
}

export function priceAgeDays(fetchedAt: string, now: number = Date.now()): number {
  return Math.floor((now - new Date(fetchedAt).getTime()) / 86_400_000);
}

// A model is offered when its provider is not retired and it is not a route the
// registry deliberately hides (for example the deliberately expensive fal
// Seedance 2.5 route tagged hidden_expensive_route). D-42 retirements carry
// deprecated_at, so they never reach the picker.
export function isOfferable(model: PickerModel): boolean {
  if (model.deprecated_at) return false;
  if (model.tags.includes('hidden_expensive_route')) return false;
  return true;
}

function tagsFor(model: PickerModel): string[] {
  const tags: string[] = [];
  tags.push(model.tags.includes('fast') ? 'fast' : 'std');
  tags.push(model.quality_tier);
  if (model.supports.audio) tags.push('audio');
  if (model.supports.references_max > 0) tags.push(`refs ≤ ${model.supports.references_max}`);
  // D-44: a provider that may train on what it is sent is named on the row, so the
  // choice is visible at the moment the model is picked.
  if (model.training_on_inputs) tags.push(message('create.picker.trainsOnInputs'));
  return tags;
}

// A keyless demo model (Pollinations FLUX) is marked so the row and its result
// tile read clearly as the free demo rather than a paid route (F-CRE-13).
function isDemoModel(model: PickerModel): boolean {
  return model.tags.includes('demo');
}

interface ModelRow {
  model: PickerModel;
  priceLabel: string | null;
  stale: boolean;
}

/**
 * One model, one row (UX-04). The registry lists an id per route — Nano Banana 2
 * twice (the preview and the live id), GPT Image three times, once per quality
 * tier — and the picker showed every one, so the recommended rows read like a
 * bug. Rows that share a provider and a display name collapse into the cheapest
 * id; the rest of the family stays reachable through Auto and the search box.
 */
function collapseByName(rows: ModelRow[]): ModelRow[] {
  const seen = new Map<string, ModelRow>();
  for (const row of rows) {
    const key = `${row.model.provider}:${row.model.display_name}`;
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, row);
      continue;
    }
    // The list is already cheapest-first, so the first row stays; the tier of the
    // duplicate is worth nothing to the user beyond the name it shares.
  }
  return [...seen.values()];
}

function toRow(model: PickerModel, now: number): ModelRow | null {
  // Acceptance criterion 1: a row without a price in the registry is not rendered.
  if (!model.price) return null;
  return {
    model,
    priceLabel: formatPrice(model.price),
    stale: priceAgeDays(model.price.fetched_at, now) > STALE_PRICE_DAYS,
  };
}

/**
 * How strict a model's moderation is, read from the refusal behaviour the
 * registry already records (PRD-05:371 "models with a moderation behaviour
 * tagged less strict in the registry"). There is no strictness field to read, so
 * the band is derived from the shape of the refusal each provider documents:
 * a prompt-level HTTP refusal before any work (OpenAI's 400 moderation_blocked,
 * Google's filtered count) is the strictest; a 422 content-policy refusal at
 * submit is the middle; a model that refuses nothing up front and only labels
 * the output (`http: null`, shape `nsfw`) is the loosest (F-110).
 */
export function moderationStrictness(model: {
  moderation?: { http: number | null; shape: string };
}): 'strict' | 'standard' | 'permissive' {
  const http = model.moderation?.http ?? null;
  if (http === null) return 'permissive';
  if (http === 400 || http === 200) return 'strict';
  return 'standard';
}

const STRICTNESS_ORDER = { strict: 2, standard: 1, permissive: 0 } as const;

/** The models whose moderation is looser than the one that just refused. */
export function looserThan(models: PickerModel[], modelId: string): PickerModel[] {
  const refused = models.find((model) => model.model_id === modelId);
  const bar = STRICTNESS_ORDER[moderationStrictness(refused ?? {})];
  return models.filter(
    (model) => model.model_id !== modelId && STRICTNESS_ORDER[moderationStrictness(model)] < bar,
  );
}

export function ModelPicker({
  mode,
  models,
  selectedId,
  autoWhy,
  onSelect,
  now = Date.now(),
  moderationLooserThan,
}: {
  mode: ComposerMode;
  models: PickerModel[];
  selectedId: string | 'auto';
  autoWhy: string;
  onSelect: (modelId: string | 'auto') => void;
  now?: number;
  /**
   * Opened from a moderated tile's "Try another model": only models with looser
   * moderation than the one that refused are listed (PRD-05:371, F-110).
   */
  moderationLooserThan?: string | undefined;
}): React.ReactNode {
  const [query, setQuery] = useState('');

  const forMode = useMemo(() => {
    const capabilities = new Set(MODE_CAPABILITIES[mode]);
    const pool = moderationLooserThan ? looserThan(models, moderationLooserThan) : models;
    return pool
      .filter(isOfferable)
      .filter((model) => model.capabilities.some((capability) => capabilities.has(capability)));
  }, [mode, models, moderationLooserThan]);

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return forMode;
    return forMode.filter((model) =>
      `${model.display_name} ${providerLabel(model.provider)} ${model.capabilities.join(' ')}`
        .toLowerCase()
        .includes(needle),
    );
  }, [forMode, query]);

  const connectedRows = collapseByName(
    searched
      .filter((model) => model.connected)
      .map((model) => toRow(model, now))
      .filter((row): row is ModelRow => row !== null)
      .sort((a, b) => (a.model.price?.amount_usd ?? 0) - (b.model.price?.amount_usd ?? 0)),
  );

  const recommended = connectedRows.slice(0, 3);
  const recommendedIds = new Set(recommended.map((row) => row.model.model_id));
  const rest = connectedRows.filter((row) => !recommendedIds.has(row.model.model_id));

  // Disconnected models are shown muted with an inline "Add <provider> key" link.
  const missingProviders = Array.from(
    new Set(searched.filter((model) => !model.connected && isOfferable(model)).map((m) => m.provider)),
  );

  const empty = searched.length === 0;

  return (
    <div className="model-picker" role="dialog" aria-label={message('create.picker.title')}>
      <div className="model-picker-search">
        <Search aria-hidden size={16} strokeWidth={1.75} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={message('create.picker.searchPlaceholder')}
          aria-label={message('create.picker.searchPlaceholder')}
        />
      </div>
      <div className="model-picker-list" role="listbox" aria-label={message('create.picker.title')}>
        <LayoutGroup id="model-picker-highlight">
          <button
            type="button"
            role="option"
            aria-selected={selectedId === 'auto'}
            className={`model-row model-row-auto${selectedId === 'auto' ? ' is-selected' : ''}`}
            onClick={() => onSelect('auto')}
          >
            {selectedId === 'auto' ? (
              <motion.span layoutId="model-hl" className="model-row-hl" aria-hidden />
            ) : null}
            <span className="model-row-head">
              <strong>{message('create.picker.auto')}</strong>
              {selectedId === 'auto' ? <Check aria-hidden size={16} strokeWidth={1.75} /> : null}
            </span>
            <small className="model-picker-why">{autoWhy}</small>
          </button>

          {recommended.length > 0 ? (
            <p className="model-picker-group">{message('create.picker.recommended')}</p>
          ) : null}
          {recommended.map((row) => (
            <ModelRowButton
              key={`${row.model.provider}:${row.model.model_id}`}
              row={row}
              selected={selectedId === row.model.model_id}
              onSelect={onSelect}
            />
          ))}

          {rest.length > 0 ? (
            <p className="model-picker-group">{message('create.picker.allModels')}</p>
          ) : null}
          {rest.map((row) => (
            <ModelRowButton
              key={`${row.model.provider}:${row.model.model_id}`}
              row={row}
              selected={selectedId === row.model.model_id}
              onSelect={onSelect}
            />
          ))}

          {missingProviders.length > 0 ? (
            <p className="model-picker-group">{message('create.picker.addKeyGroup')}</p>
          ) : null}
          {missingProviders.map((provider) => (
            <a
              key={provider}
              href="/settings/providers"
              className="model-row model-row-missing"
              data-provider={provider}
            >
              <span>{message('create.picker.addKey').replace('{provider}', providerLabel(provider))}</span>
            </a>
          ))}

          {empty ? <p className="model-picker-empty">{message('create.picker.noMatch')}</p> : null}
        </LayoutGroup>
      </div>
    </div>
  );
}

function ModelRowButton({
  row,
  selected,
  onSelect,
}: {
  row: ModelRow;
  selected: boolean;
  onSelect: (modelId: string) => void;
}): React.ReactNode {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`model-row${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(row.model.model_id)}
    >
      {selected ? <motion.span layoutId="model-hl" className="model-row-hl" aria-hidden /> : null}
      <span className="model-row-head">
        <strong>{row.model.display_name}</strong>
        {isDemoModel(row.model) ? (
          <span className="model-row-demo" data-demo="true">
            {message('create.demoBadge')}
          </span>
        ) : null}
        <span className="model-row-price" data-money="true">
          {row.stale ? (
            <AlertTriangle
              className="model-row-stale"
              aria-label={message('create.picker.staleShort')}
              size={13}
              strokeWidth={2}
            />
          ) : null}
          {row.priceLabel}
        </span>
      </span>
      <span className="model-row-meta">
        <span className="model-row-provider">{providerLabel(row.model.provider)}</span>
        {tagsFor(row.model).map((tag) => (
          <span key={tag} className="model-row-tag">
            {tag}
          </span>
        ))}
      </span>
    </button>
  );
}
