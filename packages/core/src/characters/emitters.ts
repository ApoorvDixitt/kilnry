// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { CanonicalRequest, MediaRole, Strategy } from '../types.js';
import type { ModelManifest } from '../registry/manifest.js';
import type { EmitContext, EmitResult, ResolverCtx, TrainedIdentityInfo } from './resolver-types.js';
import type { Appearance, LoadedVersion, ReferenceRow } from './store.js';

const APPEARANCE_ONLY = 'appearance reference only; ignore its background and lighting';

// The ordered reference-selection preference within a single character
// (TRD-14 §3.1 rule 2): anchor first, then turnaround views, then full body,
// then an outfit/state whose label appears in the prompt.
const VIEW_RANK: Record<string, number> = {
  front: 0,
  three_quarter_left: 1,
  three_quarter_right: 2,
  profile_left: 3,
  profile_right: 4,
  full_body: 5,
};

function roleRank(ref: ReferenceRow): number {
  if (ref.role === 'anchor') return -1;
  if (ref.view && ref.view in VIEW_RANK) return VIEW_RANK[ref.view]!;
  if (ref.role === 'full_body') return VIEW_RANK.full_body!;
  return 50;
}

// Order a version's references by the §3.1 preference; the anchor is always
// first, outfit/state references only surface when their label is in the prompt.
export function orderedReferences(version: LoadedVersion, prompt: string): ReferenceRow[] {
  const lower = prompt.toLowerCase();
  const scored = version.references
    .filter((ref) => !(ref as { tags?: string[] }).tags?.includes('grid'))
    .filter((ref) => {
      if (ref.role === 'outfit' || ref.role === 'state') {
        return ref.label ? lower.includes(ref.label.toLowerCase()) : false;
      }
      return true;
    });
  return [...scored].sort((a, b) => roleRank(a) - roleRank(b));
}

// First sentence of the descriptor, capped at 25 words (the emitter `desc`).
export function shortDescriptor(appearance: Appearance): string {
  const first = appearance.descriptor.split(/(?<=\.)\s+/)[0] ?? appearance.descriptor;
  const words = first.trim().split(/\s+/);
  return words.length <= 25 ? first.trim() : `${words.slice(0, 25).join(' ')}`;
}

// The short-form anchor list, capped at three phrases (TRD-14 §4).
function anchorsShort(appearance: Appearance): string {
  return appearance.anchors.slice(0, 3).join(', ');
}

function gender(version: LoadedVersion): 'woman' | 'man' | 'person' | 'figure' {
  return version.appearance.gendered_noun ?? 'person';
}

// The noun used for a person in "the {noun} in image N".
function personNoun(version: LoadedVersion): string {
  const g = gender(version);
  return g === 'figure' ? 'person' : g;
}

// The noun used for a prop/environment element ("glass" for @chai_glass).
function elementNoun(version: LoadedVersion): string {
  if (version.kind === 'environment') return 'place';
  const segment = version.handle.split(/[_-]/).pop();
  if (segment && segment.length > 0) return segment;
  return 'object';
}

function readyIdentities(ctx: ResolverCtx, version: LoadedVersion): TrainedIdentityInfo[] {
  return ctx.identitiesFor?.(version.id, version.version) ?? [];
}

// The LoRA family a model consumes, from its model id (TRD-14 §2).
function loraFamilyFor(model: ModelManifest): string | undefined {
  if (model.model_id === 'fal-ai/flux-lora') return 'flux1-dev';
  if (model.model_id === 'fal-ai/flux-2/lora') return 'flux2-dev';
  return undefined;
}

export function loraFor(
  ctx: ResolverCtx,
  version: LoadedVersion,
  model: ModelManifest,
): TrainedIdentityInfo | undefined {
  const family = loraFamilyFor(model);
  if (!family) return undefined;
  return readyIdentities(ctx, version).find(
    (identity) => identity.kind === 'lora' && identity.status === 'ready' && identity.base_model === family,
  );
}

export function soulIdFor(ctx: ResolverCtx, version: LoadedVersion): TrainedIdentityInfo | undefined {
  return readyIdentities(ctx, version).find(
    (identity) => identity.kind === 'soul_id' && identity.status === 'ready',
  );
}

// Which media roles occupy an ordered reference slot on this model.
export function isOrderedRefRole(role: MediaRole): boolean {
  return role === 'reference' || role === 'product' || role === 'style';
}

const NAME = (version: LoadedVersion): string =>
  version.display_name.length > 0 ? version.display_name : version.handle;

// ── elements (fal Kling) ────────────────────────────────────────────────────
function emitElements(
  version: LoadedVersion,
  _model: ModelManifest,
  req: CanonicalRequest,
  ctx: EmitContext,
): EmitResult {
  const ordered = orderedReferences(version, req.prompt);
  const anchor = ordered[0];
  if (!anchor) return emitText(version, _model);
  // A Kling element is one frontal image plus up to three turnaround face views.
  // Full-body ranks last and is dropped in favour of the face profiles (§7 Ex1).
  const refs = ordered
    .slice(1)
    .filter((ref) => ref.role !== 'full_body' && ref.view !== 'full_body')
    .slice(0, 3);
  const frontalUrl = ctx.ctx.assetUrl(anchor.asset_id);
  const referenceUrls = refs.map((ref) => ctx.ctx.assetUrl(ref.asset_id));
  const elementIndex = elementCount(ctx) + 1;
  const inputs: EmitResult['inputs'] = [anchor, ...refs].map((ref) => ({
    role: 'reference' as MediaRole,
    asset_id: ref.asset_id,
    ...(ref.view ? { view: ref.view } : {}),
    ...(ref.label ? { label: ref.label } : {}),
    ...(ref.weight !== 1 ? { weight: ref.weight } : {}),
  }));
  const isElement = version.kind !== 'character';
  const replacement = isElement ? `@Element${elementIndex} (${APPEARANCE_ONLY})` : `@Element${elementIndex}`;
  return {
    inputs,
    fragment: {
      elements: [{ frontal_image_url: frontalUrl, reference_image_urls: referenceUrls }],
    },
    replacement,
    refsUsed: 1 + refs.length,
    slot_index: elementIndex,
    notes: [],
    warnings: [],
  };
}

// Number of elements already emitted (each element consumes one slot group but
// the slot_index of an element is its 1-based position in `elements[]`).
function elementCount(ctx: EmitContext): number {
  return ctx.emittedElements ?? 0;
}

// ── reference_images (video, ordered) ───────────────────────────────────────
function emitVideoReferences(
  version: LoadedVersion,
  model: ModelManifest,
  req: CanonicalRequest,
  ctx: EmitContext,
): EmitResult {
  const ordered = orderedReferences(version, req.prompt);
  if (ordered.length === 0) return emitText(version, model);
  const maxRefs = version.kind === 'character' ? Math.min(2, ctx.refBudget) : Math.min(1, ctx.refBudget);
  if (maxRefs <= 0) return emitText(version, model);
  const chosen = ordered.slice(0, maxRefs);
  const anchorSlot = ctx.slot + 1;
  const inputs: EmitResult['inputs'] = chosen.map((ref) => ({
    role: 'reference' as MediaRole,
    asset_id: ref.asset_id,
    ...(ref.view ? { view: ref.view } : {}),
    ...(ref.label ? { label: ref.label } : {}),
    ...(ref.weight !== 1 ? { weight: ref.weight } : {}),
  }));
  let replacement: string;
  if (version.kind === 'character') {
    // PRD-07 §4's short form. A Character with no anchors yet gets its name
    // alone: "(Maya: )" with nothing after the colon went to the provider.
    const anchors = anchorsShort(version.appearance);
    replacement = `the ${personNoun(version)} in image ${anchorSlot} (${NAME(version)}${
      anchors ? `: ${anchors}` : ''
    })`;
  } else if (version.kind === 'environment') {
    replacement = `the place in image ${anchorSlot}`;
  } else {
    replacement = `the ${elementNoun(version)} in image ${anchorSlot} (${APPEARANCE_ONLY})`;
  }
  return {
    inputs,
    // No payload fragment: the references travel as `reference` media inputs and
    // each adapter names the list its own schema uses (TRD-14 §4 names a
    // different one per provider — OpenRouter input_references[], fal Wan 3.0
    // reference_image_urls[], Seedance image_urls[], Veo 3.1 image_urls[]). A
    // hardcoded input_references[] reached fal untranslated and was ignored.
    fragment: {},
    replacement,
    refsUsed: chosen.length,
    slot_index: anchorSlot,
    notes: [],
    warnings: [],
  };
}

// ── reference_images (image editors, ordered) ───────────────────────────────
function emitImageReferences(
  version: LoadedVersion,
  model: ModelManifest,
  req: CanonicalRequest,
  ctx: EmitContext,
): EmitResult {
  const ordered = orderedReferences(version, req.prompt);
  if (ordered.length === 0) return emitText(version, model);
  // Image editors put the person's anchor first; a turned view is added only when
  // the budget allows and the prompt implies a turned head.
  const wantsTurn = /\bturn|profile|side|over the shoulder|looking (?:away|back)\b/i.test(req.prompt);
  const maxRefs = version.kind === 'character' ? (wantsTurn ? Math.min(2, ctx.refBudget) : 1) : 1;
  const chosen = ordered.slice(0, Math.max(1, maxRefs));
  const anchorSlot = ctx.slot + 1;
  const inputs: EmitResult['inputs'] = chosen.map((ref) => ({
    role: 'reference' as MediaRole,
    asset_id: ref.asset_id,
    ...(ref.view ? { view: ref.view } : {}),
    ...(ref.label ? { label: ref.label } : {}),
    ...(ref.weight !== 1 ? { weight: ref.weight } : {}),
  }));
  const token = promptToken(model);
  let replacement: string;
  if (version.kind === 'character') {
    const noun = token === 'person' ? 'person' : personNoun(version);
    replacement = `the ${noun} in image ${anchorSlot} (${NAME(version)}: ${anchorsShort(version.appearance)})`;
  } else if (version.kind === 'environment') {
    replacement = `the place in image ${anchorSlot}`;
  } else {
    replacement = `the ${elementNoun(version)} in image ${anchorSlot} (${APPEARANCE_ONLY})`;
  }
  return {
    inputs,
    fragment: {},
    replacement,
    refsUsed: chosen.length,
    slot_index: anchorSlot,
    notes: [],
    warnings: [],
  };
}

// The per-model prompt-token noun form ("person" for GPT Image, gendered noun
// for Nano Banana). Read from the reference media role's `prompt_token`.
function promptToken(model: ModelManifest): 'person' | 'gendered' {
  const roleToken = model.media_roles.find((r) => r.role === 'reference') as
    { prompt_token?: string } | undefined;
  if (roleToken?.prompt_token === 'person') return 'person';
  if (model.model_id.startsWith('gpt-image')) return 'person';
  return 'gendered';
}

// ── lora ─────────────────────────────────────────────────────────────────────
function emitLora(
  version: LoadedVersion,
  model: ModelManifest,
  req: CanonicalRequest,
  ctx: EmitContext,
): EmitResult {
  const lora = loraFor(ctx.ctx, version, model);
  if (!lora || !lora.artifact_url) return emitText(version, model);
  const anchorWeight = version.references[0]?.weight;
  const scale =
    anchorWeight !== undefined && anchorWeight !== 1 ? anchorWeight : (lora.default_scale ?? 0.85);
  const trigger = lora.trigger_word ?? '';
  const warnings: string[] = [];
  if (ctx.usedTriggers.size > 0) {
    warnings.push('Multiple LoRA identities in one prompt; identity mixing is unreliable.');
  }
  const anchors = version.appearance.anchors.join(', ');
  const replacement = anchors ? `${trigger}, ${anchors}` : trigger;
  return {
    inputs: [],
    fragment: { loras: [{ path: lora.artifact_url, scale }] },
    replacement,
    refsUsed: 0,
    notes: [],
    warnings,
    trigger_word: trigger,
    lora: {
      path: lora.artifact_url,
      scale,
      base_model: lora.base_model ?? 'flux1-dev',
      ...(trigger ? { trigger_word: trigger } : {}),
    },
  };
}

// ── identity_id (Higgsfield Soul) ─────────────────────────────────────────────
function emitIdentity(
  version: LoadedVersion,
  model: ModelManifest,
  req: CanonicalRequest,
  ctx: EmitContext,
): EmitResult {
  const soul = soulIdFor(ctx.ctx, version);
  if (!soul || !soul.remote_id) return emitText(version, model);
  const anchorWeight = version.references[0]?.weight;
  const strength = anchorWeight !== undefined && anchorWeight !== 1 ? anchorWeight : 0.8;
  const attachAnchor = model.supports.references_max >= 1 && version.references[0];
  const fragment: Record<string, unknown> = {
    custom_reference_id: soul.remote_id,
    custom_reference_strength: strength,
  };
  const inputs: EmitResult['inputs'] = [];
  let refsUsed = 0;
  if (attachAnchor) {
    fragment.image_reference_url = ctx.ctx.assetUrl(attachAnchor.asset_id);
    inputs.push({
      role: 'reference',
      asset_id: attachAnchor.asset_id,
      ...(attachAnchor.view ? { view: attachAnchor.view } : {}),
    });
    refsUsed = 1;
  }
  return {
    inputs,
    fragment,
    replacement: version.appearance.descriptor.trim(),
    refsUsed,
    notes: [],
    warnings: [],
    identity: { provider: 'higgsfield', remote_id: soul.remote_id, strength },
  };
}

// ── start_frame ────────────────────────────────────────────────────────────
function emitStartFrame(version: LoadedVersion, model: ModelManifest, req: CanonicalRequest): EmitResult {
  const ordered = orderedReferences(version, req.prompt);
  const anchor = ordered[0];
  if (!anchor) return emitText(version, model);
  return {
    inputs: [
      { role: 'start_frame', asset_id: anchor.asset_id, ...(anchor.view ? { view: anchor.view } : {}) },
    ],
    // No payload fragment: the start_frame media input carries the anchor, and
    // each adapter names the field its own schema uses (fal's Kling v3 and
    // Wan 3.0 image-to-video want start_image_url, not image_url — which the
    // fal adapter also refuses as a passthrough override).
    fragment: {},
    replacement: 'the person in the first frame',
    refsUsed: 1,
    notes: [],
    warnings: [],
  };
}

// ── voice_id ─────────────────────────────────────────────────────────────────
// `supports.voice_ids` is true for Kling's voice_ids[] slots and for TTS models'
// voice_id alike (TRD-07 §2); the capability tells them apart.
export function hasKlingVoiceSlots(model: ModelManifest): boolean {
  return model.supports.voice_ids && !model.capabilities.includes('tts');
}

function emitVoice(version: LoadedVersion, model: ModelManifest): EmitResult {
  const voice = version.voice;
  if (!voice) {
    return { inputs: [], fragment: {}, replacement: '', refsUsed: 0, notes: [], warnings: [] };
  }
  if (hasKlingVoiceSlots(model)) {
    return {
      inputs: [],
      fragment: { voice_ids: [voice.voice_id] },
      replacement: '',
      refsUsed: 0,
      notes: [],
      warnings: [],
      voice: { provider: voice.provider, voice_id: voice.voice_id },
    };
  }
  return {
    inputs: [],
    fragment: { voice_id: voice.voice_id },
    replacement: '',
    refsUsed: 0,
    notes: [],
    warnings: [],
    voice: { provider: voice.provider, voice_id: voice.voice_id },
  };
}

// ── text (safety net) ─────────────────────────────────────────────────────────
function isVideoModel(model: ModelManifest): boolean {
  return model.capabilities.some((capability) =>
    ['text2video', 'image2video', 'reference2video', 'video2video'].includes(capability),
  );
}

/** No way at all to carry an identity: no references, no elements, no frames. */
export function noIdentitySlot(model: ModelManifest): boolean {
  return (
    model.supports.references_max === 0 &&
    !model.supports.elements &&
    !model.supports.start_end_frame &&
    !model.supports.lora &&
    model.supports.identity_ids.length === 0
  );
}

/** The endpoint cannot run without a first frame (fal's required start image). */
export function requiresFirstFrame(model: ModelManifest): boolean {
  return model.media_roles.some((role) => role.role === 'start_frame' && (role.min ?? 0) >= 1);
}

function emitText(version: LoadedVersion, model: ModelManifest): EmitResult {
  const anchors = version.appearance.anchors.join(', ');
  const descriptor = version.appearance.descriptor.trim();
  const replacement = anchors ? `${descriptor} Keep: ${anchors}.` : descriptor;
  const notes: string[] = [];
  if (model.model_id === 'higgsfield-ai/soul/v2/standard') {
    notes.push(
      'Soul 2 standard has no reference slot; identity is text-only. Train a Soul ID ($2.50) for a locked face.',
    );
  } else if (noIdentitySlot(model) && isVideoModel(model)) {
    // TRD-14 §2 (D-72), Example 6's form: say what this endpoint cannot do and
    // the one thing the user can do about it. fal's prompt-only video endpoints
    // have no elements, reference or frame field at all.
    notes.push(
      `${model.display_name} has no reference slot; identity is text-only. Add a first frame to use @${version.handle}'s images.`,
    );
  }
  return { inputs: [], fragment: {}, replacement, refsUsed: 0, notes, warnings: [] };
}

export type Emitter = (
  version: LoadedVersion,
  model: ModelManifest,
  req: CanonicalRequest,
  ctx: EmitContext,
) => EmitResult;

// The image-editor list of models whose reference_images use editor prompt forms.
export function isImageEditor(model: ModelManifest): boolean {
  return model.capabilities.includes('image_edit');
}

// The dispatch table, split so the resolver can pick the video vs image form of
// reference_images by media kind.
export const EMITTERS: Record<Strategy, Emitter> = {
  elements: emitElements,
  reference_images: emitVideoReferences,
  lora: emitLora,
  identity_id: emitIdentity,
  start_frame: emitStartFrame,
  voice_id: emitVoice,
  text: emitText,
};

export { emitVideoReferences, emitImageReferences, emitText, emitVoice };
