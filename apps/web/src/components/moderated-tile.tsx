'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { ShieldAlert } from 'lucide-react';
import { message } from '../lib/messages';

export interface ModeratedInfo {
  provider: string;
  reason?: string | undefined;
  // A compute charge the provider still billed despite blocking, if any.
  computeUsd?: number | undefined;
}

// The headline for a moderated result: "Not charged" unless the provider billed
// for compute it used, in which case the exact amount is named.
export function moderatedTitle(info: ModeratedInfo): string {
  if (info.computeUsd && info.computeUsd > 0) {
    return message('create.moderated.compute')
      .replace('{provider}', info.provider)
      .replace('{amount}', `$${info.computeUsd.toFixed(2)}`);
  }
  return message('create.moderated.title');
}

export function ModeratedTile({
  info,
  onEditPrompt,
  onTryAnother,
  onDismiss,
}: {
  info: ModeratedInfo;
  onEditPrompt?: () => void;
  onTryAnother?: () => void;
  onDismiss?: () => void;
}): React.ReactNode {
  return (
    <div className="moderated-tile" role="group" aria-label={message('create.moderated.title')}>
      <ShieldAlert aria-hidden size={22} strokeWidth={1.6} />
      <p className="moderated-title">{moderatedTitle(info)}</p>
      {info.reason ? <p className="moderated-reason">{info.reason}</p> : null}
      <div className="moderated-actions">
        <button type="button" onClick={onEditPrompt}>
          {message('create.moderated.editPrompt')}
        </button>
        <button type="button" onClick={onTryAnother}>
          {message('create.moderated.tryAnother')}
        </button>
        <button type="button" onClick={onDismiss}>
          {message('create.moderated.dismiss')}
        </button>
      </div>
    </div>
  );
}
