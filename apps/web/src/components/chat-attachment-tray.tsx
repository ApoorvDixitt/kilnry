'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The composer's attachment tray (F-CHT-05). Assets are dragged in from the
// Library and Characters are added by handle; nothing is uploaded, because an
// attachment is only an id the agent resolves through the Library.
//
// A Character is shown as a reference rather than a picture on purpose: the
// resolver decides how a likeness is sent, so the tray says so plainly instead of
// implying the agent will be handed a face.

import { useState } from 'react';
import { message } from '../lib/messages';

/** One thing in the tray: a Library asset or a Character handle. */
export type ChatAttachment =
  { kind: 'asset'; asset_id: string; name: string } | { kind: 'character'; handle: string };

/** The drag payloads the Library offers, in order of preference. */
const ASSET_TYPES = ['application/x-kilnry-asset', 'text/plain'];

/** Read an asset id out of a drag event, if the payload carries one. */
export function assetIdFromDrag(data: { getData: (type: string) => string }): string | undefined {
  for (const type of ASSET_TYPES) {
    const value = data.getData(type).trim();
    if (value === '') continue;
    // The Library may hand over a bare id or a JSON payload describing the asset.
    if (value.startsWith('{')) {
      try {
        const parsed = JSON.parse(value) as { asset_id?: unknown; id?: unknown };
        const id = parsed.asset_id ?? parsed.id;
        if (typeof id === 'string' && id !== '') return id;
      } catch {
        continue;
      }
      continue;
    }
    if (/^[A-Za-z0-9_-]{6,64}$/.test(value)) return value;
  }
  return undefined;
}

export function attachmentKey(attachment: ChatAttachment): string {
  return attachment.kind === 'asset' ? `asset:${attachment.asset_id}` : `character:${attachment.handle}`;
}

export function attachmentLabel(attachment: ChatAttachment): string {
  return attachment.kind === 'asset' ? attachment.name : `@${attachment.handle}`;
}

export interface AttachmentTrayProps {
  attachments: ChatAttachment[];
  onAdd: (attachment: ChatAttachment) => void;
  onRemove: (key: string) => void;
}

export function ChatAttachmentTray({ attachments, onAdd, onRemove }: AttachmentTrayProps): React.ReactNode {
  const [over, setOver] = useState(false);
  const hasCharacter = attachments.some((attachment) => attachment.kind === 'character');

  return (
    <section
      className={`chat-attach-tray${over ? ' is-over' : ''}`}
      aria-label={message('chat.attachLabel')}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const assetId = assetIdFromDrag(event.dataTransfer);
        if (assetId !== undefined) onAdd({ kind: 'asset', asset_id: assetId, name: assetId });
      }}
    >
      {attachments.length === 0 ? (
        <p className="chat-attach-hint">{over ? message('chat.attachDrop') : message('chat.attachHint')}</p>
      ) : (
        <ul className="chat-attach-list">
          {attachments.map((attachment) => {
            const key = attachmentKey(attachment);
            const label = attachmentLabel(attachment);
            return (
              <li key={key} className={`chat-attach-item is-${attachment.kind}`}>
                <span className="chat-attach-kind">
                  {message(attachment.kind === 'asset' ? 'chat.attachAsset' : 'chat.attachCharacter')}
                </span>
                <span className="chat-attach-name">{label}</span>
                <button
                  type="button"
                  aria-label={message('chat.attachRemove').replace('{name}', label)}
                  onClick={() => onRemove(key)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hasCharacter ? <p className="chat-attach-note">{message('chat.attachNote')}</p> : null}
    </section>
  );
}
