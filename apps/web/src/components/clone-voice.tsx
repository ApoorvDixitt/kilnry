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

import { useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import {
  CLONE_PROVIDERS,
  canClone,
  cloneLabel,
  providerOption,
  type CloneProvider,
} from './clone-voice-logic';

export function CloneVoiceDrawer({
  handle,
  onClose,
  onCloned,
}: {
  handle: string;
  onClose: () => void;
  onCloned?: () => void;
}): React.ReactNode {
  const [name, setName] = useState('');
  const [sampleUrl, setSampleUrl] = useState('');
  const [sampleSeconds, setSampleSeconds] = useState(0);
  const [provider, setProvider] = useState<CloneProvider>('minimax');
  const [consent, setConsent] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string>();

  const option = providerOption(provider);
  const enabled = canClone({ name, sampleSeconds, sampleUrl, consent, cloning });

  function clone(): void {
    if (!enabled) return;
    setCloning(true);
    setError(undefined);
    void apiFetch('/api/voices/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'clone',
        handle,
        name,
        provider,
        sample_url: sampleUrl,
        sample_seconds: sampleSeconds,
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

      <label className="clone-voice-field">
        {message('characters.clone.sample')}
        <input
          type="url"
          className="clone-voice-sample"
          value={sampleUrl}
          placeholder="https://…"
          onChange={(event) => setSampleUrl(event.target.value)}
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
      {sampleUrl.trim() !== '' && sampleSeconds > 0 && sampleSeconds < 10 ? (
        <p className="clone-voice-warn" role="alert">
          {message('characters.clone.tooShort')}
        </p>
      ) : null}

      <fieldset className="clone-voice-providers">
        <legend>{message('characters.clone.provider')}</legend>
        {CLONE_PROVIDERS.map((each) => (
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

      <footer className="clone-voice-actions">
        <button type="button" className="btn primary" disabled={!enabled} onClick={clone}>
          {cloning
            ? message('characters.clone.cloning')
            : cloneLabel(message('characters.clone.clone'), option.priceLabel)}
        </button>
      </footer>
    </aside>
  );
}
