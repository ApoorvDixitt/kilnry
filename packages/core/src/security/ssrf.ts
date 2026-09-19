// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { lookup as dnsLookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable, Transform } from 'node:stream';
import { KilnryError } from '../errors.js';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface SafeFetchOptions {
  method?: string;
  headers?: HeadersInit;
  body?: string | Uint8Array;
  signal?: AbortSignal;
  max_bytes?: number;
  max_redirects?: number;
  allow_lan_http?: boolean;
  allow_private_network?: boolean;
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: (url: URL, address: ResolvedAddress, options: SafeFetchOptions) => Promise<Response>;
}

const metadataHosts = new Set(['metadata.google.internal', '169.254.169.254', 'fd00:ec2::254']);

function ipv4Number(address: string): number | undefined {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return undefined;
  }
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function inV4Range(value: number, base: string, bits: number): boolean {
  const baseValue = ipv4Number(base)!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function ipv6Words(input: string): number[] | undefined {
  let value = input.toLowerCase().split('%')[0]!;
  if (value.includes('.')) {
    const split = value.lastIndexOf(':');
    const ipv4 = ipv4Number(value.slice(split + 1));
    if (ipv4 === undefined) return undefined;
    value = `${value.slice(0, split)}:${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return undefined;
  const words = [...left, ...Array.from({ length: missing }, () => '0'), ...right].map((part) =>
    Number.parseInt(part || '0', 16),
  );
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) {
    return undefined;
  }
  return words;
}

function privateV4(value: number): boolean {
  return (
    inV4Range(value, '10.0.0.0', 8) ||
    inV4Range(value, '172.16.0.0', 12) ||
    inV4Range(value, '192.168.0.0', 16)
  );
}

export function classifyAddress(address: string): 'public' | 'private' | 'blocked' {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address)!;
    if (privateV4(value)) return 'private';
    if (
      inV4Range(value, '0.0.0.0', 8) ||
      inV4Range(value, '100.64.0.0', 10) ||
      inV4Range(value, '127.0.0.0', 8) ||
      inV4Range(value, '169.254.0.0', 16) ||
      inV4Range(value, '192.0.0.0', 24) ||
      inV4Range(value, '198.18.0.0', 15) ||
      inV4Range(value, '224.0.0.0', 4) ||
      inV4Range(value, '240.0.0.0', 4) ||
      value === 0xffffffff
    ) {
      return 'blocked';
    }
    return 'public';
  }
  if (family === 6) {
    const words = ipv6Words(address)!;
    const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
    if (mapped) {
      const value = ((words[6]! << 16) | words[7]!) >>> 0;
      const mappedAddress = `${value >>> 24}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
      return classifyAddress(mappedAddress);
    }
    if (
      words.every((word) => word === 0) ||
      (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)
    ) {
      return 'blocked';
    }
    if ((words[0]! & 0xfe00) === 0xfc00) return 'private';
    if ((words[0]! & 0xffc0) === 0xfe80 || (words[0]! & 0xff00) === 0xff00) return 'blocked';
    return 'public';
  }
  return 'blocked';
}

function validateUrl(input: string | URL, options: SafeFetchOptions): URL {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input) : new URL(input);
  } catch (error) {
    throw new KilnryError('INVALID_INPUT', 'Import URL is invalid.', { cause: error });
  }
  if (url.username || url.password)
    throw new KilnryError('INVALID_INPUT', 'Import URLs cannot contain credentials.');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (metadataHosts.has(hostname)) {
    throw new KilnryError('INVALID_INPUT', 'Cloud metadata addresses cannot be imported.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && options.allow_lan_http)) {
    throw new KilnryError('INVALID_INPUT', 'Import URLs must use HTTPS.');
  }
  const allowedPort = url.protocol === 'https:' ? '443' : '80';
  if (url.port && url.port !== allowedPort) {
    throw new KilnryError('INVALID_INPUT', `Import URL port ${url.port} is not allowed.`);
  }
  return url;
}

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error);
      else
        resolve(addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 })));
    });
  });
}

function responseHeaders(source: NodeJS.Dict<string | string[]>): Headers {
  const output = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) for (const item of value) output.append(name, item);
    else if (value !== undefined) output.set(name, value);
  }
  return output;
}

async function pinnedRequest(
  url: URL,
  resolved: ResolvedAddress,
  options: SafeFetchOptions,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers = new Headers(options.headers);
    headers.set('Host', url.host);
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      {
        protocol: url.protocol,
        hostname: resolved.address,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: options.method ?? 'GET',
        headers: Object.fromEntries(headers.entries()),
        ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
        signal: options.signal,
      },
      (incoming) => {
        const declared = Number(incoming.headers['content-length'] ?? 0);
        const maximum = Math.min(Math.max(0, options.max_bytes ?? 500 * 1024 * 1024), 500 * 1024 * 1024);
        if (Number.isFinite(declared) && declared > maximum) {
          incoming.destroy();
          reject(new KilnryError('INVALID_INPUT', 'Remote media exceeds the 500 MB import limit.'));
          return;
        }
        let received = 0;
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            received += chunk.byteLength;
            if (received > maximum) {
              callback(new KilnryError('INVALID_INPUT', 'Remote media exceeds the 500 MB import limit.'));
            } else callback(null, chunk);
          },
        });
        incoming.setTimeout(30_000, () => incoming.destroy(new Error('Remote media stream became idle.')));
        incoming.pipe(limiter);
        resolve(
          new Response(Readable.toWeb(limiter) as ReadableStream<Uint8Array>, {
            status: incoming.statusCode ?? 500,
            ...(incoming.statusMessage ? { statusText: incoming.statusMessage } : {}),
            headers: responseHeaders(incoming.headers),
          }),
        );
      },
    );
    request.setTimeout(20_000, () => request.destroy(new Error('Remote server timed out.')));
    request.once('error', reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

export async function safeFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<Response> {
  const boundedOptions: SafeFetchOptions = {
    ...options,
    max_bytes: Math.min(Math.max(0, options.max_bytes ?? 500 * 1024 * 1024), 500 * 1024 * 1024),
    max_redirects: Math.min(Math.max(0, options.max_redirects ?? 3), 3),
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(120_000)])
      : AbortSignal.timeout(120_000),
  };
  let url = validateUrl(input, boundedOptions);
  const lookup = boundedOptions.lookup ?? defaultLookup;
  const request = boundedOptions.request ?? pinnedRequest;
  const maxRedirects = boundedOptions.max_redirects ?? 3;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const literalFamily = isIP(hostname);
    const addresses = literalFamily
      ? [{ address: hostname, family: literalFamily === 6 ? (6 as const) : (4 as const) }]
      : await lookup(hostname);
    if (addresses.length === 0) throw new KilnryError('NOT_FOUND', 'Import host did not resolve.');
    for (const address of addresses) {
      const classification = classifyAddress(address.address);
      const privateAllowed =
        classification === 'private' && boundedOptions.allow_private_network && boundedOptions.allow_lan_http;
      if (classification !== 'public' && !privateAllowed) {
        throw new KilnryError(
          'INVALID_INPUT',
          `Import host resolved to a blocked address (${address.address}).`,
        );
      }
      if (url.protocol === 'http:' && classification !== 'private') {
        throw new KilnryError(
          'INVALID_INPUT',
          'Plain HTTP imports are limited to approved private-network hosts.',
        );
      }
    }
    const response = await request(url, addresses[0]!, boundedOptions);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location)
      throw new KilnryError('PROVIDER_ERROR', 'Remote redirect did not include a Location header.');
    if (redirect === maxRedirects)
      throw new KilnryError('INVALID_INPUT', 'Remote URL redirected too many times.');
    await response.body?.cancel();
    url = validateUrl(new URL(location, url), boundedOptions);
  }
  throw new Error('SSRF redirect loop ended unexpectedly.');
}
