// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers for the transforms panel (F-CRE-11), unit-tested
// without a browser. One tab per operation; each tab knows its inputs and when
// Run may be pressed.

export type TransformOp =
  | 'upscale_image'
  | 'upscale_video'
  | 'bg_remove'
  | 'reframe'
  | 'outpaint'
  | 'lipsync'
  | 'dubbing'
  | 'voice_change'
  | 'transcribe'
  | 'image_to_3d';

export interface TransformTab {
  op: TransformOp;
  labelKey: string;
  // The operations without a routable capability show a needs-a-key notice.
  available: boolean;
  // Extra required inputs beyond the source (keys into the params object).
  requires: string[];
}

// The tabs in order (PRD-05 §11). All seven transform operations route to a
// seeded, connected provider capability.
export const TRANSFORM_TABS: TransformTab[] = [
  { op: 'upscale_image', labelKey: 'create.transform.upscaleImage', available: true, requires: [] },
  { op: 'upscale_video', labelKey: 'create.transform.upscaleVideo', available: true, requires: [] },
  { op: 'bg_remove', labelKey: 'create.transform.bgRemove', available: true, requires: [] },
  { op: 'reframe', labelKey: 'create.transform.reframe', available: true, requires: ['aspect_ratio'] },
  { op: 'outpaint', labelKey: 'create.transform.outpaint', available: true, requires: ['aspect_ratio'] },
  { op: 'lipsync', labelKey: 'create.transform.lipsync', available: true, requires: ['audio'] },
  { op: 'dubbing', labelKey: 'create.transform.dubbing', available: true, requires: ['language'] },
  { op: 'voice_change', labelKey: 'create.transform.voiceChange', available: true, requires: ['voice'] },
  { op: 'transcribe', labelKey: 'create.transform.transcribe', available: true, requires: [] },
  // Image → 3D (F-CRE-15, PRD-05 §15): one source image to a GLB on fal.
  { op: 'image_to_3d', labelKey: 'create.transform.imageTo3d', available: true, requires: [] },
];

// The two fal 3D models the Image → 3D tab offers: Trellis by default, and
// Hunyuan3D v3 as the premium choice (PRD-05 §15).
export const THREE_D_MODELS = [
  { id: 'trellis', labelKey: 'create.transform.model3dTrellis' },
  { id: 'hunyuan3d', labelKey: 'create.transform.model3dHunyuan' },
] as const;

// A cost in dollars, to the cent unless the price has a fraction of a cent, as
// Hunyuan3D's $0.375 does (PRD-05 §15 acceptance 3).
export function formatUsd(value: number): string {
  const cents = value * 100;
  return `$${value.toFixed(Math.abs(Math.round(cents) - cents) < 1e-9 ? 2 : 3)}`;
}

// The Image → 3D strip: "$0.02 · 1 model · ~40 s" (PRD-05 §15 acceptance 3).
export function threeDStrip(usd: number, etaSeconds: number | null, unitLabel: string): string {
  const parts = [formatUsd(usd), unitLabel];
  if (etaSeconds !== null && etaSeconds > 0) parts.push(`~${Math.round(etaSeconds)} s`);
  return parts.join(' · ');
}

export function tabFor(op: TransformOp): TransformTab {
  return TRANSFORM_TABS.find((tab) => tab.op === op) ?? TRANSFORM_TABS[0]!;
}

// Whether Run may be pressed: the op is available, a source is chosen, every
// required input is present, and nothing is running (PRD-05 §11 acceptance 1).
export function canRun(input: {
  op: TransformOp;
  source: string;
  params: Record<string, unknown>;
  running: boolean;
}): boolean {
  const tab = tabFor(input.op);
  if (!tab.available || input.running) return false;
  if (input.source.trim() === '') return false;
  return tab.requires.every((key) => {
    const value = input.params[key];
    return typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;
  });
}

// Lip-sync is billed in five-second steps (PRD-05 §11 acceptance 2). Round the
// clip length up to the next five seconds for the "billed as" note.
export function lipsyncBilledSeconds(clipSeconds: number): number {
  if (clipSeconds <= 0) return 0;
  return Math.ceil(clipSeconds / 5) * 5;
}
