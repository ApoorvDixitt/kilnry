// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The version switcher in the Character detail header (F-CHR-10, PRD-07 §5, §11).
// It lists every version with its frozen marker and job count, marks the current
// one, calls set_current when another is chosen, and explains why editing a
// frozen version forks a new one. It is a plain control with no navigation so it
// can be rendered and asserted in the browser test harness.

import { message } from '../lib/messages';
import { versionLabel, type VersionRowView } from './character-detail-logic';

export function VersionSwitcher({
  versions,
  current,
  onSelect,
}: {
  versions: VersionRowView[];
  current: number;
  onSelect: (version: number) => void;
}): React.ReactNode {
  const currentRow = versions.find((row) => row.version === current);
  return (
    <div className="character-version-switcher">
      <label className="visually-hidden" htmlFor="character-version-select">
        {message('characters.detail.versionLabel')}
      </label>
      <select
        id="character-version-select"
        className="character-version-select"
        aria-label={message('characters.detail.versionLabel')}
        value={current}
        onChange={(event) => onSelect(Number(event.target.value))}
      >
        {versions.map((row) => (
          <option key={row.version} value={row.version}>
            {versionLabel(row)}
          </option>
        ))}
      </select>
      {currentRow?.frozen ? (
        <p className="character-version-note muted">{message('characters.detail.versionFrozen')}</p>
      ) : null}
    </div>
  );
}
