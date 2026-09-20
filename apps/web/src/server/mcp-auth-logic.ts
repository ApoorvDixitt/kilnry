// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Framework-free helpers for route authentication decisions (F-MCP-05), so the
// read-only mutation guard can be unit-tested without the Next server runtime.

// How a route call authenticated: the owner's session, or a Model Context
// Protocol bearer token with its scope.
export type RouteAuth = { via: 'session' } | { via: 'bearer'; scope: 'full' | 'read_only' };

// A read-only bearer token may never change state (TRD-10 §7). A session and a
// full bearer may. Returns true when the caller is allowed to mutate.
export function mayMutate(auth: RouteAuth): boolean {
  return !(auth.via === 'bearer' && auth.scope === 'read_only');
}
