// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { eq } from 'drizzle-orm';
import { characters, type DatabaseState } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { MINOR_REFUSAL } from './minor.js';
import { loadVersion } from './store.js';

export type ConsentStatus = 'self' | 'written' | 'none' | 'n/a';

// The consent state of a Character, read for the gate and the detail screen.
export interface ConsentState {
  is_real_person: boolean;
  status: ConsentStatus;
  evidence_asset_id?: string;
  granted_at?: string;
  license: string;
}

export interface SetConsentInput {
  is_real_person: boolean;
  // The three choices offered in the gate: "This is me" (self), "I have written
  // permission" (written, evidence attached), "Neither" (none, training blocked).
  status: ConsentStatus;
  evidence_asset_id?: string | undefined;
  license?: 'private' | 'cc0' | 'cc-by' | 'commercial-release' | undefined;
}

// Consent is satisfied for training and likeness send when the person is not real,
// or when they are and consent is 'self' or 'written' (TRD-14 §9).
export function consentSatisfied(state: Pick<ConsentState, 'is_real_person' | 'status'>): boolean {
  if (!state.is_real_person) return true;
  return state.status === 'self' || state.status === 'written';
}

// Read the consent state of a Character.
export async function getConsent(db: DatabaseState, characterId: string): Promise<ConsentState> {
  const rows = await db.db.select().from(characters).where(eq(characters.id, characterId)).limit(1);
  const row = rows[0];
  if (!row) throw new KilnryError('NOT_FOUND', 'Character not found.');
  return {
    is_real_person: row.isRealPerson,
    status: row.consentStatus as ConsentStatus,
    license: row.license,
    ...(row.consentEvidenceAssetId ? { evidence_asset_id: row.consentEvidenceAssetId } : {}),
    ...(row.consentGrantedAt ? { granted_at: row.consentGrantedAt.toISOString() } : {}),
  };
}

// Record the answer to the consent gate. "I have written permission" requires an
// attached release (evidence_asset_id). consent_granted_at is stamped for self and
// written; a real person set to none clears the grant and keeps training blocked.
export async function setConsent(
  db: DatabaseState,
  characterId: string,
  input: SetConsentInput,
): Promise<ConsentState> {
  if (input.is_real_person && input.status === 'written' && !input.evidence_asset_id) {
    throw new KilnryError('INVALID_INPUT', 'Attach the written permission before choosing it.');
  }
  const status: ConsentStatus = input.is_real_person ? input.status : 'n/a';
  const granted = status === 'self' || status === 'written' ? new Date() : null;
  const existing = await db.db.select().from(characters).where(eq(characters.id, characterId)).limit(1);
  if (!existing[0]) throw new KilnryError('NOT_FOUND', 'Character not found.');
  await db.db
    .update(characters)
    .set({
      isRealPerson: input.is_real_person,
      consentStatus: status,
      consentEvidenceAssetId: input.evidence_asset_id ?? null,
      consentGrantedAt: granted,
      license: input.license ?? existing[0].license,
      updatedAt: new Date(),
    })
    .where(eq(characters.id, characterId));
  return getConsent(db, characterId);
}

// The hard invariant: refuse training or a likeness send for a real person until
// consent is set. Throws CONFIRMATION_REQUIRED with reason 'consent_required' so
// the interface can show the gate and the Model Context Protocol client can prompt.
export async function assertConsentForTraining(db: DatabaseState, characterId: string): Promise<void> {
  await assertNotMinor(db, characterId);
  const consent = await getConsent(db, characterId);
  if (!consentSatisfied(consent)) {
    throw new KilnryError('CONFIRMATION_REQUIRED', 'Set consent before training or sending this likeness.', {
      details: { reason: 'consent_required', character_id: characterId },
    });
  }
}

// Refuse an export bundle for a real person whose consent is not recorded
// (PRD-07 §7 matrix "Export bundle ✗" under none, §14 "Blocked when
// consent.status = none for real people"). A non-real character always exports.
export async function assertConsentForExport(db: DatabaseState, characterId: string): Promise<void> {
  const consent = await getConsent(db, characterId);
  if (!consentSatisfied(consent)) {
    throw new KilnryError('CONFIRMATION_REQUIRED', 'Record permission first.', {
      details: { reason: 'consent_required', character_id: characterId },
    });
  }
}

// "Public figures, celebrities, and minors cannot be trained or cloned in
// Kilnry regardless of consent" (PRD-07 §7, F-07). Checked on the current
// version before any consent branch, for real and fictional Characters alike.
// The code is INVALID_INPUT, not CONFIRMATION_REQUIRED: TRD-20 reserves that
// code for a spend a confirmation can unlock, and no confirmation unlocks this.
export async function assertNotMinor(db: DatabaseState, characterId: string): Promise<void> {
  const version = await loadVersion(db, characterId);
  if (version.minor_suspected) {
    throw new KilnryError('INVALID_INPUT', MINOR_REFUSAL, {
      details: { reason: 'minor_suspected', character_id: characterId },
    });
  }
}
