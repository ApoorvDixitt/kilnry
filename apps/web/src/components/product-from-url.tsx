// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The product-from-URL path in Create Element (F-ELM-04). The user pastes a
// product page address and clicks Fetch; nothing is read until then. The server
// reads the page through the SSRF-guarded fetch and returns the title, images,
// claims, price and brand. Claims are shown unticked — only the claims the user
// ticks are stored and later used by a workflow — and the extracted facts are
// reported to the parent, which creates the Element.

import { useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import { approvedFrom, canFetch, toggleClaim, type ProductFactsView } from './product-url-logic';

export interface ProductElement {
  facts: ProductFactsView;
  approved_claims: string[];
}

export function ProductFromUrl({ onFacts }: { onFacts: (element: ProductElement) => void }): React.ReactNode {
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [facts, setFacts] = useState<ProductFactsView | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();

  function report(next: ProductFactsView, tickedSet: Set<string>): void {
    onFacts({ facts: next, approved_claims: approvedFrom(next.claims, tickedSet) });
  }

  function fetchPage(): void {
    if (!canFetch(url) || fetching) return;
    setFetching(true);
    setError(undefined);
    void apiFetch('/api/elements/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
    })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((body: { error?: { message?: string } }) => {
              throw new Error(body.error?.message ?? message('characters.product.failed'));
            }),
      )
      .then((body: { facts: ProductFactsView }) => {
        setFacts(body.facts);
        setTicked(new Set());
        report(body.facts, new Set());
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : message('characters.product.failed')),
      )
      .finally(() => setFetching(false));
  }

  function toggle(claim: string): void {
    const next = toggleClaim(ticked, claim);
    setTicked(next);
    if (facts) report(facts, next);
  }

  return (
    <div className="product-url">
      <div className="product-url-intake">
        <input
          type="url"
          className="product-url-input"
          value={url}
          placeholder="https://…/product"
          aria-label={message('characters.product.url')}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button className="btn" type="button" disabled={!canFetch(url) || fetching} onClick={fetchPage}>
          {fetching ? message('characters.product.fetching') : message('characters.product.fetch')}
        </button>
      </div>

      {error ? (
        <p className="characters-error" role="alert">
          {error}
        </p>
      ) : null}

      {facts ? (
        <div className="product-url-facts">
          {facts.title ? <p className="product-url-title">{facts.title}</p> : null}
          {facts.price ? <p className="muted">{facts.price}</p> : null}
          {facts.images.length > 0 ? (
            <div className="product-url-images">
              {facts.images.map((src) => (
                <img key={src} src={src} alt="" loading="lazy" />
              ))}
            </div>
          ) : null}
          <fieldset className="product-url-claims">
            <legend>{message('characters.product.claims')}</legend>
            <p className="muted">{message('characters.product.claimsHint')}</p>
            {facts.claims.length === 0 ? (
              <p className="muted">{message('characters.product.claimsEmpty')}</p>
            ) : (
              facts.claims.map((claim) => (
                <label key={claim} className="product-url-claim">
                  <input type="checkbox" checked={ticked.has(claim)} onChange={() => toggle(claim)} />
                  {claim}
                </label>
              ))
            )}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
