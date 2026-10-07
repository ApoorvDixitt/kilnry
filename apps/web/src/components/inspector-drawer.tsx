'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useState } from 'react';
import { Star, X } from 'lucide-react';
import { message } from '../lib/messages';
import type { AssetDetail, MetadataPatch } from '../lib/composer-types';
import { ConsistencyBadge } from './consistency-badge';

const LABELS = ['red', 'amber', 'green', 'blue'];

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function hasGeneration(detail: Pick<AssetDetail, 'generation'>): boolean {
  return detail.generation !== null && Object.keys(detail.generation).length > 0;
}

/**
 * The provider's copy has expired and the local file is gone (PRD-14:223).
 * Both facts were stored and neither was reported, so this state was invisible
 * (F-45).
 */
export function providerCopyExpired(
  detail: Pick<AssetDetail, 'retention_until' | 'file_present'>,
  now: number = Date.now(),
): boolean {
  if (detail.file_present !== false) return false;
  if (!detail.retention_until) return false;
  const until = Date.parse(detail.retention_until);
  return Number.isFinite(until) && until < now;
}

export function InspectorDrawer({
  detail,
  onPatch,
  onClose,
  onTransform,
  showConsistency = false,
}: {
  detail: AssetDetail;
  onPatch: (patch: MetadataPatch) => void;
  onClose?: () => void;
  // Opening the transforms panel for this asset (F-CRE-11: "or from a Library
  // asset menu").
  onTransform?: (() => void) | undefined;
  // The consistency badge shows only while the check is on (F-CHR-12).
  showConsistency?: boolean;
}): React.ReactNode {
  const [tab, setTab] = useState<'info' | 'provenance' | 'activity'>('info');
  const [tagDraft, setTagDraft] = useState('');
  const generated = hasGeneration(detail);

  function addTag(): void {
    const tag = tagDraft.trim().toLowerCase();
    if (tag && !detail.tags.includes(tag)) onPatch({ tags: [...detail.tags, tag] });
    setTagDraft('');
  }

  return (
    <aside className="inspector" aria-label={message('library.inspector.title')}>
      <header className="inspector-head">
        <div className="inspector-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'info'}
            className={tab === 'info' ? 'is-on' : ''}
            onClick={() => setTab('info')}
          >
            {message('library.inspector.tabInfo')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'provenance'}
            className={tab === 'provenance' ? 'is-on' : ''}
            onClick={() => setTab('provenance')}
          >
            {message('library.inspector.tabProvenance')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'activity'}
            className={tab === 'activity' ? 'is-on' : ''}
            onClick={() => setTab('activity')}
          >
            {message('library.inspector.tabActivity')}
          </button>
        </div>
        {onTransform ? (
          <button type="button" className="inspector-transform" onClick={onTransform}>
            {message('create.transform.open')}
          </button>
        ) : null}
        {onClose ? (
          <button type="button" className="inspector-close" aria-label="Close" onClick={onClose}>
            <X aria-hidden size={16} strokeWidth={1.75} />
          </button>
        ) : null}
      </header>

      {/* PRD-14:223's seven-day warning: the provider's copy is gone and the
          local file is missing too, so there is nothing to fetch and Recover is
          shown disabled with the hint to check Trash (F-45). */}
      {providerCopyExpired(detail) ? (
        <div className="inspector-expired" role="status">
          <p>{message('library.inspector.providerCopyExpired')}</p>
          <button type="button" disabled title={message('library.inspector.recoverDisabledHint')}>
            {message('library.inspector.recoverFromProvider')}
          </button>
          <small>{message('library.inspector.recoverDisabledHint')}</small>
        </div>
      ) : null}

      {detail.kind === 'image' || detail.kind === 'video' ? (
        <a className="inspector-edit" href={`/create?edit=${encodeURIComponent(detail.id)}`}>
          {message('create.edit.action')}
        </a>
      ) : null}

      {tab === 'info' ? (
        <div className="inspector-body" role="tabpanel">
          <dl className="inspector-facts">
            <dt>{message('library.inspector.filename')}</dt>
            <dd>{detail.path.split('/').at(-1)}</dd>
            <dt>{message('library.inspector.folder')}</dt>
            <dd>{detail.folder_path ?? '—'}</dd>
            <dt>{message('library.inspector.kind')}</dt>
            <dd>
              {detail.kind} · {detail.mime ?? '—'}
            </dd>
            <dt>{message('library.inspector.dimensions')}</dt>
            <dd>{detail.width && detail.height ? `${detail.width}×${detail.height}` : '—'}</dd>
            <dt>{message('library.inspector.size')}</dt>
            <dd>{formatBytes(detail.bytes)}</dd>
            <dt>{message('library.inspector.created')}</dt>
            <dd>{new Date(detail.created_at).toLocaleString()}</dd>
          </dl>

          <label className="inspector-field">
            <span>{message('library.inspector.tags')}</span>
            <div className="inspector-tags">
              {detail.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="inspector-tag"
                  onClick={() => onPatch({ tags: detail.tags.filter((item) => item !== tag) })}
                >
                  {tag} ✕
                </button>
              ))}
              <input
                value={tagDraft}
                placeholder={message('library.inspector.tagAdd')}
                aria-label={message('library.inspector.tagAdd')}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTag();
                  }
                }}
              />
            </div>
          </label>

          <label className="inspector-field">
            <span>{message('library.inspector.label')}</span>
            <div className="inspector-labels">
              {LABELS.map((label) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={detail.label === label}
                  className={`inspector-label-dot label-${label}${detail.label === label ? ' is-on' : ''}`}
                  aria-label={label}
                  onClick={() => onPatch({ label: detail.label === label ? null : label })}
                />
              ))}
            </div>
          </label>

          <label className="inspector-field">
            <span>{message('library.inspector.rating')}</span>
            <div className="inspector-stars">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${value}`}
                  aria-pressed={detail.rating >= value}
                  className={`inspector-star${detail.rating >= value ? ' is-on' : ''}`}
                  onClick={() => onPatch({ rating: detail.rating === value ? 0 : value })}
                >
                  <Star aria-hidden size={16} strokeWidth={1.75} />
                </button>
              ))}
            </div>
          </label>

          <label className="inspector-field">
            <span>{message('library.inspector.notes')}</span>
            <textarea
              defaultValue={detail.user_notes}
              onBlur={(event) => {
                if (event.target.value !== detail.user_notes) onPatch({ user_notes: event.target.value });
              }}
            />
          </label>

          {!generated ? (
            <label className="inspector-field">
              <span>{message('library.inspector.prompt')}</span>
              <textarea
                defaultValue={String((detail.generation?.prompt as string | undefined) ?? '')}
                onBlur={(event) => {
                  if (event.target.value) onPatch({ prompt: event.target.value });
                }}
              />
            </label>
          ) : null}

          <p className="inspector-sidecar">{detail.sidecar_path}</p>
        </div>
      ) : null}

      {tab === 'provenance' ? (
        <div className="inspector-body" role="tabpanel">
          {generated ? (
            <dl className="inspector-facts">
              <dt>{message('library.inspector.prompt')}</dt>
              <dd>{String((detail.generation?.prompt as string | undefined) ?? '—')}</dd>
              <dt>{message('library.inspector.model')}</dt>
              <dd>
                {detail.provider_id ?? '—'} · {detail.model_id ?? '—'}
              </dd>
              <dt>{message('library.inspector.cost')}</dt>
              <dd data-money="true">{detail.actual_usd ? `$${detail.actual_usd.toFixed(2)}` : '—'}</dd>
              <dt>{message('library.inspector.madeFrom')}</dt>
              <dd>{detail.lineage.made_from.length}</dd>
              <dt>{message('library.inspector.usedIn')}</dt>
              <dd>{detail.lineage.used_in.length}</dd>
              {showConsistency && detail.consistency ? (
                <>
                  <dt>{message('library.consistency.label')}</dt>
                  <dd>
                    <ConsistencyBadge score={detail.consistency} />
                  </dd>
                </>
              ) : null}
            </dl>
          ) : (
            <p className="inspector-empty">{message('library.inspector.noProvenance')}</p>
          )}
        </div>
      ) : null}

      {tab === 'activity' ? (
        <div className="inspector-body" role="tabpanel">
          <ul className="inspector-activity">
            {detail.activity.map((event, index) => (
              <li key={`${event.action}-${index}`}>
                <span>{event.action}</span>
                <time>{new Date(event.at).toLocaleTimeString()}</time>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
