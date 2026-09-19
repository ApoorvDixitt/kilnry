'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useState } from 'react';
import { Check, LockKeyhole } from 'lucide-react';
import { apiFetch } from '../lib/api-client';
import {
  storeAppearance,
  type AppearanceValue,
  type DensitySetting,
  type MotionSetting,
  type ThemeSetting,
} from '../lib/appearance';
import { message } from '../lib/messages';

interface Choice<T extends string> {
  value: T;
  label: string;
  description: string;
}

function choices<T extends string>(input: Array<Choice<T>>): Array<Choice<T>> {
  return input.map((choice) => ({
    ...choice,
    label: message(choice.label),
    description: message(choice.description),
  }));
}

const themeChoices = choices<ThemeSetting>([
  {
    value: 'system',
    label: 'settings.appearance.theme.system',
    description: 'settings.appearance.theme.systemBody',
  },
  {
    value: 'light',
    label: 'settings.appearance.theme.light',
    description: 'settings.appearance.theme.lightBody',
  },
  {
    value: 'dark',
    label: 'settings.appearance.theme.dark',
    description: 'settings.appearance.theme.darkBody',
  },
]);

const densityChoices = choices<DensitySetting>([
  {
    value: 'comfortable',
    label: 'settings.appearance.density.comfortable',
    description: 'settings.appearance.density.comfortableBody',
  },
  {
    value: 'compact',
    label: 'settings.appearance.density.compact',
    description: 'settings.appearance.density.compactBody',
  },
]);

const motionChoices = choices<MotionSetting>([
  {
    value: 'system',
    label: 'settings.appearance.motion.system',
    description: 'settings.appearance.motion.systemBody',
  },
  {
    value: 'reduce',
    label: 'settings.appearance.motion.reduce',
    description: 'settings.appearance.motion.reduceBody',
  },
  {
    value: 'no-preference',
    label: 'settings.appearance.motion.full',
    description: 'settings.appearance.motion.fullBody',
  },
]);

function ChoiceGroup<T extends string>({
  legend,
  value,
  choices,
  disabled,
  onChange,
}: {
  legend: string;
  value: T;
  choices: Array<Choice<T>>;
  disabled: boolean;
  onChange: (value: T) => void;
}): React.ReactNode {
  return (
    <fieldset className="appearance-group" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="appearance-choices">
        {choices.map((choice) => (
          <label key={choice.value} className={choice.value === value ? 'is-selected' : ''}>
            <input
              type="radio"
              name={legend}
              value={choice.value}
              checked={choice.value === value}
              onChange={() => onChange(choice.value)}
            />
            <span>
              <strong>{choice.label}</strong>
              <small>{choice.description}</small>
            </span>
            {choice.value === value ? <Check aria-hidden size={17} strokeWidth={1.75} /> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AppearanceSettings({ initialValue }: { initialValue: AppearanceValue }): React.ReactNode {
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');

  async function update(next: AppearanceValue): Promise<void> {
    const previous = value;
    setValue(next);
    setPending(true);
    setStatus('');
    storeAppearance(next);
    try {
      const response = await apiFetch('/api/settings/appearance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? message('settings.appearance.saveFailed'));
      }
      setStatus(message('settings.appearance.saved'));
    } catch (error) {
      setValue(previous);
      storeAppearance(previous);
      setStatus(error instanceof Error ? error.message : message('settings.appearance.saveFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="settings-content appearance-settings">
      <header className="settings-heading">
        <p>{message('settings.appearance.eyebrow')}</p>
        <h2>{message('settings.appearance.title')}</h2>
        <span>{message('settings.appearance.subtitle')}</span>
      </header>
      <ChoiceGroup
        legend={message('settings.appearance.theme.title')}
        value={value.theme}
        choices={themeChoices}
        disabled={pending}
        onChange={(theme) => void update({ ...value, theme })}
      />
      <ChoiceGroup
        legend={message('settings.appearance.density.title')}
        value={value.density}
        choices={densityChoices}
        disabled={pending}
        onChange={(density) => void update({ ...value, density })}
      />
      <ChoiceGroup
        legend={message('settings.appearance.motion.title')}
        value={value.reduced_motion}
        choices={motionChoices}
        disabled={pending}
        onChange={(reduced_motion) => void update({ ...value, reduced_motion })}
      />
      <div className="appearance-accent" aria-label={message('settings.appearance.accent.title')}>
        <span aria-hidden />
        <div>
          <strong>{message('settings.appearance.accent.title')}</strong>
          <small>{message('settings.appearance.accent.body')}</small>
        </div>
        <LockKeyhole aria-hidden size={17} strokeWidth={1.75} />
      </div>
      <p className="appearance-status" role="status" aria-live="polite">
        {pending ? message('settings.appearance.saving') : status}
      </p>
    </section>
  );
}
