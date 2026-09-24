// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Install a community skill (F-SKL-03, TRD-13 §7). A skill arrives one of two
// ways through this route: a set of files dropped in Settings › Skills (a folder
// or a single SKILL.md pasted), or a URL to a raw SKILL.md fetched under the
// same SSRF rules every outbound request uses. Either way the files are handed
// to installSkill, which runs every validation rule before writing anything and
// refuses an executable script, an oversized skill, a path escape, or a name
// that collides with a shipped skill. A prompt-injection match is returned as a
// warning the caller re-submits with acknowledge=true to override. Nothing from
// the skill is ever executed (D-45); only text is copied.

import { NextResponse } from 'next/server';
import { installSkill, loadConfig, safeFetch, type SkillFileSet } from '@kilnry/core';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../../server/http';
import { shippedSkillNames } from '../../../../server/skills';

const FileInput = z.object({
  path: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[^\0]+$/),
  // The file's text. A skill is text (SKILL.md, Markdown, JSON step files); a
  // binary asset would arrive base64-encoded, but V1 installs text skills.
  content: z.string().max(2_000_000),
});

const InstallInput = z
  .object({
    files: z.array(FileInput).max(200).optional(),
    url: z.string().url().optional(),
    acknowledge_warnings: z.boolean().optional(),
  })
  .refine((value) => value.files !== undefined || value.url !== undefined, {
    message: 'Provide either dropped files or a URL to install.',
  });

const encoder = new TextEncoder();

// A raw SKILL.md URL becomes a one-file skill; the file set keys are the paths
// relative to the skill folder.
async function fetchSkillMd(url: string): Promise<SkillFileSet> {
  const response = await safeFetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`The skill URL returned ${response.status}.`);
  }
  const text = await response.text();
  const files: SkillFileSet = new Map();
  files.set('SKILL.md', encoder.encode(text));
  return files;
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const body = InstallInput.parse(await request.json());
    const config = await loadConfig();

    const files: SkillFileSet =
      body.files !== undefined
        ? new Map(body.files.map((file) => [file.path, encoder.encode(file.content)] as const))
        : await fetchSkillMd(body.url!);

    const result = await installSkill({
      files,
      dataDir: config.data_dir,
      shippedNames: await shippedSkillNames(),
      ...(body.url === undefined ? {} : { source: body.url }),
      ...(body.acknowledge_warnings === undefined ? {} : { acknowledgeWarnings: body.acknowledge_warnings }),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return errorResponse(error);
  }
}
