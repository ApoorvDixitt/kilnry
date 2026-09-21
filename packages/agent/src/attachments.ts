// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Attaching Library assets and Characters to a message (F-CHT-05) and letting the
// model actually look at them (F-CHT-10), per TRD-11 §8.
//
// Three rules shape this module. The client never uploads bytes: an attachment is
// an id, and the model reaches the file through the loopback media route. A
// Character is a reference, never pixels — attaching @maya adds a note telling the
// model to look the Character up, so the resolver stays the single place that
// decides how a likeness is sent. And every attachment also contributes a plain
// line naming its id and path, because the tools take ids and a model that has
// seen only an image will otherwise try to describe one back.
//
// When the model cannot see a file itself — audio, video without video input, or
// any model without vision — the file is analysed first with the cheapest route
// and the text is attached instead, with a note saying what that cost.

/** What the chosen model can take in (TRD-11 §2). */
export interface AttachmentCaps {
  vision: boolean;
  /** True when the model accepts video frames directly. */
  video_in?: boolean;
  /** True for a local model, which needs bytes rather than a URL. */
  local?: boolean;
}

/** One thing the user attached: a Library asset or a Character handle. */
export type Attachment = { asset_id: string } | { handle: string };

/** The Library asset fields this module needs. */
export interface AttachedAsset {
  id: string;
  path: string;
  kind: 'image' | 'video' | 'audio' | 'other';
  mime: string;
}

/** A model message part this module can produce. */
export type AttachmentPart =
  | { type: 'text'; text: string }
  | { type: 'file'; mediaType: string; url: string }
  | { type: 'file'; mediaType: string; data: Uint8Array };

export interface ToFilePartsInput {
  attachments: Attachment[];
  caps: AttachmentCaps;
  /** Reads an asset by id; returns undefined when it is gone. */
  getAsset: (assetId: string) => Promise<AttachedAsset | undefined>;
  /** The loopback URL the model fetches the file from (TRD-05 range route). */
  assetUrl: (assetId: string) => string;
  /** Reads the bytes, for a local model that cannot fetch a URL. */
  readBytes?: (assetId: string) => Promise<Uint8Array>;
  /** Describes or transcribes a file when the model cannot see it itself. */
  analyse?: (input: {
    task: 'describe' | 'transcribe_local';
    asset_id: string;
  }) => Promise<{ text: string; cost_usd?: number }>;
}

export interface ToFilePartsResult {
  parts: AttachmentPart[];
  /** Lines for the user about what happened, including anything it cost. */
  notes: string[];
}

/** The longest edge an attached image is sent at, to keep token cost down (§8). */
export const MAX_IMAGE_EDGE_PX = 1568;

function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/**
 * Turn what the user attached into the parts the model receives (TRD-11 §8).
 * Returns the parts in attachment order plus any notes worth showing the user.
 */
export async function toFileParts(input: ToFilePartsInput): Promise<ToFilePartsResult> {
  const parts: AttachmentPart[] = [];
  const notes: string[] = [];

  for (const attachment of input.attachments) {
    // A Character is a reference: the resolver decides how a likeness is sent.
    if ('handle' in attachment) {
      parts.push({
        type: 'text',
        text: `Attached character @${attachment.handle}. Use kilnry_characters get for details.`,
      });
      continue;
    }

    const asset = await input.getAsset(attachment.asset_id);
    if (!asset) {
      notes.push(`That attachment is no longer in the Library (${attachment.asset_id}).`);
      continue;
    }

    const seeable =
      input.caps.vision &&
      (asset.kind === 'image' || (asset.kind === 'video' && input.caps.video_in === true));

    if (seeable) {
      if (input.caps.local === true && input.readBytes) {
        // A local model reads bytes; it cannot fetch the loopback URL itself.
        parts.push({ type: 'file', mediaType: asset.mime, data: await input.readBytes(asset.id) });
      } else {
        parts.push({ type: 'file', mediaType: asset.mime, url: input.assetUrl(asset.id) });
      }
    } else if (input.analyse) {
      // The model cannot see this: analyse it first and attach the text instead.
      const task = asset.kind === 'audio' ? 'transcribe_local' : 'describe';
      const analysed = await input.analyse({ task, asset_id: asset.id });
      parts.push({ type: 'text', text: `Attachment ${asset.path} (${asset.kind}): ${analysed.text}` });
      notes.push(
        typeof analysed.cost_usd === 'number' && analysed.cost_usd > 0
          ? `Analysed ${asset.path} for ${money(analysed.cost_usd)}.`
          : `Analysed ${asset.path}.`,
      );
    } else {
      // Nothing can look at it: name it so the model can still talk about it.
      parts.push({ type: 'text', text: `Attachment ${asset.path} (${asset.kind}); you cannot see it.` });
      notes.push(`You cannot see ${asset.path} in this session.`);
    }

    // The model must work with ids and paths, never bytes (TRD-10 rule 6).
    parts.push({ type: 'text', text: `asset_id=${asset.id} path=${asset.path}` });
  }

  return { parts, notes };
}

/**
 * The size an attached image is sent at: the long edge is capped, the shape is
 * kept, and an already-small image is left alone (§8).
 */
export function downscaleToLongEdge(
  width: number,
  height: number,
  maxEdge = MAX_IMAGE_EDGE_PX,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
