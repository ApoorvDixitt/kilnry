// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

import { message } from '../lib/messages';

export type Trainer = 'fal' | 'replicate' | 'higgsfield';

function trainers(): ReadonlyArray<{ trainer: Trainer; label: string; cost: number; price: string }> {
  return [
    { trainer: 'fal', label: message('characters.detail.trainerFal'), cost: 2, price: '$2.00' },
    {
      trainer: 'replicate',
      label: message('characters.detail.trainerReplicate'),
      cost: 1.46,
      price: '$1.46',
    },
    {
      trainer: 'higgsfield',
      label: message('characters.detail.trainerHiggsfield'),
      cost: 2.5,
      price: '$2.50',
    },
  ];
}

function withPrice(price: string): string {
  return message('characters.detail.trainWithPrice').replace('{price}', price);
}

// The Train control of the Identities tab (F-CHR-07). A Character that reads
// as a minor can never be trained, whatever its consent (PRD-07 §7, F-07); a
// real person needs consent recorded first. Each disabled button says why.
export function TrainerCards({
  training,
  consentBlocks,
  minorSuspected,
  onPick,
}: {
  training: string | null;
  consentBlocks: boolean;
  minorSuspected: boolean;
  onPick: (choice: { trainer: Trainer; cost: number }) => void;
}): React.ReactNode {
  return (
    <div className="character-trainer-cards">
      {trainers().map((card) => {
        const blocked = minorSuspected || consentBlocks;
        const title = minorSuspected
          ? message('characters.minorRefusal')
          : consentBlocks
            ? message('characters.detail.trainConsentTooltip')
            : withPrice(card.price);
        return (
          <div key={card.trainer} className="character-trainer-card">
            <h4>{card.label}</h4>
            <button
              className="btn primary"
              type="button"
              disabled={training !== null || blocked}
              title={title}
              onClick={() => onPick({ trainer: card.trainer, cost: card.cost })}
            >
              {training === card.trainer ? message('characters.detail.training') : withPrice(card.price)}
            </button>
          </div>
        );
      })}
      {minorSuspected ? (
        <p className="muted character-minor-refusal">{message('characters.minorRefusal')}</p>
      ) : null}
    </div>
  );
}
