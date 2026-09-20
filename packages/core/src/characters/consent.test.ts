// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase } from '@kilnry/db';
import { ulid } from '../ids.js';
import { createCharacter } from './store.js';
import { assertConsentForTraining, consentSatisfied, getConsent, setConsent } from './consent.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function db(): Promise<Awaited<ReturnType<typeof createDatabase>>> {
  const root = mkdtempSync(join(tmpdir(), 'kilnry-consent-'));
  const state = createDatabase(join(root, 'data'), { memory: true });
  disposers.push(async () => {
    await closeDatabaseState(state);
    rmSync(root, { recursive: true, force: true });
  });
  await state.ready;
  return state;
}

describe('consentSatisfied', () => {
  it('is always satisfied for a character that is not a real person', () => {
    expect(consentSatisfied({ is_real_person: false, status: 'n/a' })).toBe(true);
  });

  it('is satisfied for a real person only with self or written consent', () => {
    expect(consentSatisfied({ is_real_person: true, status: 'self' })).toBe(true);
    expect(consentSatisfied({ is_real_person: true, status: 'written' })).toBe(true);
    expect(consentSatisfied({ is_real_person: true, status: 'none' })).toBe(false);
    expect(consentSatisfied({ is_real_person: true, status: 'n/a' })).toBe(false);
  });
});

describe('the consent gate blocks training for a real person until consent is set', () => {
  it('refuses training with CONFIRMATION_REQUIRED and reason consent_required', async () => {
    const state = await db();
    const head = await createCharacter(state, {
      handle: 'real_person',
      kind: 'character',
      display_name: 'Real Person',
      is_real_person: true,
    });
    await expect(assertConsentForTraining(state, head.id)).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
      options: { details: { reason: 'consent_required', character_id: head.id } },
    });
  });

  it('allows training after "This is me" (self) and stamps consent_granted_at', async () => {
    const state = await db();
    const head = await createCharacter(state, {
      handle: 'me',
      kind: 'character',
      display_name: 'Me',
      is_real_person: true,
    });
    const consent = await setConsent(state, head.id, { is_real_person: true, status: 'self' });
    expect(consent.status).toBe('self');
    expect(consent.granted_at).toBeDefined();
    await expect(assertConsentForTraining(state, head.id)).resolves.toBeUndefined();
  });

  it('requires attached evidence for "I have written permission"', async () => {
    const state = await db();
    const head = await createCharacter(state, {
      handle: 'friend',
      kind: 'character',
      display_name: 'Friend',
      is_real_person: true,
    });
    await expect(setConsent(state, head.id, { is_real_person: true, status: 'written' })).rejects.toThrow(
      /written permission/,
    );
    const evidence = ulid();
    const consent = await setConsent(state, head.id, {
      is_real_person: true,
      status: 'written',
      evidence_asset_id: evidence,
    });
    expect(consent.status).toBe('written');
    expect(consent.evidence_asset_id).toBe(evidence);
    await expect(assertConsentForTraining(state, head.id)).resolves.toBeUndefined();
  });

  it('keeps training blocked after "Neither" (none)', async () => {
    const state = await db();
    const head = await createCharacter(state, {
      handle: 'other',
      kind: 'character',
      display_name: 'Other',
      is_real_person: true,
    });
    const consent = await setConsent(state, head.id, { is_real_person: true, status: 'none' });
    expect(consent.status).toBe('none');
    expect(consent.granted_at).toBeUndefined();
    await expect(assertConsentForTraining(state, head.id)).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    });
  });

  it('never blocks a fictional character', async () => {
    const state = await db();
    const head = await createCharacter(state, { handle: 'maya', kind: 'character', display_name: 'Maya' });
    const consent = await getConsent(state, head.id);
    expect(consent.status).toBe('n/a');
    await expect(assertConsentForTraining(state, head.id)).resolves.toBeUndefined();
  });
});
