// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createHash } from 'node:crypto';
import { KilnryError, type AdapterContext, type ProviderId, type ProviderResult } from '@kilnry/core';
import { providerHttpError, providerNetworkError } from './errors.js';

const maxOutputBytes = 4 * 1024 * 1024 * 1024;

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function downloadUrl(
  provider: ProviderId,
  url: string,
  context: AdapterContext,
  baseHeaders: HeadersInit,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const chunks: Uint8Array[] = [];
  let received = 0;
  let canResume = false;
  let mime = 'application/octet-stream';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const headers = new Headers(baseHeaders);
      if (received > 0 && canResume) headers.set('Range', `bytes=${received}-`);
      const response = await context.fetch(url, {
        headers,
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(120_000)]),
      });
      if (!response.ok) {
        const body = await response.text();
        throw providerHttpError(provider, response.status, { message: body.slice(0, 200) }, response.headers);
      }
      if (received > 0 && response.status !== 206) {
        chunks.length = 0;
        received = 0;
      }
      canResume = response.headers.get('accept-ranges') === 'bytes';
      mime = response.headers.get('content-type')?.split(';')[0] ?? mime;
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > maxOutputBytes || received + declared > maxOutputBytes) {
        throw new KilnryError('INVALID_INPUT', 'Provider output exceeds the 4 GiB safety limit.', {
          provider,
          retryable: false,
        });
      }
      const reader = response.body?.getReader();
      if (!reader) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        chunks.push(bytes);
        received += bytes.byteLength;
      } else {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          received += next.value.byteLength;
          if (received > maxOutputBytes) {
            await reader.cancel('output too large');
            throw new KilnryError('INVALID_INPUT', 'Provider output exceeds the 4 GiB safety limit.', {
              provider,
              retryable: false,
            });
          }
          chunks.push(next.value);
        }
      }
      const output = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { bytes: output, mime };
    } catch (error) {
      if (error instanceof KilnryError && !error.toJSON().retryable) throw error;
      if (attempt === 4) {
        throw error instanceof KilnryError ? error : providerNetworkError(provider, error, false);
      }
      await new Promise((resolve) => setTimeout(resolve, [0, 50, 200, 500, 1000][attempt] ?? 1000));
    }
  }
  throw new Error('Download retry loop ended without a result.');
}

export async function downloadOutputs(
  provider: ProviderId,
  result: ProviderResult,
  context: AdapterContext,
  headers: HeadersInit = {},
): Promise<Array<{ index: number; bytes: Uint8Array; mime: string; sha256: string }>> {
  const outputs: Array<{ index: number; bytes: Uint8Array; mime: string; sha256: string }> = [];
  for (let index = 0; index < result.outputs.length; index += 1) {
    const output = result.outputs[index]!;
    let bytes: Uint8Array;
    let mime = output.mime ?? 'application/octet-stream';
    if (output.bytes) bytes = new Uint8Array(output.bytes);
    else if (output.base64) bytes = new Uint8Array(Buffer.from(output.base64, 'base64'));
    else if (output.url) {
      const downloaded = await downloadUrl(provider, output.url, context, headers);
      bytes = downloaded.bytes;
      mime = output.mime ?? downloaded.mime;
    } else {
      throw new KilnryError(
        'PROVIDER_ERROR',
        `${provider} returned an output without bytes or a download URL.`,
        {
          provider,
          retryable: true,
        },
      );
    }
    if (bytes.byteLength > maxOutputBytes) {
      throw new KilnryError('INVALID_INPUT', 'Provider output exceeds the 4 GiB safety limit.', {
        provider,
        retryable: false,
      });
    }
    outputs.push({ index, bytes, mime, sha256: hash(bytes) });
  }
  return outputs;
}
