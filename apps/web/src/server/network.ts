// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The one answer to "is the network up?" that every server path reads (F40,
// D-70). Chat had two: the system prompt used the observed network state while
// the tool gating used whether the resolved model was a local Ollama one, so a
// local model with the network up lost the cloud spend tools and a cloud model
// with the network down kept them (F-39).
//
// The in-process flag is not shared between Next's per-route module instances,
// so the persisted transition decides and the flag is only a second opinion
// within this instance (F-117).

import { networkOfflineSince } from '@kilnry/core';
import type { DatabaseState } from '@kilnry/db';

export async function networkOnline(state: DatabaseState): Promise<boolean> {
  // The stored transition only. The in-process flag belongs to one Next module
  // instance: a request that failed in the worker's instance left the chat
  // route's own flag untouched, and vice versa, so reading both ANDed together
  // reported offline whenever any instance had ever seen a failure.
  return (await networkOfflineSince(state)) === null;
}
