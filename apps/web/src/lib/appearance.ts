'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

export type ThemeSetting = 'system' | 'light' | 'dark';
export type DensitySetting = 'comfortable' | 'compact';
export type MotionSetting = 'system' | 'reduce' | 'no-preference';

export interface AppearanceValue {
  theme: ThemeSetting;
  density: DensitySetting;
  reduced_motion: MotionSetting;
}

export const appearanceEvent = 'kilnry:appearance';
export const defaultAppearance: AppearanceValue = {
  theme: 'system',
  density: 'comfortable',
  reduced_motion: 'system',
};

function valid<T extends string>(value: string | null, options: readonly T[]): value is T {
  return value !== null && options.includes(value as T);
}

export function readAppearance(fallback: AppearanceValue = defaultAppearance): AppearanceValue {
  if (typeof window === 'undefined') return fallback;
  const theme = localStorage.getItem('kilnry-theme');
  const density = localStorage.getItem('kilnry-density');
  const motion = localStorage.getItem('kilnry-motion');
  return {
    theme: valid(theme, ['system', 'light', 'dark']) ? theme : fallback.theme,
    density: valid(density, ['comfortable', 'compact']) ? density : fallback.density,
    reduced_motion: valid(motion, ['system', 'reduce', 'no-preference']) ? motion : fallback.reduced_motion,
  };
}

export function renderAppearance(value: AppearanceValue): void {
  const root = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.dataset.themeSetting = value.theme;
  root.dataset.theme = value.theme === 'system' ? (dark ? 'dark' : 'light') : value.theme;
  root.dataset.density = value.density;
  root.dataset.motion =
    value.reduced_motion === 'system'
      ? reduced
        ? 'reduced'
        : 'full'
      : value.reduced_motion === 'reduce'
        ? 'reduced'
        : 'full';
}

export function storeAppearance(value: AppearanceValue): void {
  localStorage.setItem('kilnry-theme', value.theme);
  localStorage.setItem('kilnry-density', value.density);
  localStorage.setItem('kilnry-motion', value.reduced_motion);
  renderAppearance(value);
  window.dispatchEvent(new CustomEvent<AppearanceValue>(appearanceEvent, { detail: value }));
}
