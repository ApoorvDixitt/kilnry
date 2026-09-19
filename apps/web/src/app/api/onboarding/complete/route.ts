// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import { loadConfig, saveConfig } from '@kilnry/core';
import { putSetting } from '@kilnry/db';
import { errorResponse, requireSession } from '../../../../server/http';

export async function POST(): Promise<Response> {
  try {
    await requireSession();
    const config = loadConfig();
    saveConfig({ ...config, onboarding_complete: true });
    await putSetting('onboarding_step', 4, config.data_dir);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
