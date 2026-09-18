// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { Image as ImageIcon, Sparkles } from 'lucide-react';
import { message } from '../lib/messages';

export function CreateFoundation(): React.ReactNode {
  return (
    <section className="create-foundation">
      <div className="create-empty">
        <div className="empty-illustration">
          <ImageIcon size={34} strokeWidth={1.5} />
        </div>
        <h2>{message('create.emptyTitle')}</h2>
        <p>{message('create.emptyBody')}</p>
        <span>
          <Sparkles size={15} />
          {message('create.emptyAction')}
        </span>
      </div>
      <div className="composer-stub">
        <div className="mode-segment">
          <button className="is-on" type="button">
            {message('create.modeImage')}
          </button>
          <button type="button">{message('create.modeVideo')}</button>
          <button type="button">{message('create.modeAudio')}</button>
          <button type="button">{message('create.modeWorkflow')}</button>
        </div>
        <textarea placeholder={message('create.composerPlaceholder')} disabled />
        <div className="composer-footer">
          <button className="model-chip" type="button" disabled>
            {message('create.model')}
          </button>
          <span className="composer-spacer" />
          <span className="cost-zero" data-money="true">
            {message('create.estimate')}
          </span>
          <button
            className="generate-disabled"
            type="button"
            disabled
            title={message('create.generateDisabled')}
          >
            {message('create.generate')}
          </button>
        </div>
      </div>
      <p className="shortcut-hint">{message('create.shortcut')}</p>
    </section>
  );
}
