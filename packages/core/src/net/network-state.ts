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
