'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useState } from 'react';
import { Paperclip, Pin, X } from 'lucide-react';
import { message } from '../lib/messages';
import {
  isBlockedUrl,
  validateAttachmentRoles,
  type Attachment,
  type AttachmentRole,
  type RoleLimit,
} from '../lib/attachments';

const ROLE_ORDER: AttachmentRole[] = [
  'start_frame',
  'end_frame',
  'reference',
  'style',
  'product',
  'audio',
  'source',
  'mask',
  'video',
];

function roleLabel(role: AttachmentRole): string {
  return message(`create.tray.role.${role}`);
}

export function AttachmentTray({
  attachments,
  limits,
  onChange,
  onImportUrl,
}: {
  attachments: Attachment[];
  limits: RoleLimit[];
  onChange: (attachments: Attachment[]) => void;
  onImportUrl?: (url: string) => void;
}): React.ReactNode {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  const allowedRoles = ROLE_ORDER.filter((role) => limits.some((limit) => limit.role === role));
  const roleError = validateAttachmentRoles(attachments, limits);

  function setRole(id: string, role: AttachmentRole): void {
    onChange(attachments.map((item) => (item.id === id ? { ...item, role } : item)));
  }

  function togglePin(id: string): void {
    onChange(attachments.map((item) => (item.id === id ? { ...item, pinned: !item.pinned } : item)));
  }

  function remove(id: string): void {
    onChange(attachments.filter((item) => item.id !== id));
  }

  function submitUrl(): void {
    const value = url.trim();
    if (!value) return;
    if (isBlockedUrl(value)) {
      setUrlError(message('create.tray.blockedUrl'));
      return;
    }
    setUrlError(null);
    setUrl('');
    onImportUrl?.(value);
  }

  return (
    <div className="attachment-tray" aria-label={message('create.tray.title')}>
      {attachments.length > 0 ? (
        <ul className="attachment-list">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="attachment-item" data-kind={attachment.kind}>
              <span className="attachment-thumb" aria-hidden />
              <select
                aria-label={message('create.tray.roleLabel').replace('{name}', attachment.name)}
                value={attachment.role}
                onChange={(event) => setRole(attachment.id, event.target.value as AttachmentRole)}
              >
                {allowedRoles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={`attachment-pin${attachment.pinned ? ' is-pinned' : ''}`}
                aria-pressed={attachment.pinned}
                aria-label={message('create.tray.pin')}
                onClick={() => togglePin(attachment.id)}
              >
                <Pin aria-hidden size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                className="attachment-remove"
                aria-label={message('create.tray.remove')}
                onClick={() => remove(attachment.id)}
              >
                <X aria-hidden size={13} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="attachment-intake">
        <button type="button" className="attachment-attach">
          <Paperclip aria-hidden size={14} strokeWidth={1.75} />
          {message('create.tray.attach')}
        </button>
        <input
          type="url"
          className="attachment-url"
          value={url}
          placeholder={message('create.tray.urlPlaceholder')}
          aria-label={message('create.tray.urlPlaceholder')}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitUrl();
            }
          }}
        />
      </div>

      {urlError ? (
        <p className="attachment-error" role="alert">
          {urlError}
        </p>
      ) : null}
      {roleError ? (
        <p className="attachment-error" role="alert">
          {roleError}
        </p>
      ) : null}
    </div>
  );
}
