// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The consistency badge (F-CHR-12, PRD-07 §13): high / medium / low on an
// asset's tile corner and in Provenance, never a percentage. A video's tooltip
// shows its frame minimum and mean ("min 0.38 · mean 0.52").

import { message } from '../lib/messages';

export interface BadgeView {
  level: 'high' | 'medium' | 'low';
  tooltip: string;
}

export function consistencyBadgeView(score: Record<string, unknown> | null | undefined): BadgeView | null {
  if (!score) return null;
  const level = score.badge;
  if (level !== 'high' && level !== 'medium' && level !== 'low') return null;
  const min = typeof score.min === 'number' ? score.min : null;
  const mean = typeof score.mean === 'number' ? score.mean : null;
  const frames = typeof score.frames === 'number' ? score.frames : 1;
  const character = typeof score.character === 'string' ? score.character : '';
  const figures =
    frames > 1 && min !== null && mean !== null
      ? `min ${min.toFixed(2)} · mean ${mean.toFixed(2)}`
      : min !== null
        ? `score ${min.toFixed(2)}`
        : '';
  return {
    level,
    tooltip: [message('library.consistency.tooltip').replace('{character}', character), figures]
      .filter(Boolean)
      .join(' · '),
  };
}

export function ConsistencyBadge({
  score,
}: {
  score: Record<string, unknown> | null | undefined;
}): React.ReactNode {
  const view = consistencyBadgeView(score);
  if (!view) return null;
  return (
    <span className="consistency-badge" data-level={view.level} title={view.tooltip}>
      {message(`library.consistency.${view.level}`)}
    </span>
  );
}
