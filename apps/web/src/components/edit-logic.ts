// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers for Create edit mode (F-CRE-10), unit-tested without a
// browser. Edit mode picks an existing asset as the Source, turns the prompt
// into an instruction, and routes to image_edit or video2video — never to
// text-to-image.

import { editKindFor } from './batch-logic';
import type { ComposerMode } from './model-picker';

// The Source attachment that puts the composer into edit mode. asset_id is the
// Library asset being refined; kind decides the route and the composer mode.
export interface EditSource {
  asset_id: string;
  kind: 'image' | 'video';
  file: string;
}

// A minimal shape of the Library asset detail the edit surface needs. The detail
// route returns much more; edit mode reads only these three fields.
export interface EditAssetDetail {
  id: string;
  path: string;
  kind: string;
}

// The filename shown in the "Editing <file>" banner: the last path segment.
export function filenameOf(path: string): string {
  const parts = path.split('/').filter((part) => part.length > 0);
  return parts.length > 0 ? parts[parts.length - 1]! : path;
}

// Build an EditSource from a Library asset detail, or null when the asset is not
// an image or a video (only those two kinds can be edited).
export function editSourceFromDetail(detail: EditAssetDetail): EditSource | null {
  if (detail.kind !== 'image' && detail.kind !== 'video') return null;
  return { asset_id: detail.id, kind: detail.kind, file: filenameOf(detail.path) };
}

// Opening Edit switches the composer mode to match the source kind (F-CRE-10
// AC 1): an image source edits in Image mode, a video source in Video mode.
export function editModeForKind(kind: 'image' | 'video'): ComposerMode {
  return kind === 'video' ? 'video' : 'image';
}

// The capability an edit source routes through: image_edit for images, the
// video2video capability for videos. This is the provider-facing capability the
// engine picks a model for; the stored job kind comes from editKindFor.
export function editCapabilityFor(kind: 'image' | 'video'): 'image_edit' | 'video2video' {
  return kind === 'video' ? 'video2video' : 'image_edit';
}

// The estimate and generate payload for an edit: the source is recorded in
// medias[] with role "source", the kind is the edit kind (never text2image), and
// the prompt is carried as the instruction. Params are merged so aspect and
// quality still flow through the same estimate route (F-CRE-10 AC 2).
export function editPayload(
  source: EditSource,
  input: { prompt: string; model: string; params: Record<string, unknown> },
): {
  kind: 'image_edit' | 'video_edit';
  capability: 'image_edit' | 'video2video';
  prompt: string;
  model: string;
  params: Record<string, unknown>;
  medias: Array<{ role: 'source'; asset_id: string }>;
  count: number;
} {
  return {
    kind: editKindFor(source.kind),
    capability: editCapabilityFor(source.kind),
    prompt: input.prompt,
    model: input.model,
    params: { quality: 'standard', ...input.params },
    medias: [{ role: 'source', asset_id: source.asset_id }],
    count: 1,
  };
}
