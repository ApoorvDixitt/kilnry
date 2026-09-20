// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers for offline resilience on the Jobs screen (F-JOB-05),
// unit-tested without a browser. Kilnry treats a job as still owed while the
// network is down: queued jobs wait and running jobs are re-polled by their
// provider request id when the network returns.

// The label a queued job shows while the network is down (PRD-15 §5).
export const WAITING_FOR_NETWORK = 'Waiting for network';

// A job status is non-terminal when the network returning could still change it.
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'moderated']);

export function isNonTerminal(status: string): boolean {
  return !TERMINAL.has(status);
}

// How many of these jobs would resume when the network returns.
export function resumableCount(rows: Array<{ status: string }>): number {
  return rows.filter((row) => isNonTerminal(row.status)).length;
}

// The reconnect toast copy (PRD-15 §5, verbatim shape): "Back online. Resumed N
// jobs." Uses the singular form for one job.
export function resumedToast(count: number): string {
  const noun = count === 1 ? 'job' : 'jobs';
  return `Back online. Resumed ${count} ${noun}.`;
}
