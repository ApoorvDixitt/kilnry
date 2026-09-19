// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import type { Estimate, ModelManifest } from '@kilnry/core';
export type { AssetListItem, AssetSort } from '@kilnry/core';

// A model as the /api/models route returns it: the registry manifest plus
// whether its provider is connected and a normalised price the interface can
// show. Derived from the core manifest so the fields never drift from the
// registry the engine actually uses.
export interface ApiModel extends ModelManifest {
  connected: boolean;
  price?: PriceView | undefined;
}

export interface PriceView {
  unit: string;
  amount_usd: number;
  fetched_at: string;
  source_url?: string;
}

// The estimate the /api/estimate route returns, straight from the core engine.
export type ApiEstimate = Estimate;
