// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Import a .kilnry-character.zip bundle (F-CHR-14, TRD-14 §15). The UI uploads
// the zip as multipart/form-data; the file is stored under the data dir before
// importing (never a client-supplied absolute path). A JSON body with a
// server-resolved bundle_path is still accepted for the automated check.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { importCharacterBundle, loadConfig, ulid } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { characterBundleServices } from '../../../../server/character-bundle';

const JsonBody = z.object({
  bundle_path: z.string().min(1),
  on_conflict: z.enum(['version', 'rename']).optional(),
  confirm_real_person: z.boolean().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const services = await characterBundleServices();
    const contentType = request.headers.get('content-type') ?? '';

    let bundlePath: string;
    let onConflict: 'version' | 'rename' | undefined;
    let confirmRealPerson: boolean | undefined;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('bundle');
      if (!(file instanceof File)) {
        return errorResponse(new Error('Attach the bundle .zip as the "bundle" field.'));
      }
      const dir = join(loadConfig().data_dir, 'bundles');
      await mkdir(dir, { recursive: true });
      bundlePath = join(dir, `upload-${ulid()}.zip`);
      await writeFile(bundlePath, Buffer.from(await file.arrayBuffer()));
      const conflict = form.get('on_conflict');
      onConflict = conflict === 'version' || conflict === 'rename' ? conflict : undefined;
      confirmRealPerson = form.get('confirm_real_person') === 'true';
    } else {
      const body = JsonBody.parse(await request.json());
      bundlePath = body.bundle_path;
      onConflict = body.on_conflict;
      confirmRealPerson = body.confirm_real_person;
    }

    const result = await importCharacterBundle(services, {
      bundle_path: bundlePath,
      ...(onConflict === undefined ? {} : { on_conflict: onConflict }),
      ...(confirmRealPerson === undefined ? {} : { confirm_real_person: confirmRealPerson }),
    });
    return NextResponse.json({ result });
  } catch (error) {
    return errorResponse(error);
  }
}
