// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { CanonicalRequest, MediaRole, Strategy } from '../types.js';
import type { ModelManifest } from '../registry/manifest.js';
import { KilnryError } from '../errors.js';
import { parseMentions, type Mention } from './parse.js';
import {
  EMITTERS,
  emitImageReferences,
  emitText,
  emitVoice,
  hasKlingVoiceSlots,
  isImageEditor,
  isOrderedRefRole,
  loraFor,
  orderedReferences,
  soulIdFor,
  requiresFirstFrame,
} from './emitters.js';
import {
  STRATEGY_ORDER,
  mediaKindFor,
  type EmitContext,
  type Injection,
  type MediaKind,
  type ResolvedRequest,
  type ResolverCtx,
} from './resolver-types.js';
import type { LoadedVersion } from './store.js';

// Models with a hard people cap that refuse (not just warn) past the limit.
const PEOPLE_CAP: Record<string, number> = {
  'gemini-2.5-flash-image': 5,
  'nano-banana': 5,
  'nano-banana-pro': 5,
};

interface Target {
  version: LoadedVersion;
  mention?: Mention;
}

// A CanonicalRequest may carry explicit `characters[]` (ids/handles) alongside
// @mentions; the schema does not model it, so we read it defensively.
function explicitCharacters(req: CanonicalRequest): string[] {
  const value = (req as { characters?: unknown }).characters;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

// Resolve @mentions and explicit characters into provider inputs and a rewritten
// prompt for the target model (TRD-14 §3).
export function resolvePrompt(
  req: CanonicalRequest,
  model: ModelManifest,
  ctx: ResolverCtx,
): ResolvedRequest {
  const { mentions, warnings } = parseMentions(req.prompt, ctx.lookupHandle, ctx.knownHandles ?? []);

  const mentionTargets: Target[] = mentions.map((mention) => ({
    version: ctx.loadVersion(mention.id, mention.version),
    mention,
  }));
  const mentionedIds = new Set(mentions.map((m) => m.id));
  const explicitTargets: Target[] = explicitCharacters(req)
    .map((handle) => ctx.lookupHandle(handle))
    .filter((head): head is NonNullable<typeof head> => Boolean(head))
    .filter((head) => !mentionedIds.has(head.id))
    .map((head) => ({ version: ctx.loadVersion(head.id) }));
  const targets = [...mentionTargets, ...explicitTargets];

  const kind = mediaKindFor(req);
  const defaultOrder = STRATEGY_ORDER[kind];

  const people = targets.filter((t) => t.version.kind === 'character');
  const cap = PEOPLE_CAP[model.model_id];
  if (cap !== undefined && people.length >= cap) {
    throw new KilnryError(
      'INVALID_INPUT',
      `${people.length} distinct people exceed the ${cap}-person cap of ${model.display_name}.`,
    );
  }
  if (people.length >= 3) {
    warnings.push(`${people.length} distinct people in one shot; consistency degrades past two (F-CHR-13).`);
  }

  // Consent: real people without consent may still be used with references.
  for (const target of targets) {
    const v = target.version;
    if (v.is_real_person && v.consent_status !== 'self' && v.consent_status !== 'written') {
      warnings.push(`Consent not set for @${v.handle}; training is disabled.`);
    }
  }

  const nonCharacterRefs = req.medias.filter(
    (m) => m.role === 'reference' || m.role === 'product' || m.role === 'style',
  ).length;
  let refBudget = model.supports.references_max - nonCharacterRefs;
  let slot = req.medias.filter((m) => isOrderedRefRole(m.role)).length;

  const injections: Injection[] = [];
  const fragment: Record<string, unknown> = {};
  let prompt = req.prompt;
  const usedTriggers = new Set<string>();
  let emittedElements = 0;

  // The ordered reference list is the request's own medias: the user's
  // attachments first, the Character's references appended after them (TRD-14
  // §4). No fragment key is seeded for it — each adapter names the list its
  // provider uses (input_references[] on OpenRouter, reference_image_urls[] on
  // fal's Wan 3.0, image_urls[] on Seedance and Veo 3.1), and a name chosen
  // here would be wrong for every provider but one.
  const personShiftsUserRefs =
    req.kind === 'image_edit' && mentionTargets.some((t) => t.version.kind === 'character');
  if (personShiftsUserRefs) {
    // The person's anchor becomes image 1; the user's refs shift after it.
    slot = 0;
  }

  // Character reference slots that carried a used-2-refs video identity clause.
  const videoRefSpans: Array<{ noun: string; from: number; to: number }> = [];
  // All span→replacement edits, applied in one right-to-left pass so the parse
  // offsets (into the original prompt) stay valid across multiple targets.
  const edits: Array<{ start: number; end: number; text: string; strategy: Strategy }> = [];

  for (const target of targets) {
    const version = target.version;
    const order = version.injection_defaults?.[kind] ?? defaultOrder;
    const emitCtx: EmitContext = { slot, refBudget, usedTriggers, ctx, emittedElements };
    // D-72: an endpoint whose schema requires a first frame cannot run without
    // one. When the user pinned such a model and gave no start frame, this
    // Character's anchor opens the video, and where the endpoint also has an
    // `elements` list (Kling v3 image-to-video) the same Character's images ride
    // along in it, so identity is not left to the single frame.
    const firstFrameNeeded =
      kind === 'video' &&
      requiresFirstFrame(model) &&
      !req.medias.some((media) => media.role === 'start_frame') &&
      !injections.some((injected) => injected.inputs.some((input) => input.role === 'start_frame'));
    const strategyOrder: Strategy[] = firstFrameNeeded
      ? ['start_frame', ...order.filter((entry) => entry !== 'start_frame')]
      : order;
    const strategy =
      strategyOrder.find((s) => available(s, version, model, req, refBudget, kind, ctx)) ?? 'text';
    const emitter =
      strategy === 'reference_images' && kind === 'image' ? emitImageReferences : EMITTERS[strategy];
    let emit = emitter(version, model, req, emitCtx);
    let alsoElements = false;
    if (strategy === 'start_frame' && firstFrameNeeded) {
      const note = `${model.display_name} needs a first frame; @${version.handle}'s anchor opens the video.`;
      const withElements =
        model.supports.elements && available('elements', version, model, req, refBudget, kind, ctx)
          ? EMITTERS.elements(version, model, req, emitCtx)
          : undefined;
      if (withElements) {
        alsoElements = true;
        emit = {
          // The anchor is the first frame and the element's frontal image; its
          // other views ride in the element, so count both sets of inputs once.
          inputs: [...emit.inputs, ...withElements.inputs],
          fragment: withElements.fragment,
          replacement: withElements.replacement,
          refsUsed: emit.refsUsed + withElements.refsUsed,
          ...(withElements.slot_index === undefined ? {} : { slot_index: withElements.slot_index }),
          notes: [...emit.notes, ...withElements.notes, note],
          warnings: [...emit.warnings, ...withElements.warnings],
        };
      } else {
        emit = { ...emit, notes: [...emit.notes, note] };
      }
    }

    injections.push({
      handle: version.handle,
      id: version.id,
      version: version.version,
      kind: version.kind,
      strategy,
      inputs: emit.inputs,
      ...(emit.lora ? { lora: emit.lora } : {}),
      ...(emit.identity ? { identity: emit.identity } : {}),
      ...(emit.voice ? { voice: emit.voice } : {}),
      ...(emit.slot_index !== undefined ? { slot_index: emit.slot_index } : {}),
      is_real_person: version.is_real_person,
      ...(version.consent_status ? { consent_status: version.consent_status } : {}),
      notes: [
        ...emit.notes,
        ...(target.mention?.version !== undefined
          ? [`pinned to v${target.mention.version} by @${version.handle}@v${target.mention.version}`]
          : []),
      ],
    });

    deepMerge(fragment, emit.fragment);
    refBudget -= emit.refsUsed;
    slot += emit.refsUsed;
    if (strategy === 'elements' || alsoElements) emittedElements += 1;

    if (
      strategy === 'reference_images' &&
      kind === 'video' &&
      version.kind === 'character' &&
      emit.refsUsed >= 2
    ) {
      videoRefSpans.push({
        noun: possessive(version),
        from: emit.slot_index ?? 1,
        to: (emit.slot_index ?? 1) + emit.refsUsed - 1,
      });
    }

    if (target.mention && emit.replacement) {
      for (const span of target.mention.spans) {
        edits.push({ start: span.start, end: span.end, text: emit.replacement, strategy });
      }
    }
    if (emit.trigger_word) usedTriggers.add(emit.trigger_word);
    warnings.push(...emit.warnings);
  }

  // Apply all mention edits in one right-to-left pass, adjusting the phrase and
  // the surrounding punctuation so it blends into the sentence (see spliceEdit).
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) {
    prompt = spliceEdit(prompt, edit);
  }

  // Text safety net: append descriptors for explicit (mention-less) text targets.
  for (const target of targets) {
    if (target.mention) continue;
    const inj = injections.find((i) => i.id === target.version.id);
    if (inj?.strategy === 'text') {
      const t = emitText(target.version, model);
      if (t.replacement && !prompt.includes(t.replacement)) prompt = `${prompt.trimEnd()} ${t.replacement}`;
    }
  }

  // Voice pass: bound voice of the FIRST character on voice-capable models. A
  // voice id is only ever sent to the provider that made it (TRD-14 §2 audio
  // row): Kling's voice_ids[] take a Kling-created voice, a TTS model takes a
  // voice of its own provider. Anything else is reported, never emitted
  // (PRD-08 B4 "never silently substituted").
  const explicitVoice = req.params.voice;
  const voiceOwner = targets.find(
    (t) => t.version.voice && (model.supports.voice_ids || model.capabilities.includes('tts')),
  );
  let voiceMismatch: ResolvedRequest['voice_mismatch'];
  const voiceAlreadyEmitted =
    voiceOwner !== undefined &&
    injections.some((i) => i.id === voiceOwner.version.id && i.strategy === 'voice_id');
  if (voiceOwner && !explicitVoice && !voiceAlreadyEmitted) {
    const bound = voiceOwner.version.voice!;
    const handle = voiceOwner.version.handle;
    if (hasKlingVoiceSlots(model) && bound.provider !== 'kling') {
      warnings.push(`@${handle}'s voice is ${bound.provider}; Kling speech needs a Kling-created voice`);
    } else if (!hasKlingVoiceSlots(model) && bound.provider !== model.provider) {
      voiceMismatch = { handle, provider: bound.provider, voice_id: bound.voice_id };
      warnings.push(`@${handle}'s voice is ${bound.provider}; ${model.display_name} is ${model.provider}`);
    } else {
      const v = emitVoice(voiceOwner.version, model);
      deepMerge(fragment, v.fragment);
      if (hasKlingVoiceSlots(model)) {
        const inj = injections.find((i) => i.id === voiceOwner.version.id && i.strategy === 'elements');
        const elementLabel = inj?.slot_index ? `@Element${inj.slot_index}` : `@Element1`;
        prompt = wrapKlingSpeech(prompt, elementLabel);
      }
      injections.push({
        handle,
        id: voiceOwner.version.id,
        version: voiceOwner.version.version,
        kind: voiceOwner.version.kind,
        strategy: 'voice_id',
        inputs: [],
        ...(v.voice ? { voice: v.voice } : {}),
        is_real_person: voiceOwner.version.is_real_person,
        ...(voiceOwner.version.consent_status ? { consent_status: voiceOwner.version.consent_status } : {}),
        notes: [],
      });
    }
  }

  // Video identity clause: "Keep the woman's face identical to images a–b."
  const trailingClauses: string[] = [];

  // Storyboard clause when the user attached a reference labelled "storyboard".
  const storyboard = req.medias.find((m) => m.label?.toLowerCase() === 'storyboard');
  if (storyboard) {
    const storyboardSlot = req.medias
      .filter((m) => isOrderedRefRole(m.role))
      .findIndex((m) => m.label?.toLowerCase() === 'storyboard');
    trailingClauses.push(`Compose from the storyboard in image ${storyboardSlot + 1}.`);
  }

  for (const span of videoRefSpans) {
    trailingClauses.push(`Keep the ${span.noun} face identical to images ${span.from}\u2013${span.to}.`);
  }

  for (const clause of trailingClauses) {
    prompt = appendSentence(prompt, clause);
  }

  // Image editor: prefix the edit framing and append the appearance-only clauses.
  if (isImageEditor(model)) {
    prompt = applyImageEditFraming(prompt, injections, targets, req);
  }

  // Negative traits: appended to negative_prompt when the model supports it
  // (any strategy); otherwise only the `text` strategy folds them into the
  // prompt as "Avoid: …" (TRD-14 §4 text emitter row).
  const negativeTraits = collectNegativeTraits(targets);
  const anyTextCharacter = injections.some((i) => i.kind === 'character' && i.strategy === 'text');
  let negativePrompt = req.negative_prompt;
  if (negativeTraits.length > 0) {
    if (model.supports.negative_prompt) {
      negativePrompt = negativePrompt
        ? `${negativePrompt}, ${negativeTraits.join(', ')}`
        : negativeTraits.join(', ');
    } else if (anyTextCharacter) {
      prompt = appendSentence(prompt, `Avoid: ${negativeTraits.join(', ')}.`);
    }
  }

  const medias = [
    ...req.medias,
    ...injections.flatMap((i) =>
      i.inputs.map((x) => ({
        role: x.role,
        asset_id: x.asset_id,
        ...(x.label ? { label: x.label } : {}),
        ...(x.weight !== undefined ? { weight: x.weight } : {}),
      })),
    ),
  ];

  return {
    ...req,
    prompt,
    ...(negativePrompt !== undefined ? { negative_prompt: negativePrompt } : {}),
    medias,
    injections,
    provider_fragment: fragment,
    warnings,
    original_prompt: req.prompt,
    ...(voiceMismatch ? { voice_mismatch: voiceMismatch } : {}),
  };
}

// Whether a strategy is available for a target on this model (TRD-14 §2).
function available(
  strategy: Strategy,
  version: LoadedVersion,
  model: ModelManifest,
  req: CanonicalRequest,
  refBudget: number,
  kind: MediaKind,
  ctx: ResolverCtx,
): boolean {
  const isElement = version.kind !== 'character';
  switch (strategy) {
    case 'lora':
      return !isElement && model.supports.lora && Boolean(loraFor(ctx, version, model));
    case 'identity_id':
      return !isElement && model.supports.identity_ids.length > 0 && Boolean(soulIdFor(ctx, version));
    case 'elements':
      return model.supports.elements && orderedReferences(version, req.prompt).length > 0;
    case 'reference_images':
      return refBudget > 0 && orderedReferences(version, req.prompt).length > 0;
    case 'start_frame':
      return (
        kind === 'video' &&
        model.supports.start_end_frame &&
        !req.medias.some((m) => m.role === 'start_frame') &&
        orderedReferences(version, req.prompt).length > 0
      );
    case 'voice_id':
      return voiceUsable(version, model);
    case 'text':
      return true;
    default:
      return false;
  }
}

// Possessive noun phrase for the video identity clause ("woman's").
function possessive(version: LoadedVersion): string {
  const g = version.appearance.gendered_noun ?? 'person';
  const noun = g === 'figure' ? 'person' : g;
  return `${noun}'s`;
}

function collectNegativeTraits(targets: Target[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of targets) {
    if (t.version.kind !== 'character') continue;
    for (const trait of t.version.appearance.negative_traits) {
      if (!seen.has(trait)) {
        seen.add(trait);
        out.push(trait);
      }
    }
  }
  return out;
}

// Apply one mention edit, adjusting punctuation so the replacement blends into
// the sentence. LoRA phrases join a comma tag-list; the identity descriptor's
// trailing period becomes a comma when text follows; the text descriptor turns a
// following ", word" into ". Word" (a new sentence).
function spliceEdit(
  prompt: string,
  edit: { start: number; end: number; text: string; strategy: Strategy },
): string {
  const before = prompt.slice(0, edit.start);
  let text = edit.text;
  let after = prompt.slice(edit.end);

  if (edit.strategy === 'lora') {
    // "mayak, …, navy kurta" + " on a rooftop" → "…, navy kurta, on a rooftop".
    if (/^\s+[A-Za-z0-9]/.test(after) && !/[,.:;!?]$/.test(text)) text = `${text},`;
  } else if (edit.strategy === 'identity_id') {
    // "…, navy linen kurta." + " at a Mumbai" → "…, navy linen kurta, at a Mumbai".
    if (/^\s+\S/.test(after) && text.endsWith('.')) text = `${text.slice(0, -1)},`;
  } else if (edit.strategy === 'text') {
    // "… Keep: …." + ", fashion editorial" → "… Keep: …. Fashion editorial".
    const m = /^,\s+([a-z])/.exec(after);
    if (m) {
      const sep = /[.!?]$/.test(text) ? ' ' : '. ';
      after = `${sep}${m[1]!.toUpperCase()}${after.slice(m[0].length)}`;
    }
  }

  return before + text + after;
}

// Kling speech wrapping: turn "@Element1 says: \"…\"" into
// "@Element1 says <<<voice_1>>>: \"…\"" (TRD-14 §4 voice_id row).
function wrapKlingSpeech(prompt: string, elementLabel: string): string {
  const escaped = elementLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped} says)\\s*:`);
  if (re.test(prompt)) return prompt.replace(re, `$1 <<<voice_1>>>:`);
  return prompt;
}

// Append a clause as a new sentence, ensuring the preceding text ends with
// terminal punctuation so "morning light" becomes "morning light. Compose …".
function appendSentence(prompt: string, clause: string): string {
  const trimmed = prompt.trimEnd();
  const needsStop = !/[.!?"]$/.test(trimmed);
  return `${trimmed}${needsStop ? '.' : ''} ${clause}`;
}

// Image editors: append the person "Keep face…" clause (§5 Nano Banana) or, when
// the person is the subject of an edit that incorporates a labelled reference,
// build the structured edit prompt (§7 Ex5). The structured-edit body is a
// template (the user's free text is replaced) because §7 fixes it byte-exact.
function applyImageEditFraming(
  prompt: string,
  injections: Injection[],
  targets: Target[],
  req: CanonicalRequest,
): string {
  const personInjection = injections.find((i) => i.kind === 'character' && i.strategy === 'reference_images');
  if (!personInjection) return prompt;
  const personTarget = targets.find((t) => t.version.id === personInjection.id);
  const anchorSlot = personInjection.slot_index ?? 1;
  const personPhrase = replacementFor(personInjection, prompt);

  const labelledRef = req.medias.find((m) => (m.role === 'reference' || m.role === 'product') && m.label);
  const personIsSubject = req.kind === 'image_edit' && anchorSlot === 1 && Boolean(labelledRef);

  if (personIsSubject && labelledRef && personPhrase) {
    const refSlot = anchorSlot + 1;
    return (
      `Edit image ${anchorSlot} so ${personPhrase} wears the ${labelledRef.label} from image ${refSlot}. ` +
      `Keep face, hair, pose, camera and background unchanged. ` +
      `Appearance reference only for image ${refSlot}; ignore its background and lighting.`
    );
  }

  if (!/Keep .*identical to image/.test(prompt)) {
    const pronoun = personTarget ? possessivePronoun(personTarget.version) : 'their';
    return appendSentence(prompt, `Keep ${pronoun} face and hair identical to image ${anchorSlot}.`);
  }
  return prompt;
}

// The rewritten person phrase, read back from the prompt (it is the emitter
// replacement, which is unique enough to locate).
function replacementFor(injection: Injection, prompt: string): string | undefined {
  const slot = injection.slot_index ?? 1;
  const re = new RegExp(`the (?:person|woman|man) in image ${slot} \\([^)]*\\)`);
  return re.exec(prompt)?.[0];
}

function possessivePronoun(version: LoadedVersion): string {
  const g = version.appearance.gendered_noun ?? 'person';
  if (g === 'woman') return 'her';
  if (g === 'man') return 'his';
  return 'their';
}

// A bound voice is usable only by the provider that made it: Kling's voice_ids[]
// take a kling voice; a TTS model takes a voice of its own provider (TRD-14 §2).
export function voiceUsable(version: LoadedVersion, model: ModelManifest): boolean {
  const voice = version.voice;
  if (!voice) return false;
  if (hasKlingVoiceSlots(model)) return voice.provider === 'kling';
  return model.capabilities.includes('tts') && voice.provider === model.provider;
}

// Deep-merge an emitter fragment into the accumulating provider fragment,
// concatenating arrays (elements[], input_references[], image_urls[]).
/** Keys a recursive merge must never follow (the workflows templater's list). */
const BANNED_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    // A fragment carrying an own __proto__ key would otherwise merge into
    // Object.prototype and flip a flag on every object in the process (F-26).
    if (BANNED_MERGE_KEYS.has(key)) continue;
    const existing = target[key];
    if (Array.isArray(existing) && Array.isArray(value)) {
      target[key] = [...existing, ...value];
    } else if (
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}

export type { MediaRole };
