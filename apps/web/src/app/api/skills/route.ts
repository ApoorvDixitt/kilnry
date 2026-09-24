// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// List every skill for Settings › Skills (F-SKL-04, F-SET-06). Each entry
// carries its source (shipped or installed), licence, tags, and whether it is
// enabled, so the settings surface can show shipped and installed skills
// together with an enable toggle. A skill disabled here disappears from
// kilnry_skills list and from Chat.

import { NextResponse } from 'next/server';
import { errorResponse, requireSession } from '../../../server/http';
import { runtimeServices } from '../../../server/runtime';
import { listAllSkills } from '../../../server/skills';

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const services = await runtimeServices();
    const skills = await listAllSkills(services.database);
    return NextResponse.json({ skills });
  } catch (error) {
    return errorResponse(error);
  }
}
