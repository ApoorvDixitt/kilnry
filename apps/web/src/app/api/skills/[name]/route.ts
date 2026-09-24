// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// One skill's actions for Settings › Skills (F-SKL-04, F-SET-06). GET previews it
// (its SKILL.md body, frontmatter and file list); PATCH sets its enable state,
// which the loader honours so a disabled skill drops from kilnry_skills list and
// from Chat; DELETE uninstalls an installed skill by removing its folder (a
// shipped skill cannot be uninstalled).

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { loadSkill } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';
import { setSkillEnabled, skillRoots, uninstallSkill } from '../../../../server/skills';

const PatchInput = z.object({ enabled: z.boolean() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { name } = await context.params;
    const services = await runtimeServices();
    const skill = await loadSkill(await skillRoots(services.database), name);
    if (!skill) return NextResponse.json({ error: 'No enabled skill by that name.' }, { status: 404 });
    return NextResponse.json({ skill });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ name: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { name } = await context.params;
    const body = PatchInput.parse(await request.json());
    const services = await runtimeServices();
    await setSkillEnabled(services.database, name, body.enabled);
    return NextResponse.json({ ok: true, name, enabled: body.enabled });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ name: string }> },
): Promise<Response> {
  try {
    await requireSession();
    const { name } = await context.params;
    const result = await uninstallSkill(name);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return errorResponse(error);
  }
}
