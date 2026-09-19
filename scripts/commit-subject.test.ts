// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { checkCommitSubject } from './commit-subject';

describe('checkCommitSubject', () => {
  it('accepts a plain-English feature subject with an identifier', () => {
    expect(
      checkCommitSubject({
        message:
          'feat(create): show the estimated cost before the Generate button is pressed (F-CRE-06)\n\nThe composer now shows a dollar estimate first.',
        touchesProductCode: true,
      }),
    ).toBeNull();
  });

  it('accepts a chore that touches only tooling without a feature identifier', () => {
    expect(
      checkCommitSubject({
        message: 'chore(repository): keep coding-agent config folders out of the repository (D-47)',
        touchesProductCode: false,
      }),
    ).toBeNull();
  });

  it('accepts a docs commit without a feature identifier', () => {
    expect(
      checkCommitSubject({
        message: 'docs(status): record the audited M2 completion',
        touchesProductCode: true,
      }),
    ).toBeNull();
  });

  it('exempts a release commit from the subject shape', () => {
    expect(checkCommitSubject({ message: 'chore(release): v0.1.0', touchesProductCode: true })).toBeNull();
  });

  it('rejects a subject that is not in the type(area): summary shape', () => {
    expect(checkCommitSubject({ message: 'update the cost strip', touchesProductCode: true })).toMatch(
      /type\(area\)/,
    );
  });

  it('rejects a feat on product code that omits the feature identifier', () => {
    expect(
      checkCommitSubject({
        message: 'feat(create): add the cost strip to the composer',
        touchesProductCode: true,
      }),
    ).toMatch(/feature identifier/);
  });

  it('allows a feat with no feature identifier when it touches only tooling', () => {
    expect(
      checkCommitSubject({
        message: 'feat(repository): add a helper to the build scripts',
        touchesProductCode: false,
      }),
    ).toBeNull();
  });

  it('rejects vague banned words', () => {
    for (const subject of [
      'chore(create): WIP on the composer',
      'fix(create): misc fixes (F-CRE-06)',
      'chore(library): cleanup',
      'chore(create): stabilize the grid',
      'chore(create): various tweaks',
      'chore(create): finish the composer',
    ]) {
      expect(checkCommitSubject({ message: subject, touchesProductCode: true })).not.toBeNull();
    }
  });

  it('rejects a "complete M3" subject', () => {
    expect(
      checkCommitSubject({ message: 'feat(create): complete M3 (F-CRE-06)', touchesProductCode: true }),
    ).toMatch(/complete M/);
  });

  it('rejects a subject longer than 100 characters', () => {
    const subject = `feat(create): ${'a'.repeat(120)} (F-CRE-06)`;
    expect(checkCommitSubject({ message: subject, touchesProductCode: true })).toMatch(/at most 100/);
  });

  it('rejects a prohibited trailer in the body', () => {
    expect(
      checkCommitSubject({
        message:
          'feat(create): show the estimated cost before Generate (F-CRE-06)\n\nBody here.\n\nCo-authored-by: Someone <someone@example.com>',
        touchesProductCode: true,
      }),
    ).toMatch(/trailer/);
  });

  it('rejects a trailer even on an exempt release commit', () => {
    expect(
      checkCommitSubject({
        message: 'chore(release): v0.1.0\n\nSigned-off-by: Someone <someone@example.com>',
        touchesProductCode: true,
      }),
    ).toMatch(/trailer/);
  });

  it('leaves git-generated merge commits alone', () => {
    expect(
      checkCommitSubject({ message: "Merge branch 'main' into feature", touchesProductCode: true }),
    ).toBeNull();
  });
});
