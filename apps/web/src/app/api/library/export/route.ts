// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../server/http';
import { bundleExporter } from '../../../../server/library-export';

const Body = z.object({
  asset_ids: z.array(z.string()).min(1),
  format: z.enum(['zip', 'folder']).optional(),
  include_sidecars: z.boolean().optional(),
  metadata: z.enum(['keep', 'strip', 'embed_if_missing']).optional(),
  provenance: z.enum(['none', 'iptc', 'c2pa', 'both']).optional(),
  include_lineage: z.boolean().optional(),
  manifest: z.boolean().optional(),
  rename: z.boolean().optional(),
});

// Build an export bundle from the chosen assets (F-LIB-14). The builder writes
// stripped or labelled copies into the bundle and never modifies originals.
export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = Body.parse(await request.json());
    const exporter = await bundleExporter();
    const bundle = await exporter.export(body);
    return NextResponse.json({ bundle });
  } catch (error) {
    return errorResponse(error);
  }
}
