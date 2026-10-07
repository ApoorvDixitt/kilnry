'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { message } from '../lib/messages';

// The subset of a model's JSON-Schema parameters the composer chips read. The
// registry builds these from each model's manifest, so the chips only ever
// offer values the selected model actually accepts.
export interface ParamsSchema {
  properties?: Record<string, ParamProperty>;
}

export interface ParamProperty {
  type?: string;
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  maxLength?: number;
}

export interface ComposerParams {
  aspect_ratio?: string;
  resolution?: string;
  duration_s?: number;
  count: number;
  audio?: boolean;
  // Offered only when the pinned model's schema lists them (F-63): a fixed seed
  // repeats a result; a negative prompt says what to leave out.
  seed?: number;
  negative_prompt?: string;
}

export interface Adjustment {
  field: string;
  from: string | number | boolean;
  to: string | number | boolean;
  note: string;
}

const COUNT_MIN = 1;
const COUNT_MAX = 4;

function nearestEnum(value: number, options: number[]): number {
  return options.reduce((best, option) => {
    const closer = Math.abs(option - value) < Math.abs(best - value);
    const tieHigher = Math.abs(option - value) === Math.abs(best - value) && option > best;
    return closer || tieHigher ? option : best;
  });
}

function snapNumber(value: number, property: ParamProperty): number {
  if (Array.isArray(property.enum)) {
    const numbers = property.enum.filter((item): item is number => typeof item === 'number');
    if (numbers.length > 0 && !numbers.includes(value)) return nearestEnum(value, numbers);
    return value;
  }
  let snapped = value;
  if (typeof property.minimum === 'number') snapped = Math.max(snapped, property.minimum);
  if (typeof property.maximum === 'number') snapped = Math.min(snapped, property.maximum);
  if (typeof property.multipleOf === 'number' && property.multipleOf > 0) {
    snapped = Math.round(snapped / property.multipleOf) * property.multipleOf;
  }
  return snapped;
}

// Validate requested parameters against the selected model's schema, snapping any
// value the model does not list to the nearest one it does and recording every
// change so the composer can show "5 s to 6 s for this model" and the job's
// adjustments log matches what the user saw.
export function snapParams(
  schema: ParamsSchema,
  requested: ComposerParams,
): { params: ComposerParams; adjustments: Adjustment[] } {
  const properties = schema.properties ?? {};
  const adjustments: Adjustment[] = [];
  const params: ComposerParams = { count: clampCount(requested.count) };

  const aspect = properties.aspect_ratio;
  if (aspect?.enum && requested.aspect_ratio !== undefined) {
    if (aspect.enum.includes(requested.aspect_ratio)) {
      params.aspect_ratio = requested.aspect_ratio;
    } else {
      const fallback = String(aspect.enum[0]);
      adjustments.push({
        field: 'aspect_ratio',
        from: requested.aspect_ratio,
        to: fallback,
        note: message('create.chips.snapAspect')
          .replace('{from}', requested.aspect_ratio)
          .replace('{to}', fallback),
      });
      params.aspect_ratio = fallback;
    }
  }

  const resolution = properties.resolution;
  if (resolution?.enum && requested.resolution !== undefined) {
    if (resolution.enum.includes(requested.resolution)) {
      params.resolution = requested.resolution;
    } else {
      const fallback = String(resolution.enum[0]);
      adjustments.push({
        field: 'resolution',
        from: requested.resolution,
        to: fallback,
        note: message('create.chips.snapResolution')
          .replace('{from}', requested.resolution)
          .replace('{to}', fallback),
      });
      params.resolution = fallback;
    }
  }

  const duration = properties.duration_s;
  if (duration && requested.duration_s !== undefined) {
    const snapped = snapNumber(requested.duration_s, duration);
    if (snapped !== requested.duration_s) {
      adjustments.push({
        field: 'duration_s',
        from: requested.duration_s,
        to: snapped,
        note: message('create.chips.snapDuration')
          .replace('{from}', String(requested.duration_s))
          .replace('{to}', String(snapped)),
      });
    }
    params.duration_s = snapped;
  }

  if (properties.audio && requested.audio !== undefined) params.audio = requested.audio;

  // A seed or negative prompt the model does not take is dropped rather than
  // sent where it would be refused or silently ignored (F-63).
  if (properties.seed && requested.seed !== undefined && Number.isFinite(requested.seed)) {
    params.seed = Math.max(properties.seed.minimum ?? 0, Math.round(requested.seed));
  }
  if (properties.negative_prompt && requested.negative_prompt) {
    params.negative_prompt = requested.negative_prompt.slice(
      0,
      properties.negative_prompt.maxLength ?? 10_000,
    );
  }

  return { params, adjustments };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The chips' schema: Auto's per-mode controls, plus the seed and negative-prompt
 * fields of a pinned model whose schema lists them (F-63). On Auto the routed
 * model is not known yet, so neither is offered there.
 */
export function chipSchema(base: ParamsSchema, pinned?: ParamsSchema): ParamsSchema {
  const extra = pinned?.properties ?? {};
  return {
    properties: {
      ...(base.properties ?? {}),
      ...(extra.seed ? { seed: extra.seed } : {}),
      ...(extra.negative_prompt ? { negative_prompt: extra.negative_prompt } : {}),
    },
  };
}

export function clampCount(count: number): number {
  if (!Number.isFinite(count)) return COUNT_MIN;
  return Math.min(COUNT_MAX, Math.max(COUNT_MIN, Math.round(count)));
}

function enumValues(property: ParamProperty | undefined): Array<string | number> {
  return property?.enum ?? [];
}

function Chip({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: (close: () => void) => React.ReactNode;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="param-chip">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        className="param-chip-trigger"
        onClick={() => setOpen((prior) => !prior)}
      >
        <span className="param-chip-label">{label}</span>
        <span className="param-chip-value">{value}</span>
        <ChevronDown aria-hidden size={13} strokeWidth={2} />
      </button>
      {open ? (
        <div className="param-chip-popover" id={id} role="menu">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

// The composer footer chips. Only the chips the model supports are shown, and
// each option comes from the model's schema so a value can never be picked that
// the model would reject.
export function ParamChips({
  schema,
  params,
  onChange,
}: {
  schema: ParamsSchema;
  params: ComposerParams;
  onChange: (next: ComposerParams) => void;
}): React.ReactNode {
  const properties = schema.properties ?? {};
  const aspectOptions = enumValues(properties.aspect_ratio).map(String);
  const resolutionOptions = enumValues(properties.resolution).map(String);
  const durationOptions = enumValues(properties.duration_s).filter(
    (item): item is number => typeof item === 'number',
  );

  return (
    <div className="param-chips" role="group" aria-label={message('create.chips.group')}>
      {aspectOptions.length > 0 ? (
        <Chip label={message('create.chips.aspect')} value={params.aspect_ratio ?? aspectOptions[0] ?? '—'}>
          {(close) => (
            <div className="param-chip-options">
              {aspectOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={params.aspect_ratio === option}
                  className={params.aspect_ratio === option ? 'is-selected' : ''}
                  onClick={() => {
                    onChange({ ...params, aspect_ratio: option });
                    close();
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </Chip>
      ) : null}

      {durationOptions.length > 0 ? (
        <Chip label={message('create.chips.duration')} value={`${params.duration_s ?? durationOptions[0]} s`}>
          {(close) => (
            <div className="param-chip-options">
              {durationOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={params.duration_s === option}
                  className={params.duration_s === option ? 'is-selected' : ''}
                  onClick={() => {
                    onChange({ ...params, duration_s: option });
                    close();
                  }}
                >
                  {option} s
                </button>
              ))}
            </div>
          )}
        </Chip>
      ) : null}

      {resolutionOptions.length > 0 ? (
        <Chip
          label={message('create.chips.resolution')}
          value={params.resolution ?? resolutionOptions[0] ?? '—'}
        >
          {(close) => (
            <div className="param-chip-options">
              {resolutionOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={params.resolution === option}
                  className={params.resolution === option ? 'is-selected' : ''}
                  onClick={() => {
                    onChange({ ...params, resolution: option });
                    close();
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </Chip>
      ) : null}

      <Chip label={message('create.chips.count')} value={String(params.count)}>
        {(close) => (
          <div className="param-chip-options">
            {[1, 2, 3, 4].map((option) => (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={params.count === option}
                className={params.count === option ? 'is-selected' : ''}
                onClick={() => {
                  onChange({ ...params, count: option });
                  close();
                }}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </Chip>

      {properties.seed ? (
        <Chip
          label={message('create.chips.seed')}
          value={params.seed === undefined ? message('create.chips.seedRandom') : String(params.seed)}
        >
          {(close) => (
            <div className="param-chip-field">
              <label>
                {message('create.chips.seedLabel')}
                <input
                  type="number"
                  inputMode="numeric"
                  min={properties.seed?.minimum ?? 0}
                  step={1}
                  value={params.seed ?? ''}
                  onChange={(event) => {
                    const raw = event.target.value;
                    const next = { ...params };
                    if (raw === '') delete next.seed;
                    else next.seed = Math.max(properties.seed?.minimum ?? 0, Math.round(Number(raw)));
                    onChange(next);
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  const next = { ...params };
                  delete next.seed;
                  onChange(next);
                  close();
                }}
              >
                {message('create.chips.seedClear')}
              </button>
            </div>
          )}
        </Chip>
      ) : null}

      {properties.negative_prompt ? (
        <Chip
          label={message('create.chips.negative')}
          value={
            params.negative_prompt
              ? truncate(params.negative_prompt, 18)
              : message('create.chips.negativeNone')
          }
        >
          {() => (
            <div className="param-chip-field">
              <label>
                {message('create.chips.negativeLabel')}
                <input
                  type="text"
                  maxLength={properties.negative_prompt?.maxLength ?? 10_000}
                  placeholder={message('create.chips.negativePlaceholder')}
                  value={params.negative_prompt ?? ''}
                  onChange={(event) => {
                    const next = { ...params };
                    if (event.target.value === '') delete next.negative_prompt;
                    else next.negative_prompt = event.target.value;
                    onChange(next);
                  }}
                />
              </label>
            </div>
          )}
        </Chip>
      ) : null}

      {properties.audio ? (
        <button
          type="button"
          aria-pressed={params.audio ?? false}
          className={`param-chip-toggle${params.audio ? ' is-on' : ''}`}
          onClick={() => onChange({ ...params, audio: !params.audio })}
        >
          {message('create.chips.audio')}
          <span>{params.audio ? message('create.chips.on') : message('create.chips.off')}</span>
        </button>
      ) : null}
    </div>
  );
}
