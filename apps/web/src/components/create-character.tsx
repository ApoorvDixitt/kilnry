'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import { canCreate, handleValidity, suggestHandle, type CreatePath } from './create-character-logic';
import { CastBuilder } from './cast-builder';
import { ProductFromUrl } from './product-from-url';

type ElementKind = 'prop' | 'environment' | 'style';

function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

const PATHS: Array<{ id: CreatePath; label: string }> = [
  { id: 'photo', label: 'characters.create.fromPhoto' },
  { id: 'library', label: 'characters.create.fromLibrary' },
  { id: 'url', label: 'characters.create.fromUrl' },
  { id: 'text', label: 'characters.create.fromText' },
  { id: 'cast', label: 'characters.create.castBuilder' },
];

export function CreateCharacter(): React.ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const isElement = params.get('kind') === 'element';
  const [elementKind, setElementKind] = useState<ElementKind>('prop');
  const [path, setPath] = useState<CreatePath>(isElement ? 'library' : 'photo');
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleEdited, setHandleEdited] = useState(false);
  const [tags, setTags] = useState('');
  const [description, setDescription] = useState('');
  const [isRealPerson, setIsRealPerson] = useState(false);
  const [consentStatus, setConsentStatus] = useState<'self' | 'written' | 'none'>('none');
  const [textBody, setTextBody] = useState('');
  const [anchorAssetId, setAnchorAssetId] = useState('');
  const [castPick, setCastPick] = useState<{ asset_id: string; cast_params: Record<string, unknown> }>();
  const [product, setProduct] = useState<import('./product-from-url').ProductElement>();
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [available, setAvailable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  // Keep the handle in step with the display name until the user edits it.
  useEffect(() => {
    if (!handleEdited) setHandle(suggestHandle(displayName));
  }, [displayName, handleEdited]);

  const validity = handleValidity(handle);

  // Live availability check against the mention route (exact handle match).
  useEffect(() => {
    if (validity !== 'ok') {
      setAvailable(true);
      return;
    }
    const value = handle.trim().toLowerCase();
    const timer = setTimeout(() => {
      void fetch(`/api/characters/mentions?q=${encodeURIComponent(value)}&limit=20`)
        .then((response) => response.json() as Promise<{ items: Array<{ handle: string }> }>)
        .then((body) => setAvailable(!body.items.some((item) => item.handle === value)))
        .catch(() => setAvailable(true));
    }, 250);
    return () => clearTimeout(timer);
  }, [handle, validity]);

  const submittable = useMemo(
    () =>
      canCreate({
        path,
        displayName,
        handleValidity: validity,
        handleAvailable: available,
        textBody,
        anchorAssetId,
        photoCount: photoFiles.length,
        ...(castPick ? { castPickedAssetId: castPick.asset_id } : {}),
        ...(product?.facts.title ? { productTitle: product.facts.title } : {}),
      }),
    [path, displayName, validity, available, textBody, anchorAssetId, photoFiles, castPick, product],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(undefined);
    try {
      let references: Array<{ asset_id: string; role: 'anchor' | 'turnaround'; view?: string }> | undefined;
      if (path === 'library' && anchorAssetId.trim()) {
        references = [{ asset_id: anchorAssetId.trim(), role: 'anchor', view: 'front' }];
      } else if (path === 'cast' && castPick) {
        // The picked cast member becomes the anchor; the other three stay in the
        // Library (F-CHR-15).
        references = [{ asset_id: castPick.asset_id, role: 'anchor', view: 'front' }];
      } else if (path === 'photo' && photoFiles.length > 0) {
        // Import the photos into the Library first (free), then use the first as
        // the anchor and the rest as untagged turnaround uploads.
        const form = new FormData();
        for (const file of photoFiles) form.append('files', file);
        form.append('target_folder', `Character_Sheets/@${handle.trim().toLowerCase()}/v1`);
        const imported = await apiFetch('/api/library/import', { method: 'POST', body: form });
        const importedBody = (await imported.json()) as {
          assets?: Array<{ asset_id: string }>;
          error?: { message: string };
        };
        if (!imported.ok || !importedBody.assets?.length) {
          throw new Error(importedBody.error?.message ?? 'Could not import the photos.');
        }
        references = importedBody.assets.map((asset, index) => ({
          asset_id: asset.asset_id,
          role: index === 0 ? ('anchor' as const) : ('turnaround' as const),
          ...(index === 0 ? { view: 'front' } : {}),
        }));
      }
      const body = {
        action: 'create' as const,
        handle: handle.trim().toLowerCase(),
        kind: isElement ? elementKind : ('character' as const),
        display_name: displayName.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(tags.trim()
          ? {
              tags: tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            }
          : {}),
        ...(isElement ? {} : { is_real_person: isRealPerson }),
        ...(path === 'text' && textBody.trim() ? { from: { text: textBody.trim() } } : {}),
        ...(path === 'url' && product
          ? {
              product_facts: {
                ...(product.facts.title ? { title: product.facts.title } : {}),
                ...(product.facts.description ? { description: product.facts.description } : {}),
                ...(product.facts.brand ? { brand: product.facts.brand } : {}),
                ...(product.facts.price ? { price: product.facts.price } : {}),
                claims: product.facts.claims,
                approved_claims: product.approved_claims,
                source_url: product.facts.source_url,
                fetched_at: product.facts.fetched_at,
              },
            }
          : {}),
        ...(references ? { references } : {}),
      };
      const response = await apiFetch('/api/characters/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const parsed = (await response.json()) as { item?: { handle: string }; error?: { message: string } };
      if (!response.ok || !parsed.item)
        throw new Error(parsed.error?.message ?? 'Could not create the character.');
      // Record consent immediately for a real person so the gate is answered.
      if (!isElement && isRealPerson) {
        await apiFetch('/api/characters/manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'set_consent',
            handle: parsed.item.handle,
            consent: { is_real_person: true, status: consentStatus },
          }),
        });
      }
      router.push(`/characters/${parsed.item.handle}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  }, [
    isElement,
    elementKind,
    path,
    handle,
    displayName,
    description,
    tags,
    isRealPerson,
    consentStatus,
    textBody,
    anchorAssetId,
    photoFiles,
    router,
  ]);

  return (
    <div className="create-character" data-testid="create-character">
      <div className="create-character-top">
        <Link className="create-character-back" href="/characters">
          ← {message('characters.create.back')}
        </Link>
        <h1>{isElement ? message('characters.create.titleElement') : message('characters.create.title')}</h1>
      </div>

      <div className="create-character-segments" role="tablist">
        {PATHS.filter(
          (option) => !(isElement && option.id === 'cast') && !(!isElement && option.id === 'url'),
        ).map((option) => (
          <button
            key={option.id}
            role="tab"
            aria-selected={path === option.id}
            className={path === option.id ? 'on' : ''}
            onClick={() => setPath(option.id)}
          >
            {message(option.label)}
          </button>
        ))}
      </div>

      {path === 'cast' ? <CastBuilder onPick={setCastPick} /> : null}

      {path === 'url' ? <ProductFromUrl onFacts={setProduct} /> : null}

      <div className="create-character-form">
        {isElement ? (
          <label>
            {message('characters.create.elementKind')}
            <select
              value={elementKind}
              onChange={(event) => setElementKind(event.target.value as ElementKind)}
            >
              <option value="prop">{message('characters.create.kindProp')}</option>
              <option value="environment">{message('characters.create.kindEnvironment')}</option>
              <option value="style">{message('characters.create.kindStyle')}</option>
            </select>
          </label>
        ) : null}

        <label>
          {message('characters.create.displayName')}
          <input
            type="text"
            maxLength={64}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={message('characters.create.displayNameHint')}
          />
        </label>

        <label>
          {message('characters.create.handle')}
          <input
            type="text"
            value={handle}
            onChange={(event) => {
              setHandleEdited(true);
              setHandle(event.target.value.replace(/^@/, ''));
            }}
          />
          <span className="create-character-handle-state">
            {validity === 'ok' && available
              ? format(message('characters.create.handleFree'), { handle: handle.toLowerCase() })
              : validity === 'ok' && !available
                ? format(message('characters.create.handleTaken'), { handle: handle.toLowerCase() })
                : validity === 'empty'
                  ? ''
                  : message('characters.create.handleInvalid')}
          </span>
        </label>

        <label>
          {message('characters.create.tags')}
          <input
            type="text"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder={message('characters.create.tagsPlaceholder')}
          />
        </label>

        <label>
          {message('characters.create.description')}
          <textarea
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={message('characters.create.descriptionHint')}
          />
        </label>

        {isElement ? null : (
          <label className="create-character-toggle">
            <input
              type="checkbox"
              checked={isRealPerson}
              onChange={(event) => setIsRealPerson(event.target.checked)}
            />
            {message('characters.create.realPerson')}
          </label>
        )}

        {!isElement && isRealPerson ? (
          <fieldset className="create-character-consent">
            <legend>{message('characters.consent.title')}</legend>
            <p>{message('characters.consent.clauseHiggsfield')}</p>
            <label>
              <input
                type="radio"
                name="consent"
                checked={consentStatus === 'self'}
                onChange={() => setConsentStatus('self')}
              />
              {message('characters.consent.self')}
            </label>
            <label>
              <input
                type="radio"
                name="consent"
                checked={consentStatus === 'written'}
                onChange={() => setConsentStatus('written')}
              />
              {message('characters.consent.written')}
            </label>
            <label>
              <input
                type="radio"
                name="consent"
                checked={consentStatus === 'none'}
                onChange={() => setConsentStatus('none')}
              />
              {message('characters.consent.neither')}
            </label>
            <p className="create-character-consent-note">{message('characters.consent.neitherNote')}</p>
          </fieldset>
        ) : null}

        {path === 'text' ? (
          <label>
            {message('characters.create.textWho')}
            <textarea
              maxLength={400}
              value={textBody}
              onChange={(event) => setTextBody(event.target.value)}
              placeholder={message('characters.create.textWhoPlaceholder')}
            />
            <span className="create-character-note">{message('characters.create.needImageProvider')}</span>
          </label>
        ) : null}

        {path === 'library' ? (
          <label>
            {message('characters.create.anchorAssetId')}
            <input
              type="text"
              value={anchorAssetId}
              onChange={(event) => setAnchorAssetId(event.target.value)}
              placeholder={message('characters.create.libraryHint')}
            />
          </label>
        ) : null}

        {path === 'photo' ? (
          <div className="create-character-photo">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              aria-label={message('characters.create.fromPhoto')}
              onChange={(event) => setPhotoFiles(Array.from(event.target.files ?? []).slice(0, 20))}
            />
            <p className="create-character-note">
              {photoFiles.length > 0
                ? format(message('characters.create.photoCount'), { n: photoFiles.length })
                : message('characters.create.photoDrop')}
            </p>
          </div>
        ) : null}

        <div className="create-character-actions">
          <Link className="btn" href="/characters">
            {message('characters.create.cancel')}
          </Link>
          <button
            type="button"
            className="btn primary"
            disabled={!submittable || saving}
            onClick={() => void save()}
          >
            {saving ? message('characters.create.saving') : message('characters.create.save')}
          </button>
        </div>
        {error ? (
          <p className="create-character-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
