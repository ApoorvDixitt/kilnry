// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The words a workflow card uses (UX-09). The YAML's `description` is written
// for the agent and may cite spec sections and feature ids; a capability id
// such as `tts` is an acronym. What a user reads is plain.

// The first sentence of a description without the spec citations an agent
// reads — "(W10, F-WFL-08, PRD-10 §9)" — for a workflow that has no summary.
export function firstSentence(description: string): string {
  const plain = description
    .replace(/\s*\([^)]*\b(?:F-[A-Z]{3}-\d+|PRD-\d+|TRD-\d+|W\d+)\b[^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const match = /^.*?[.!?](?=\s|$)/.exec(plain);
  return (match ? match[0] : plain).trim();
}

// Capability ids as words, for the card's requirement chips and its "Needs a
// provider for …" note (UX-09: "spell text-to-speech").
const CAPABILITY_LABELS: Record<string, string> = {
  text2image: 'text-to-image',
  image_edit: 'image editing',
  text2video: 'text-to-video',
  image2video: 'image-to-video',
  reference2video: 'reference-to-video',
  video2video: 'video-to-video',
  video_edit: 'video editing',
  motion_transfer: 'motion transfer',
  lipsync: 'lip-sync',
  avatar: 'talking avatar',
  tts: 'text-to-speech',
  voice_clone: 'voice cloning',
  stt: 'speech-to-text',
  music: 'music',
  sfx: 'sound effects',
  upscale_image: 'image upscaling',
  upscale_video: 'video upscaling',
  bg_remove: 'background removal',
  reframe_image: 'image reframing',
  reframe_video: 'video reframing',
  outpaint: 'outpainting',
  '3d': '3D',
  vlm: 'image understanding',
  llm: 'language model',
  face_embed: 'face matching',
  train_lora: 'LoRA training',
  train_identity: 'identity training',
};

export function capabilityLabel(capability: string): string {
  return CAPABILITY_LABELS[capability] ?? capability.replace(/_/g, ' ');
}
