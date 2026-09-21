// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { NextResponse } from 'next/server';
import * as z from 'zod';
import { KilnryError, extractProduct, safeFetch } from '@kilnry/core';
import { auditEvents } from '@kilnry/db';
import { ulid } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../../server/http';
import { runtimeServices } from '../../../../server/runtime';

const Body = z.object({ url: z.string() });

// Fetch a product page and return its facts for a product Element (F-ELM-04).
// The fetch goes through the SSRF-guarded safeFetch (loopback and private ranges
// blocked, at most three redirects) and happens only on this explicit request;
// it is recorded in the audit log with the URL (acceptance 1). The page is
// parsed on the server; images are downloaded later, on create.
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireSession();
    const body = Body.parse(await request.json());
    if (!/^https:\/\//i.test(body.url)) {
      throw new KilnryError('INVALID_INPUT', 'Only https product pages can be read.');
    }
    const services = await runtimeServices();

    // Record the fetch before making it, so the intent is logged even on failure.
    await services.database.db.insert(auditEvents).values({
      id: ulid(),
      actor: `user:${session.user.id}`,
      action: 'element.fetch_url',
      target: body.url,
      meta: {},
    });

    let response: Response;
    try {
      response = await safeFetch(body.url, { max_bytes: 5 * 1024 * 1024 });
    } catch {
      throw new KilnryError(
        'INVALID_INPUT',
        'That page could not be read. Paste the image and title instead.',
      );
    }
    if (!response.ok) {
      const host = (() => {
        try {
          return new URL(body.url).host;
        } catch {
          return body.url;
        }
      })();
      throw new KilnryError(
        'INVALID_INPUT',
        `Could not read ${host} (${response.status}). Paste the hero image and title instead.`,
      );
    }
    const html = await response.text();
    const facts = extractProduct(html, body.url);
    return NextResponse.json({ facts });
  } catch (error) {
    return errorResponse(error);
  }
}
