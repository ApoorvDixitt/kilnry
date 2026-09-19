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
}

export interface ComposerParams {
  aspect_ratio?: string;
  resolution?: string;
  duration_s?: number;
  count: number;
  audio?: boolean;
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

  return { params, adjustments };
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
