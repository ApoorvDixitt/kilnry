// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Extract product facts from a fetched page for a product Element (F-ELM-04,
// PRD-08 §A4). The parse order is JSON-LD Product, then Open Graph, then the
// title tag and visible price patterns. Claims are pulled verbatim from bullets
// and sentences that read like a marketing claim; the UI leaves every claim
// unticked, and only ticked claims are ever returned to a workflow.

export interface ProductFacts {
  title?: string;
  description?: string;
  images: string[];
  claims: string[];
  price?: string;
  brand?: string;
  source_url: string;
  fetched_at: string;
}

// Words that mark a marketing claim (PRD-08 §A4 names "helps, reduces, certified,
// free from, %"; the list also covers common result verbs and time-to-result
// phrasing so a bullet like "Brightens in 14 days" is caught).
const CLAIM_WORDS =
  /\b(helps?|reduces?|certified|clinically|dermatologist|tested|free from|fragrance free|brightens?|whitens?|firms?|hydrates?|smooths?|improves?|boosts?|protects?|repairs?|softens?|nourishes?|in \d+ (?:days?|weeks?)|%)\b/i;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function absolute(url: string, base: string): string | undefined {
  try {
    return new URL(url, base).toString();
  } catch {
    return undefined;
  }
}

// Read the first JSON-LD Product object from the page, if any.
function fromJsonLd(html: string): Partial<ProductFacts> & { imageList?: string[] } {
  const scripts = [
    ...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script[1] ?? '');
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      if (typeof node !== 'object' || node === null) continue;
      const record = node as Record<string, unknown>;
      const type = record['@type'];
      if (type !== 'Product' && !(Array.isArray(type) && type.includes('Product'))) continue;
      const image = record.image;
      const images = Array.isArray(image)
        ? image.filter((value): value is string => typeof value === 'string')
        : typeof image === 'string'
          ? [image]
          : [];
      const offers = record.offers as Record<string, unknown> | undefined;
      const price =
        offers && (typeof offers.price === 'string' || typeof offers.price === 'number')
          ? `${offers.price}${typeof offers.priceCurrency === 'string' ? ` ${offers.priceCurrency}` : ''}`
          : undefined;
      const brand = record.brand as Record<string, unknown> | string | undefined;
      return {
        ...(typeof record.name === 'string' ? { title: record.name } : {}),
        ...(typeof record.description === 'string' ? { description: record.description } : {}),
        imageList: images,
        ...(price ? { price } : {}),
        ...(typeof brand === 'string'
          ? { brand }
          : brand && typeof brand.name === 'string'
            ? { brand: brand.name }
            : {}),
      };
    }
  }
  return {};
}

function metaContent(html: string, property: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i');
  const match = re.exec(html);
  return match ? decodeEntities(match[1] ?? '') : undefined;
}

// Pull candidate claims from list items and short sentences (PRD-08 §A4): a
// bullet or sentence that reads like a claim (a claim verb, a result phrase or a
// percentage). A plain descriptive bullet is left out.
function extractClaims(html: string): string[] {
  const claims = new Set<string>();
  for (const item of html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = decodeEntities((item[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    if (text.length >= 4 && text.length <= 120 && CLAIM_WORDS.test(text)) claims.add(text);
  }
  const body = html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  for (const sentence of decodeEntities(body).split(/(?<=[.!])\s+/)) {
    const text = sentence.trim();
    if (text.length >= 6 && text.length <= 120 && CLAIM_WORDS.test(text)) claims.add(text);
  }
  return [...claims].slice(0, 20);
}

function visiblePrice(html: string): string | undefined {
  const match = /(?:[$₹£€]|USD|INR|EUR|GBP)\s?\d[\d,]*(?:\.\d{2})?/.exec(html.replace(/<[^>]+>/g, ' '));
  return match ? match[0].trim() : undefined;
}

export function extractProduct(html: string, sourceUrl: string, now = new Date()): ProductFacts {
  const jsonLd = fromJsonLd(html);
  const ogTitle = metaContent(html, 'og:title');
  const ogImage = metaContent(html, 'og:image');
  const ogDescription = metaContent(html, 'og:description') ?? metaContent(html, 'description');
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);

  const images = new Set<string>();
  for (const candidate of [...(jsonLd.imageList ?? []), ...(ogImage ? [ogImage] : [])]) {
    const resolved = absolute(candidate, sourceUrl);
    if (resolved) images.add(resolved);
  }

  const title = jsonLd.title ?? ogTitle ?? (titleTag ? decodeEntities(titleTag[1] ?? '') : undefined);
  const description = jsonLd.description ?? ogDescription;
  const price = jsonLd.price ?? visiblePrice(html);

  return {
    ...(title ? { title } : {}),
    ...(description ? { description: description.slice(0, 500) } : {}),
    images: [...images],
    claims: extractClaims(html),
    ...(price ? { price } : {}),
    ...(jsonLd.brand ? { brand: jsonLd.brand } : {}),
    source_url: sourceUrl,
    fetched_at: now.toISOString(),
  };
}

// Only the claims the user ticked are ever exposed to a workflow (acceptance 2).
export function approvedClaims(facts: Pick<ProductFacts, 'claims'>, ticked: string[]): string[] {
  const allowed = new Set(ticked);
  return facts.claims.filter((claim) => allowed.has(claim));
}
