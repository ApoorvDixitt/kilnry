// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Ollama detection endpoint (F-PRV-08). It probes the loopback Ollama runtime
// and returns whether it is present and which models it has. The probe is
// loopback-only and never throws on a missing runtime, so when Ollama is absent
// this returns { detected: false } and nothing leaves the machine.

import { NextResponse } from 'next/server';
import { detectOllama } from '@kilnry/providers';
import { loadConfig } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const config = loadConfig();
    const base_url =
      typeof (config as { ollama_url?: unknown }).ollama_url === 'string'
        ? (config as { ollama_url?: string }).ollama_url
        : undefined;
    const detection = await detectOllama(base_url ? { base_url } : {});
    return NextResponse.json(detection);
  } catch (error) {
    return errorResponse(error);
  }
}
