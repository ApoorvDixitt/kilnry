// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startRuntime } = await import('./server/runtime');
    void startRuntime();
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string },
  context: { routerKind: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { log } = await import('./server/log');
    log.error({ err: error, path: request.path, router_kind: context.routerKind }, 'request_error');
  }
}
