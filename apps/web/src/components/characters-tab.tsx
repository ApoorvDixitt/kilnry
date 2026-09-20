'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { message } from '../lib/messages';
import {
  filterCards,
  formatCount,
  sortCards,
  type CardSort,
  type CharacterCard,
} from './characters-tab-logic';
import { VoicesTab } from './voices-tab';

type Tab = 'characters' | 'elements' | 'voices';

export function CharactersTab(): React.ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = ((params.get('tab') as Tab) ?? 'characters') || 'characters';
  const [cards, setCards] = useState<CharacterCard[] | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CardSort>('used');
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    setCards(null);
    // The list route filters by a single kind; for Elements we ask for each kind
    // and merge, so props, environments and styles all appear on the tab.
    const requests =
      tab === 'elements'
        ? ['prop', 'environment', 'style'].map((kind) => `/api/characters?kind=${kind}`)
        : ['/api/characters?kind=character'];
    void Promise.all(
      requests.map((request) =>
        fetch(request).then(
          (response) => response.json() as Promise<{ items: CharacterCard[]; error?: { message: string } }>,
        ),
      ),
    )
      .then((bodies) => {
        const merged = bodies.flatMap((body) => {
          if (body.error) throw new Error(body.error.message);
          return body.items;
        });
        setCards(merged);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setCards([]);
      });
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    if (!cards) return null;
    return sortCards(filterCards(cards, query), sort);
  }, [cards, query, sort]);

  const switchTab = useCallback(
    (next: Tab) => {
      router.push(next === 'characters' ? '/characters' : `/characters?tab=${next}`);
    },
    [router],
  );

  return (
    <div className="characters-page" data-testid="characters-tab">
      <div className="characters-header">
        <div className="characters-subtabs" role="tablist" aria-label={message('characters.title')}>
          <button
            role="tab"
            aria-selected={tab === 'characters'}
            className={tab === 'characters' ? 'on' : ''}
            onClick={() => switchTab('characters')}
          >
            {message('characters.tabCharacters')} <span className="mono muted">{cards?.length ?? ''}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'elements'}
            className={tab === 'elements' ? 'on' : ''}
            onClick={() => switchTab('elements')}
          >
            {message('characters.tabElements')}
          </button>
          <button
            role="tab"
            aria-selected={tab === 'voices'}
            className={tab === 'voices' ? 'on' : ''}
            onClick={() => switchTab('voices')}
          >
            {message('characters.tabVoices')}
          </button>
        </div>
        <span className="grow" />
        {tab === 'voices' ? null : (
          <Link
            className="characters-new"
            href={tab === 'elements' ? '/characters/new?kind=element' : '/characters/new'}
          >
            ＋ {tab === 'elements' ? message('characters.newElement') : message('characters.new')}
          </Link>
        )}
      </div>

      {tab === 'voices' ? (
        <VoicesTab />
      ) : (
        <>
          <div className="characters-filters">
            <input
              type="search"
              className="characters-search"
              placeholder={
                tab === 'elements' ? message('characters.searchElements') : message('characters.search')
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={
                tab === 'elements' ? message('characters.searchElements') : message('characters.search')
              }
            />
            <label className="characters-sort">
              {message('characters.sort')}
              <select value={sort} onChange={(event) => setSort(event.target.value as CardSort)}>
                <option value="used">{message('characters.sortUsed')}</option>
                <option value="name">{message('characters.sortName')}</option>
                <option value="created">{message('characters.sortCreated')}</option>
              </select>
            </label>
            <span className="characters-help" title={message('characters.headerHelp')} aria-hidden>
              ⓘ
            </span>
          </div>

          {visible === null ? (
            <div className="characters-grid" aria-busy>
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="character-card skeleton" />
              ))}
            </div>
          ) : visible.length === 0 && cards && cards.length === 0 ? (
            <div className="characters-empty">
              <h2>
                {tab === 'elements'
                  ? message('characters.emptyElementsTitle')
                  : message('characters.emptyTitle')}
              </h2>
              <p>
                {tab === 'elements'
                  ? message('characters.emptyElementsBody')
                  : message('characters.emptyBody')}
              </p>
              <div className="characters-empty-actions">
                <Link
                  className="btn primary"
                  href={tab === 'elements' ? '/characters/new?kind=element' : '/characters/new'}
                >
                  {tab === 'elements' ? message('characters.newElement') : message('characters.new')}
                </Link>
                {tab === 'elements' ? null : (
                  <button className="btn" type="button" disabled title="M4">
                    {message('characters.importBundle')}
                  </button>
                )}
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="characters-empty">
              <p>{message('characters.filteredZero')}</p>
              <button className="btn" type="button" onClick={() => setQuery('')}>
                {message('characters.clearFilters')}
              </button>
            </div>
          ) : (
            <div className="characters-grid">
              {visible.map((card) => (
                <CharacterGridCard key={card.id} card={card} />
              ))}
            </div>
          )}
          {error ? (
            <p className="characters-error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function CharacterGridCard({ card }: { card: CharacterCard }): React.ReactNode {
  const lora = card.trained.find((t) => t.kind === 'lora' && t.status === 'ready');
  const soul = card.trained.find((t) => t.kind === 'soul_id' && t.status === 'ready');
  const usage =
    card.usage_count > 0
      ? formatCount(message('characters.uses'), { n: card.usage_count })
      : message('characters.usedNever');
  return (
    <Link className="character-card" href={`/characters/${card.handle}`} data-testid="character-card">
      <div className="character-thumb">
        {card.anchor_preview_url ? (
          <img src={card.anchor_preview_url} alt="" loading="lazy" />
        ) : (
          <span className="character-thumb-empty">{message('characters.noAnchor')}</span>
        )}
        <span className="character-version">v{card.version}</span>
        <span className="character-badges">
          {lora ? (
            <span className="character-badge" title={lora.provider}>
              {message('characters.badgeLora')}
            </span>
          ) : null}
          {soul ? <span className="character-badge">{message('characters.badgeSoul')}</span> : null}
          {card.voice ? (
            <span className="character-badge" aria-label={message('characters.badgeVoice')}>
              ♪
            </span>
          ) : null}
        </span>
        {card.is_real_person ? (
          <span className="character-shield" title={message('characters.realPersonMarker')}>
            🛡
          </span>
        ) : null}
      </div>
      <div className="character-meta">
        <span className="character-handle">@{card.handle}</span>
        <span className="character-name">{card.display_name}</span>
      </div>
      <div className="character-tags">
        {card.kind !== 'character' ? <span className="character-tag muted">{card.kind}</span> : null}
        {card.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="character-tag">
            {tag}
          </span>
        ))}
        {card.tags.length > 2 ? <span className="character-tag muted">+{card.tags.length - 2}</span> : null}
      </div>
      <div className="character-usage">{usage}</div>
    </Link>
  );
}
