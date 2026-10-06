// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// One place to write the Security audit log (PRD-16:293). The log is meant to
// answer "who changed my spend caps or looked at my recovery kit", and of the
// six classes the acceptance criterion names only the LAN toggle was reliably
// written: provider key add, remove and reveal, MCP token create and revoke,
// budget changes and recovery-kit view or regenerate wrote nothing (F-33).

import { auditEvents } from '@kilnry/db';
import { ulid } from '@kilnry/core';
import { runtimeServices } from './runtime';

/** The action names, dotted the way the shipped rows already are. */
export type AuditAction =
  | 'provider_key.add'
  | 'provider_key.remove'
  | 'provider_key.reveal'
  | 'mcp_token.create'
  | 'mcp_token.revoke'
  | 'budget.set'
  | 'recovery_kit.view'
  | 'recovery_kit.regenerate';

/**
 * Append one row. A failure to audit never fails the action the user asked for —
 * it is logged by the caller's own error path — but it is not swallowed
 * silently either: the row is written in the same request, before the answer.
 */
export async function recordAudit(
  action: AuditAction,
  target: string,
  meta: Record<string, unknown> = {},
  actor = 'user',
): Promise<void> {
  const services = await runtimeServices();
  await services.database.db.insert(auditEvents).values({ id: ulid(), actor, action, target, meta });
}
