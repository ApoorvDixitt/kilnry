// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { eventHub, type SequencedEvent } from '@kilnry/core';
import { errorResponse, requireSession } from '../../../server/http';

const encoder = new TextEncoder();

function frame(value: SequencedEvent): Uint8Array {
  return encoder.encode(
    `id: ${value.id}\nevent: ${value.event.type}\ndata: ${JSON.stringify(value.event)}\n\n`,
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession();
    const lastId = Number(request.headers.get('last-event-id') ?? 0) || 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of eventHub.since(lastId)) controller.enqueue(frame(event));
        const unsubscribe = eventHub.subscribe((event) => controller.enqueue(frame(event)));
        const heartbeat = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 15_000);
        const close = (): void => {
          clearInterval(heartbeat);
          unsubscribe();
          controller.close();
        };
        request.signal.addEventListener('abort', close, { once: true });
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
