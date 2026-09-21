// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import { approvedClaims, extractProduct } from './product-extract.js';

const jsonLdPage = `<!doctype html><html><head>
<title>Store</title>
<script type="application/ld+json">
{"@type":"Product","name":"Hero Vitamin C Serum 30 ml","description":"A brightening serum.",
 "image":["https://cdn.example.in/bottle.jpg"],
 "brand":{"name":"Hero Skin"},
 "offers":{"price":"899","priceCurrency":"INR"}}
</script></head>
<body><ul><li>Brightens in 14 days</li><li>Dermatologist tested</li><li>Just a nice bottle</li></ul></body></html>`;

const ogPage = `<!doctype html><html><head>
<meta property="og:title" content="Fallback Product" />
<meta property="og:image" content="/img/hero.png" />
<meta property="og:description" content="From Open Graph." />
<title>Ignored</title></head><body><p>Fragrance free formula.</p></body></html>`;

describe('product extraction (F-ELM-04)', () => {
  it('reads a JSON-LD Product with images, price, brand and claims', () => {
    const facts = extractProduct(jsonLdPage, 'https://example.in/products/hero-serum-30ml');
    expect(facts.title).toBe('Hero Vitamin C Serum 30 ml');
    expect(facts.brand).toBe('Hero Skin');
    expect(facts.price).toBe('899 INR');
    expect(facts.images).toContain('https://cdn.example.in/bottle.jpg');
    expect(facts.claims).toContain('Brightens in 14 days');
    expect(facts.claims).toContain('Dermatologist tested');
    // A plain bullet with no claim verb is not treated as a claim.
    expect(facts.claims).not.toContain('Just a nice bottle');
    expect(facts.source_url).toBe('https://example.in/products/hero-serum-30ml');
  });

  it('falls back to Open Graph and resolves a relative image URL', () => {
    const facts = extractProduct(ogPage, 'https://shop.example.com/p/1');
    expect(facts.title).toBe('Fallback Product');
    expect(facts.description).toBe('From Open Graph.');
    expect(facts.images).toContain('https://shop.example.com/img/hero.png');
    expect(facts.claims).toContain('Fragrance free formula.');
  });

  it('returns only the ticked claims as approved', () => {
    const facts = extractProduct(jsonLdPage, 'https://example.in/p');
    expect(approvedClaims(facts, ['Dermatologist tested'])).toEqual(['Dermatologist tested']);
    expect(approvedClaims(facts, [])).toEqual([]);
  });
});
