// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// One in-process async mutex per absolute path (TRD-05 §3): the worker (a run's
// drive), the Library watcher, and a UI action can all touch the same asset at
// once. Without this, two callers each read "no sidecar", each mint their own
// ULID for the same file, and both upsert on-conflict-(id); the ids differ, so
// the second violates the unique `path` and the whole query is rejected
// (observed on CI as "burn: Failed query: insert into assets …"). Serialized,
// the second caller reads the sidecar the first wrote and upserts the same id.

const chains = new Map<string, Promise<unknown>>();

/**
 * Run `fn` with exclusive access to `absPath`, serialized against any other
 * `withPathLock` on the same absolute path. Releases in `finally`; the map
 * entry is deleted once this call's link is the tail of the chain, so an idle
 * path holds no memory.
 */
export async function withPathLock<T>(absPath: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(absPath) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mine = previous.then(() => gate);
  chains.set(absPath, mine);
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    // Drop the entry only if no later caller chained onto this link, so an idle
    // path holds no memory while an active one keeps its place in line.
    queueMicrotask(() => {
      if (chains.get(absPath) === mine) chains.delete(absPath);
    });
  }
}
