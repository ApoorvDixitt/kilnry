// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Provider names as each provider spells its own (DES-01 §6 "Voice and copy").
// Every place a user reads a provider goes through `providerLabel`; the
// lower-case ids are for URLs, settings keys and logs. Before this module the
// map lived in the model picker alone, so onboarding said "openrouter
// detected", a queued Create tile said "Queued at openrouter" and the Jobs
// table read ids (UX-08).

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

/** A provider's own spelling of its name (DES-01 §6). */
export function providerLabel(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider;
}

/**
 * A Chat model option as a user reads it: "GPT 5.6 Luna · OpenAI · $0.20 / $1.20
 * per M" — the registry's display name and the provider's spelling, never the
 * raw `openai/gpt-5.6-luna` id, which goes in the option's tooltip (UX-08,
 * PRD-10 §9's "no model names" mechanics rule applies to delivery, and DES-01 §6
 * to how a name is spelled). A local Ollama model has no registry row, so its
 * own name stands.
 */
export function chatModelLabel(option: {
  provider: string;
  model: string;
  display_name?: string;
  price_label: string;
}): string {
  return `${option.display_name ?? option.model} · ${providerLabel(option.provider)} · ${option.price_label}`;
}

/**
 * The Model cell: the registry's display name with the id in a tooltip, so a
 * model has one name on the picker, the cost strip and the Jobs table (UX-08).
 * A job whose model has left the registry shows its id.
 */
export function modelCell(row: {
  model?: string | null;
  modelId?: string | null;
  modelName?: string | null;
}): { label: string; title?: string } {
  const id = row.model ?? row.modelId;
  if (!id) return { label: '—' };
  if (row.modelName && row.modelName !== id) return { label: row.modelName, title: id };
  return { label: id };
}
