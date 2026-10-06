// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The clone-a-voice drawer (F-VOI-02). It takes a sample (a public URL or an
// uploaded file's URL) and its measured length, lets the user pick a connected
// provider, shows that provider's consent sentence with a "(provider policy,
// summarised)" label and a link to the provider page (PRD-08 §B2), plus
// Kilnry's own line, and only enables Clone once the sample is long enough and
// consent is ticked. It posts to the voices manage route, which clones behind
// the consent and cost gate and optionally binds the result to the Character.

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import {
  acceptsUploadedSample,
  canClone,
  cloneLabel,
  connectedCloneProviders,
  providerOption,
  type CloneProvider,
} from './clone-voice-logic';

interface ProvidersBody {
  providers?: Array<{ id: string; connected: boolean }>;
}

export function CloneVoiceDrawer({
  handle,
  minorSuspected = false,
  onClose,
  onCloned,
}: {
  /** Absent on the Voices tab: the clone is made unbound (PRD-08:226, F-118). */
  handle?: string | undefined;
  // PRD-07 §7: a Character that reads as a minor is never cloned (F-07).
  minorSuspected?: boolean;
  onClose: () => void;
  onCloned?: () => void;
}): React.ReactNode {
  const [name, setName] = useState('');
  const [sampleUrl, setSampleUrl] = useState('');
  const [sampleSeconds, setSampleSeconds] = useState(0);
  const [sampleAssetId, setSampleAssetId] = useState<string>();
  const [uploading, setUploading] = useState(false);
  // PRD-08:231 lists only connected providers; all four were offered whatever
  // the user had (F-118).
  const [connected, setConnected] = useState<string[]>([]);
  const options = connectedCloneProviders(connected);
  const [provider, setProvider] = useState<CloneProvider>('minimax');
  const [consent, setConsent] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string>();

  const option = providerOption(provider);
  const enabled = !minorSuspected && canClone({ name, sampleSeconds, sampleUrl, consent, cloning, provider });

  // Read which providers are connected once, and keep the selection on one of
  // them (PRD-08:231).
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/providers')
      .then((response) => (response.ok ? (response.json() as Promise<ProvidersBody>) : null))
      .then((body) => {
        if (cancelled || !body) return;
        const ids = (body.providers ?? []).filter((item) => item.connected).map((item) => item.id);
        setConnected(ids);
        const first = connectedCloneProviders(ids)[0];
        if (first) setProvider(first.provider);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The recording goes into the Library through the multipart import (F-111),
   * which probes it; the measured duration is what the ≥ 10 s rule reads, and
   * the asset is what the clone uploads to the provider.
   */
  async function uploadSample(file: File): Promise<void> {
    setUploading(true);
    setError(undefined);
    try {
      const form = new FormData();
      form.append('files', file);
      form.append('target_folder', 'inbox');
      const imported = (await (
        await apiFetch('/api/library/import', { method: 'POST', body: form })
      ).json()) as { assets?: Array<{ asset_id: string }>; error?: { message?: string } };
      const asset = imported.assets?.[0];
      if (!asset) throw new Error(imported.error?.message ?? message('characters.clone.failed'));
      const detail = (await (await fetch(`/api/library/asset/${asset.asset_id}`)).json()) as {
        asset?: { duration_s?: number | null };
      };
      const seconds = Number(detail.asset?.duration_s ?? 0);
      setSampleAssetId(asset.asset_id);
      setSampleUrl(`/api/media/${asset.asset_id}`);
      setSampleSeconds(seconds);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message('characters.clone.failed'));
    } finally {
      setUploading(false);
    }
  }

  function clone(): void {
    if (!enabled) return;
    setCloning(true);
    setError(undefined);
    void apiFetch('/api/voices/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'clone',
        ...(handle ? { handle } : {}),
        name,
        provider,
        sample_url: sampleUrl,
        sample_seconds: sampleSeconds,
        ...(sampleAssetId ? { sample_asset_id: sampleAssetId } : {}),
        consent: true,
        confirm_cost_usd: option.costUsd,
      }),
    })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((body: { error?: { message?: string } }) => {
              throw new Error(body.error?.message ?? message('characters.clone.failed'));
            }),
      )
      .then(() => {
        onCloned?.();
        onClose();
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : message('characters.clone.failed')),
      )
      .finally(() => setCloning(false));
  }

  return (
    <aside className="clone-voice-drawer" role="dialog" aria-label={message('characters.clone.title')}>
      <header className="clone-voice-header">
        <h3>{message('characters.clone.title')}</h3>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {message('characters.clone.close')}
        </button>
      </header>

      <label className="clone-voice-field">
        {message('characters.clone.name')}
        <input type="text" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
      </label>

      {/* PRD-08:230 takes an upload and measures the duration itself; the drawer
          asked for a public URL and a typed length, which a creator with a
          recording on their laptop cannot give (F-118). */}
      {acceptsUploadedSample(provider) ? (
        <label className="clone-voice-field">
          {message('characters.clone.sampleFile')}
          <input
            type="file"
            className="clone-voice-file"
            accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/m4a,.mp3,.wav,.m4a"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadSample(file);
            }}
          />
          <span className="clone-voice-measured">
            {uploading
              ? message('characters.clone.sampleUploading')
              : sampleAssetId
                ? message('characters.clone.sampleMeasured').replace(
                    '{seconds}',
                    String(Math.round(sampleSeconds)),
                  )
                : ''}
          </span>
        </label>
      ) : (
        <>
          <label className="clone-voice-field">
            {message('characters.clone.sample')}
            <input
              type="url"
              className="clone-voice-sample"
              value={sampleUrl}
              placeholder="https://…"
              onChange={(event) => {
                setSampleAssetId(undefined);
                setSampleUrl(event.target.value);
              }}
            />
          </label>
          <label className="clone-voice-field">
            {message('characters.clone.seconds')}
            <input
              type="number"
              min={0}
              value={sampleSeconds}
              onChange={(event) => setSampleSeconds(Number(event.target.value))}
            />
          </label>
        </>
      )}
      {sampleUrl.trim() !== '' && sampleSeconds > 0 && sampleSeconds < option.minSeconds ? (
        <p className="clone-voice-warn" role="alert">
          {message('characters.clone.tooShort')
            .replace('{provider}', message(option.labelKey))
            .replace('{seconds}', String(option.minSeconds))}
        </p>
      ) : null}
      {sampleUrl.trim() !== '' && sampleSeconds > option.maxSeconds ? (
        <p className="clone-voice-warn" role="alert">
          {message('characters.clone.tooLong')
            .replace('{provider}', message(option.labelKey))
            .replace('{seconds}', String(option.maxSeconds))}
        </p>
      ) : null}

      <fieldset className="clone-voice-providers">
        <legend>{message('characters.clone.provider')}</legend>
        {options.length === 0 ? <p className="muted">{message('characters.clone.noProviders')}</p> : null}
        {options.map((each) => (
          <label key={each.provider} className="clone-voice-provider">
            <input
              type="radio"
              name="clone-provider"
              value={each.provider}
              checked={provider === each.provider}
              onChange={() => setProvider(each.provider)}
            />
            {message(each.labelKey)} · {each.priceLabel}
          </label>
        ))}
      </fieldset>

      <div className="clone-voice-consent">
        <p className="clone-voice-consent-provider">
          “{message(option.consentKey)}”{' '}
          {option.summarised ? (
            <>
              <span className="clone-voice-consent-summarised">
                {message('characters.clone.consentSummarised')}
              </span>{' '}
              <a
                className="clone-voice-consent-source"
                href={message(option.sourceKey)}
                target="_blank"
                rel="noreferrer"
              >
                {message('characters.clone.consentSourceLink').replace(
                  '{provider}',
                  message(option.labelKey),
                )}
              </a>
            </>
          ) : null}
        </p>
        <label className="clone-voice-consent-check">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          {message('characters.clone.consentOwn')}
        </label>
      </div>

      {error ? (
        <p className="characters-error" role="alert">
          {error}
        </p>
      ) : null}

      {minorSuspected ? (
        <p className="muted clone-voice-minor">{message('characters.minorRefusal')}</p>
      ) : null}

      <footer className="clone-voice-actions">
        <button
          type="button"
          className="btn primary"
          disabled={!enabled}
          title={minorSuspected ? message('characters.minorRefusal') : undefined}
          onClick={clone}
        >
          {cloning
            ? message('characters.clone.cloning')
            : cloneLabel(message('characters.clone.clone'), option.priceLabel)}
        </button>
      </footer>
    </aside>
  );
}
