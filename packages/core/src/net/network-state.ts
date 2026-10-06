// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The process's last-known network state (F40, TRD-11 §10). Chat's offline mode
// is keyed on this rather than on whether the resolved model is a local Ollama
// one: a cloud model with the network down must drop its spend tools, and a
// local model with the network up need not. The state is observed, not probed —
// Kilnry never makes a network call just to check connectivity, which would
// break the zero-egress guarantee when no key is configured. Instead the job
// engine marks the network offline when a provider request fails with a
// connection error and online again when one succeeds. Default is online so a
// fresh process does not hide the spend tools before any request has run.

import { eq } from 'drizzle-orm';
import { settings, type DatabaseState } from '@kilnry/db';

/**
 * PRD-15 §Offline: a generation accepted while the network is offline sits
 * queued under this exact label. The engine held nothing — a connection error
 * failed the job — so the label existed only in the Jobs view's own copy
 * (F-117).
 */
export const WAITING_FOR_NETWORK = 'Waiting for network';

/** How long a held job waits before looking again (acceptance criterion 2). */
export const NETWORK_HOLD_SECONDS = 5;

let online = true;

/** True when the last observed provider request reached the network. */
export function isNetworkOnline(): boolean {
  return online;
}

/** Record that a provider request reached the network. */
export function markNetworkOnline(): void {
  online = true;
}

/** Record that a provider request failed to reach the network (offline). */
export function markNetworkOffline(): void {
  online = false;
}

/**
 * The state the interface reads. The in-process flag above is the detector, but
 * a Next route handler does not always share a module instance with the worker
 * that observed the failure — /api/health answered `stage: starting_workers`
 * from its own instance while the engine was already holding a job — so the
 * transition is also written to the settings table, which every instance shares
 * (F-117).
 */
export const NETWORK_STATE_SETTING = 'net.offline_since';

export async function persistNetworkState(state: DatabaseState, offlineSince: string | null): Promise<void> {
  await state.ready;
  if (offlineSince === null) {
    await state.db.delete(settings).where(eq(settings.key, NETWORK_STATE_SETTING));
    return;
  }
  await state.db
    .insert(settings)
    .values({ key: NETWORK_STATE_SETTING, value: offlineSince })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: offlineSince, updatedAt: new Date() },
    });
}

/** When the last observed failure happened, or null when the network is up. */
export async function networkOfflineSince(state: DatabaseState): Promise<string | null> {
  await state.ready;
  const rows = await state.db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, NETWORK_STATE_SETTING))
    .limit(1);
  const value = rows[0]?.value;
  return typeof value === 'string' ? value : null;
}
