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
  isImageEditor,
  isOrderedRefRole,
  loraFor,
  orderedReferences,
  soulIdFor,
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

  // Seed the ordered reference list with the user's own attachments so the
  // character refs are appended after them (TRD-14 §4: "provider list gets
  // A, R1, R2 appended after the user's own refs"). Video models expose the
  // ordered list as `input_references`; image editors build `image[]` at the
  // adapter from the ordered injections, so no fragment key is seeded there.
  const userRefs = req.medias.filter((m) => isOrderedRefRole(m.role));
  const personShiftsUserRefs =
    req.kind === 'image_edit' && mentionTargets.some((t) => t.version.kind === 'character');
  if (kind === 'video' && userRefs.length > 0) {
    fragment.input_references = userRefs.map((m) => ({ url: mediaUrl(m, ctx) }));
  }
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
    const strategy = order.find((s) => available(s, version, model, req, refBudget, kind, ctx)) ?? 'text';
    const emitter =
      strategy === 'reference_images' && kind === 'image' ? emitImageReferences : EMITTERS[strategy];
    const emit = emitter(version, model, req, emitCtx);

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
    if (strategy === 'elements') emittedElements += 1;

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

  // Voice pass: bound voice of the FIRST character on voice-capable models.
  const explicitVoice = req.params.voice;
  const voiceOwner = targets.find(
    (t) => t.version.voice && (model.supports.voice_ids || model.capabilities.includes('tts')),
  );
  if (voiceOwner && !explicitVoice) {
    const v = emitVoice(voiceOwner.version, model);
    deepMerge(fragment, v.fragment);
    if (model.supports.voice_ids) {
      const inj = injections.find((i) => i.id === voiceOwner.version.id && i.strategy === 'elements');
      const elementLabel = inj?.slot_index ? `@Element${inj.slot_index}` : `@Element1`;
      prompt = wrapKlingSpeech(prompt, elementLabel);
    }
    injections.push({
      handle: voiceOwner.version.handle,
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
      return Boolean(version.voice) && (model.supports.voice_ids || model.capabilities.includes('tts'));
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

// The provider-facing URL for a user-attached media (explicit url or asset id).
function mediaUrl(
  media: { url?: string | undefined; asset_id?: string | undefined },
  ctx: ResolverCtx,
): string {
  if (media.url) return media.url;
  if (media.asset_id) return ctx.assetUrl(media.asset_id);
  return '';
}

// Deep-merge an emitter fragment into the accumulating provider fragment,
// concatenating arrays (elements[], input_references[], image_urls[]).
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
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

export { deepMerge };
export type { MediaRole };
