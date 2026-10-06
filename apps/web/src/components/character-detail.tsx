'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import {
  consentSatisfiedView,
  partitionReferences,
  sheetView,
  wordCount,
  type FullCharacterView,
  type Reference,
  type SheetResponse,
  type SheetState,
  type UsageAsset,
} from './character-detail-logic';
import { VersionSwitcher } from './version-switcher';
import { CloneVoiceDrawer } from './clone-voice';
import { TrainerCards } from './train-identity';
import { VoiceBindPicker } from './voice-bind-picker';

type DetailTab = 'sheet' | 'identities' | 'voice' | 'usage' | 'settings';

function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

export function CharacterDetail({ handle }: { handle: string }): React.ReactNode {
  const [item, setItem] = useState<FullCharacterView | null>(null);
  const [tab, setTab] = useState<DetailTab>('sheet');
  const [usage, setUsage] = useState<UsageAsset[] | null>(null);
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<SheetState>({ steps: [], runId: null, status: null });
  const [building, setBuilding] = useState(false);
  const [training, setTraining] = useState<string | null>(null);
  const [trainError, setTrainError] = useState<string>();
  const [trainDialog, setTrainDialog] = useState<{
    trainer: 'fal' | 'replicate' | 'higgsfield';
    cost: number;
  } | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string>();
  const [exportDialog, setExportDialog] = useState(false);
  const [includeLora, setIncludeLora] = useState(false);
  const [includeRelease, setIncludeRelease] = useState(false);

  // Export this character to a .kilnry-character.zip bundle (F-CHR-14). The
  // route stages references, a licence-safe local LoRA and the voice ids, zips
  // them, and returns the bundle path with any notes (a hosted Soul ID or a
  // non-exportable LoRA left out). The two toggles default off (PRD-07 §14):
  // trained weights and the consent release are only included when ticked.
  const exportBundle = useCallback(() => {
    setExporting(true);
    setExportNote(undefined);
    void apiFetch(`/api/characters/${encodeURIComponent(handle)}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ include_lora: includeLora, include_release: includeRelease }),
    })
      .then((response) => response.json() as Promise<{ bundle_path?: string; notes?: string[] }>)
      .then((body) => {
        setExportNote(
          body.bundle_path
            ? [message('characters.detail.exportDone'), body.bundle_path, ...(body.notes ?? [])].join(' ')
            : message('characters.detail.exportFailed'),
        );
      })
      .catch(() => setExportNote(message('characters.detail.exportFailed')))
      .finally(() => {
        setExporting(false);
        setExportDialog(false);
      });
  }, [handle, includeLora, includeRelease]);

  // Reload the character after a change (a clone, a bind, a set-current).
  const reloadCharacter = useCallback(() => {
    void fetch(`/api/characters/${encodeURIComponent(handle)}`)
      .then((response) => response.json() as Promise<{ item?: FullCharacterView }>)
      .then((body) => {
        if (body.item) setItem(body.item);
      })
      .catch(() => undefined);
  }, [handle]);

  // Unbind the current version's voice (F-CHR-08). The voice itself is kept.
  const unbindVoice = useCallback(() => {
    void apiFetch('/api/voices/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unbind', handle }),
    })
      .then((response) => (response.ok ? (response.json() as Promise<{ item?: FullCharacterView }>) : null))
      .then((body) => {
        if (body?.item) setItem(body.item);
      })
      .catch(() => undefined);
  }, [handle]);

  // Switch which version is current (F-CHR-10, PRD-07 §11). Selecting a version
  // calls set_current and reloads the character so the header, references and
  // descriptor all show the chosen version.
  const setCurrent = useCallback(
    (version: number) => {
      void apiFetch('/api/characters/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_current', handle, version }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then(() => fetch(`/api/characters/${encodeURIComponent(handle)}`))
        .then((response) => response.json() as Promise<{ item?: FullCharacterView }>)
        .then((body) => {
          if (body.item) setItem(body.item);
        })
        .catch(() => undefined);
    },
    [handle],
  );

  // Train a hosted identity on the chosen provider (F-CHR-07). The button is only
  // enabled once consent is recorded, so this call is never made blind; the cost
  // is confirmed here and the server asserts consent again.
  const train = useCallback(
    (trainer: 'fal' | 'replicate' | 'higgsfield', costUsd: number) => {
      setTraining(trainer);
      setTrainError(undefined);
      void apiFetch('/api/characters/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'train', handle, trainer, confirm_cost_usd: costUsd }),
      })
        .then((response) =>
          response.ok
            ? (response.json() as Promise<{ item?: FullCharacterView }>)
            : response.json().then((body: { error?: { message?: string } }) => {
                throw new Error(body.error?.message ?? message('characters.detail.trainFailed'));
              }),
        )
        .then((body) => {
          if (body.item) setItem(body.item);
        })
        .catch((cause: unknown) =>
          setTrainError(cause instanceof Error ? cause.message : message('characters.detail.trainFailed')),
        )
        .finally(() => setTraining(null));
    },
    [handle],
  );

  const buildSheet = useCallback(() => {
    setBuilding(true);
    void apiFetch('/api/characters/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'build_sheet', handle }),
    })
      .then((response) => (response.ok ? (response.json() as Promise<SheetResponse>) : null))
      .then((body) => setSheet((prev) => sheetView(prev, body)))
      .catch(() => setSheet((prev) => sheetView(prev, null)))
      .finally(() => setBuilding(false));
  }, [handle]);

  const decideSheet = useCallback((action: 'approve_sheet' | 'deny_sheet') => {
    setSheet((prev) => {
      if (!prev.runId) return prev;
      setBuilding(true);
      void apiFetch('/api/characters/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, run_id: prev.runId }),
      })
        .then((response) => (response.ok ? (response.json() as Promise<SheetResponse>) : null))
        .then((body) => setSheet((current) => sheetView(current, body)))
        .catch(() => undefined)
        .finally(() => setBuilding(false));
      return prev;
    });
  }, []);

  useEffect(() => {
    void fetch(`/api/characters/${encodeURIComponent(handle)}`)
      .then(
        (response) => response.json() as Promise<{ item?: FullCharacterView; error?: { message: string } }>,
      )
      .then((body) => {
        if (!body.item) throw new Error(body.error?.message ?? message('characters.detail.notFound'));
        setItem(body.item);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [handle]);

  const loadUsage = useCallback(() => {
    void fetch(`/api/characters/${encodeURIComponent(handle)}/usage`)
      .then((response) => response.json() as Promise<{ items: UsageAsset[] }>)
      .then((body) => setUsage(body.items))
      .catch(() => setUsage([]));
  }, [handle]);

  useEffect(() => {
    if (tab === 'usage' && usage === null) loadUsage();
  }, [tab, usage, loadUsage]);

  if (error) {
    return (
      <div className="character-detail">
        <Link className="create-character-back" href="/characters">
          ← {message('characters.create.back')}
        </Link>
        <p className="characters-error" role="alert">
          {error}
        </p>
      </div>
    );
  }
  if (!item) return <div className="character-detail">{message('characters.detail.loading')}</div>;

  const sections = partitionReferences(item.references);
  const anchor = item.references.find((r) => r.role === 'anchor');

  return (
    <div className="character-detail" data-testid="character-detail">
      <header className="character-detail-head">
        <div className="character-detail-anchor">
          {anchor ? <img src={anchor.preview_url} alt="" /> : <span>v{item.version}</span>}
        </div>
        <div className="character-detail-heading">
          <h1>
            {item.display_name} <span className="character-handle">@{item.handle}</span>{' '}
            <span className="muted">v{item.version}</span>
          </h1>
          <VersionSwitcher versions={item.versions} current={item.version} onSelect={setCurrent} />
          {item.description ? <p className="muted">{item.description}</p> : null}
          <div className="character-tags">
            <span className="character-tag muted">character</span>
            {item.tags.map((tag) => (
              <span key={tag} className="character-tag">
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="character-detail-actions">
          <Link className="btn" href={`/create?character=${item.handle}`}>
            {message('characters.detail.useInCreate')}
          </Link>
          <button className="btn" type="button" disabled={building} onClick={buildSheet}>
            {message('characters.detail.buildSheet')}
          </button>
          <button
            className="btn"
            type="button"
            disabled={exporting}
            onClick={() => setExportDialog(true)}
            data-testid="character-export"
          >
            {message('characters.detail.export')}
          </button>
        </div>
      </header>
      {exportDialog ? (
        <div
          className="character-export-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={message('characters.detail.exportTitle')}
        >
          <p>{message('characters.detail.exportHint')}</p>
          <label>
            <input
              type="checkbox"
              checked={includeLora}
              onChange={(event) => setIncludeLora(event.target.checked)}
            />
            {message('characters.detail.exportIncludeLora')}
          </label>
          <label>
            <input
              type="checkbox"
              checked={includeRelease}
              onChange={(event) => setIncludeRelease(event.target.checked)}
            />
            {message('characters.detail.exportIncludeRelease')}
          </label>
          <div className="character-export-dialog-actions">
            <button className="btn" type="button" onClick={() => setExportDialog(false)}>
              {message('characters.detail.exportCancel')}
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={exporting}
              data-testid="character-export-confirm"
              onClick={exportBundle}
            >
              {message('characters.detail.exportConfirm')}
            </button>
          </div>
        </div>
      ) : null}
      {exportNote ? (
        <p className="character-export-note" role="status">
          {exportNote}
        </p>
      ) : null}

      <nav className="character-detail-tabs" role="tablist">
        {(['sheet', 'identities', 'voice', 'usage', 'settings'] as DetailTab[]).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'on' : ''}
            onClick={() => setTab(id)}
          >
            {message(`characters.detail.tab${id.charAt(0).toUpperCase()}${id.slice(1)}`)}
            {id === 'usage' ? <span className="mono"> {item.stats.usage_count}</span> : null}
          </button>
        ))}
      </nav>

      {tab === 'sheet' ? (
        <section className="character-detail-body">
          {sheet.steps.length > 0 ? (
            <ol className="sheet-plan" aria-label={message('characters.detail.buildSheet')}>
              {sheet.steps.map((step) => (
                <li key={step.id} data-kind={step.kind} data-status={step.status ?? ''}>
                  {step.kind === 'approval' ? message('characters.detail.sheetApproval') : step.name}
                </li>
              ))}
            </ol>
          ) : null}
          {sheet.status === 'awaiting_approval' ? (
            <div
              className="sheet-approval"
              role="group"
              aria-label={message('characters.detail.sheetApproval')}
            >
              <button
                type="button"
                className="btn"
                disabled={building}
                onClick={() => decideSheet('approve_sheet')}
              >
                {message('characters.detail.approveTurnaround')}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={building}
                onClick={() => decideSheet('deny_sheet')}
              >
                {message('characters.detail.denyTurnaround')}
              </button>
            </div>
          ) : null}
          {item.references.length === 0 ? (
            <p className="muted">{message('characters.detail.noReferences')}</p>
          ) : (
            <>
              <ReferenceStrip
                title={message('characters.detail.anchor')}
                refs={sections.anchorAndTurnaround}
              />
              {sections.expressions.length > 0 ? (
                <ReferenceStrip
                  title={message('characters.detail.expressions')}
                  refs={sections.expressions}
                />
              ) : null}
              {sections.outfits.length > 0 ? (
                <ReferenceStrip title={message('characters.detail.outfits')} refs={sections.outfits} />
              ) : null}
            </>
          )}
          <div className="character-descriptor">
            <h4>
              {message('characters.detail.descriptor')}{' '}
              <span className="mono muted">
                {format(message('characters.detail.words'), { n: wordCount(item.appearance.descriptor) })}
              </span>
            </h4>
            <p>{item.appearance.descriptor || '—'}</p>
            <div className="character-anchors">
              {item.appearance.anchors.map((a) => (
                <span key={a} className="character-anchor-chip">
                  {a}
                </span>
              ))}
              {item.appearance.negative_traits.map((n) => (
                <span key={n} className="character-anchor-chip neg">
                  no {n}
                </span>
              ))}
            </div>
            <p
              className={
                item.is_real_person && !consentSatisfiedView(item)
                  ? 'character-consent bad'
                  : 'character-consent'
              }
            >
              {!item.is_real_person
                ? message('characters.detail.notReal')
                : consentSatisfiedView(item)
                  ? format(message('characters.detail.consentSet'), { status: item.consent.status })
                  : message('characters.detail.consentNone')}
            </p>
            {item.minor_suspected === true ? (
              <p className="character-consent bad character-minor-refusal">
                {message('characters.minorRefusal')}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === 'identities' ? (
        <section className="character-detail-body">
          <div className="character-identities">
            {item.trained_identities.some((t) => t.status === 'ready') ? (
              <span className="character-trained-badge">{message('characters.detail.trainedBadge')}</span>
            ) : null}
            {item.trained_identities.length === 0 ? (
              <p className="muted">—</p>
            ) : (
              item.trained_identities.map((t) => (
                <div key={t.id} className="character-identity-row">
                  <span>
                    {t.kind} · {t.provider}
                  </span>
                  <span className="mono muted">{t.status}</span>
                </div>
              ))
            )}
            <TrainerCards
              training={training}
              consentBlocks={item.is_real_person && !consentSatisfiedView(item)}
              minorSuspected={item.minor_suspected === true}
              onPick={setTrainDialog}
            />
            {trainError ? (
              <p className="characters-error" role="alert">
                {trainError}
              </p>
            ) : null}
            {trainDialog ? (
              <div
                className="character-train-dialog"
                role="dialog"
                aria-label={message('characters.detail.trainDialogTitle').replace(
                  '{provider}',
                  trainDialog.trainer === 'fal'
                    ? 'fal'
                    : trainDialog.trainer === 'replicate'
                      ? 'Replicate'
                      : 'Higgsfield',
                )}
              >
                <div className="character-train-card">
                  <h4>
                    {message('characters.detail.trainDialogTitle').replace(
                      '{provider}',
                      trainDialog.trainer === 'fal'
                        ? 'fal'
                        : trainDialog.trainer === 'replicate'
                          ? 'Replicate'
                          : 'Higgsfield',
                    )}
                  </h4>
                  <p className="character-train-estimate">
                    {message(
                      trainDialog.trainer === 'fal'
                        ? 'characters.detail.trainEstimateFal'
                        : trainDialog.trainer === 'replicate'
                          ? 'characters.detail.trainEstimateReplicate'
                          : 'characters.detail.trainEstimateHiggsfield',
                    )}
                  </p>
                  {trainDialog.trainer === 'higgsfield' ? (
                    <p className="character-train-terms" role="note">
                      {message('characters.detail.trainRealPersonConfirm')}
                    </p>
                  ) : (
                    <p className="character-train-terms">
                      {message(
                        trainDialog.trainer === 'fal'
                          ? 'characters.detail.trainTermsFal'
                          : 'characters.detail.trainTermsReplicate',
                      )}
                    </p>
                  )}
                  <div className="character-train-actions">
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => {
                        const { trainer, cost } = trainDialog;
                        setTrainDialog(null);
                        train(trainer, cost);
                      }}
                    >
                      {message('characters.detail.trainConfirm')}
                    </button>
                    <button className="btn btn-ghost" type="button" onClick={() => setTrainDialog(null)}>
                      {message('characters.detail.trainCancel')}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === 'voice' ? (
        <section className="character-detail-body">
          <p className="muted">
            {item.voice
              ? `${item.voice.provider} · ${item.voice.voice_id}`
              : message('characters.detail.voiceNone')}
          </p>
          {item.voice ? (
            <button className="btn" type="button" onClick={unbindVoice}>
              {message('characters.detail.unbind')}
            </button>
          ) : null}
          <button
            className="btn primary"
            type="button"
            disabled={item.minor_suspected === true}
            title={item.minor_suspected === true ? message('characters.minorRefusal') : undefined}
            onClick={() => setCloneOpen(true)}
          >
            {message('characters.detail.clone')}
          </button>
          <VoiceBindPicker handle={item.handle} onBound={(bound) => setItem(bound as FullCharacterView)} />
          {cloneOpen ? (
            <CloneVoiceDrawer
              handle={item.handle}
              minorSuspected={item.minor_suspected === true}
              onClose={() => setCloneOpen(false)}
              onCloned={reloadCharacter}
            />
          ) : null}
        </section>
      ) : null}

      {tab === 'usage' ? (
        <section className="character-detail-body">
          {usage && usage.length === 0 ? (
            <p className="muted">{message('characters.detail.usageEmpty')}</p>
          ) : (
            <div className="character-usage-grid">
              {(usage ?? []).map((asset) => (
                <Link
                  key={asset.asset_id}
                  href={`/library/asset/${asset.asset_id}`}
                  className="character-usage-cell"
                >
                  <img src={asset.preview_url} alt="" loading="lazy" />
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === 'settings' ? (
        <section className="character-detail-body">
          <p className="muted">
            @{item.handle} · versions {item.versions.map((row) => `v${row.version}`).join(', ')}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function ReferenceStrip({ title, refs }: { title: string; refs: Reference[] }): React.ReactNode {
  return (
    <div className="character-ref-section">
      <h4>{title}</h4>
      <div className="character-ref-strip">
        {refs.map((ref) => (
          <div key={ref.id} className={ref.role === 'anchor' ? 'character-ref anchor' : 'character-ref'}>
            <img src={ref.preview_url} alt="" loading="lazy" />
            <span className="character-ref-label">{ref.label ?? ref.view ?? ref.role}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
