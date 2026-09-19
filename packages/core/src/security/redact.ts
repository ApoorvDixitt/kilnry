// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

const sensitiveName =
  /(?:authorization|cookie|set-cookie|api[_-]?key|secret|token|password|passwd|credential|private[_-]?key)/i;
const fullRedaction = /(?:kmcp_[A-Za-z0-9_-]+|kilnry1[a-z0-9\s-]{45,}|bearer\s+[A-Za-z0-9._~-]+)/gi;
const shapedSecrets = [
  /sk-or-v1-[0-9a-f]{32,}/gi,
  /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}/g,
  /r8_[A-Za-z0-9]{30,}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /[0-9a-f]{8}-[0-9a-f-]{27}:[A-Za-z0-9_-]{20,}/gi,
  /(?:^|\b)[0-9a-f]{32}:[0-9a-f]{32}(?:\b|$)/gi,
  /sk_[A-Za-z0-9]{20,}/g,
];

function mask(value: string): string {
  return value.length <= 10 ? '[redacted]' : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function redactString(input: string): string {
  let value = input.replace(fullRedaction, '[redacted]');
  for (const pattern of shapedSecrets) value = value.replace(pattern, (match) => mask(match));
  if (URL.canParse(value)) {
    const url = new URL(value);
    let changed = false;
    for (const key of [...url.searchParams.keys()]) {
      if (!sensitiveName.test(key)) continue;
      url.searchParams.set(key, '[redacted]');
      changed = true;
    }
    if (changed) value = url.toString();
  }
  return value;
}

export function redact<T>(input: T): T {
  const seen = new WeakMap<object, unknown>();
  const visit = (value: unknown, key?: string): unknown => {
    if (key && sensitiveName.test(key)) return '[redacted]';
    if (typeof value === 'string') return redactString(value);
    if (value instanceof Uint8Array) return `[bytes:${value.byteLength}]`;
    if (value instanceof Error) {
      return { name: value.name, message: redactString(value.message) };
    }
    if (Array.isArray(value)) return value.map((entry) => visit(entry));
    if (typeof value !== 'object' || value === null) return value;
    const prior = seen.get(value);
    if (prior) return prior;
    const output: Record<string, unknown> = {};
    seen.set(value, output);
    for (const [childKey, child] of Object.entries(value)) output[childKey] = visit(child, childKey);
    return output;
  };
  return visit(input) as T;
}
