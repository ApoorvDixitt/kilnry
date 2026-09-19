// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The media roles a model can accept, mirroring the registry manifest. The
// server enforces these too; this gives the composer an immediate, readable
// check before anything is submitted.
export type AttachmentRole =
  'start_frame' | 'end_frame' | 'reference' | 'style' | 'product' | 'audio' | 'video' | 'mask' | 'source';

export interface Attachment {
  id: string;
  name: string;
  role: AttachmentRole;
  kind: 'image' | 'video' | 'audio';
  pinned: boolean;
  assetId?: string;
  sourceUrl?: string;
}

export interface RoleLimit {
  role: AttachmentRole;
  min?: number;
  max: number;
}

// Validate the attachment set against the selected model's role limits, returning
// the first human-readable problem or null when the set is acceptable.
export function validateAttachmentRoles(attachments: Attachment[], limits: RoleLimit[]): string | null {
  const counts = new Map<AttachmentRole, number>();
  for (const attachment of attachments) {
    counts.set(attachment.role, (counts.get(attachment.role) ?? 0) + 1);
  }

  const allowed = new Map(limits.map((limit) => [limit.role, limit]));
  for (const [role, count] of counts) {
    const limit = allowed.get(role);
    if (!limit) {
      return `This model does not take a ${humanRole(role)}.`;
    }
    if (count > limit.max) {
      return limit.max === 1
        ? `Only one ${humanRole(role)} per generation.`
        : `This model takes up to ${limit.max} ${humanRole(role)} attachments.`;
    }
  }

  for (const limit of limits) {
    if (limit.min && (counts.get(limit.role) ?? 0) < limit.min) {
      return `This model needs at least ${limit.min} ${humanRole(limit.role)} attachment(s).`;
    }
  }

  return null;
}

function humanRole(role: AttachmentRole): string {
  return role.replace(/_/g, ' ');
}

// A private-network or otherwise non-public URL must never be fetched. This is a
// client-side guard on IP-literal hosts covering the ranges the design lists
// (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, unique-local); the
// server repeats the check with DNS resolution when the host is a name.
export function isBlockedUrl(input: string): boolean {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return true;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return true;
    const [a, b] = octets as [number, number, number, number];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (host.includes(':')) {
    // IPv6 literal: loopback, unspecified, unique-local (fc00::/7) and link-local
    // (fe80::/10) are all private.
    if (host === '::1' || host === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
    return false;
  }

  return false;
}
