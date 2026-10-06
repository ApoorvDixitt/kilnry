'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import {
  VOICE_FILTER_PROVIDERS,
  filterVoiceRows,
  voiceProviderLabel,
  type VoiceRow,
} from './voices-tab-logic';
import { CloneVoiceDrawer } from './clone-voice';

const DESIGN_COST_USD = 3;
const MAX_DESIGN_DESCRIPTION = 300;

export function VoicesTab(): React.ReactNode {
  const [rows, setRows] = useState<VoiceRow[] | null>(null);
  const [provider, setProvider] = useState('');
  const [note, setNote] = useState<string>();
  // F-VOI-03: "Design voice" is hidden until MiniMax or fal is connected.
  const [designProvider, setDesignProvider] = useState<'minimax' | 'fal' | null>(null);
  const [designOpen, setDesignOpen] = useState(false);
  const [designName, setDesignName] = useState('');
  const [designDescription, setDesignDescription] = useState('');
  const [designPreview, setDesignPreview] = useState('Hello, this is a preview of the designed voice.');
  const [designLanguage, setDesignLanguage] = useState('');
  const [designGender, setDesignGender] = useState('');
  const [designing, setDesigning] = useState(false);
  const [designNote, setDesignNote] = useState<string>();
  const [cloneOpen, setCloneOpen] = useState(false);
  const [defaultVoice, setDefaultVoice] = useState<string | null>(null);

  const reload = useCallback(() => {
    void fetch('/api/voices')
      .then((response) => response.json() as Promise<{ voices: VoiceRow[]; default_voice_ulid?: string }>)
      .then((body) => {
        setRows(body.voices);
        setDefaultVoice(body.default_voice_ulid ?? null);
      })
      .catch(() => setRows([]));
  }, []);

  // PRD-08:202's row actions. Bind asks for the Character by handle, which is
  // what a @mention is; the three were reachable only from inside a Character
  // (UX-16).
  async function manage(body: Record<string, unknown>): Promise<unknown> {
    const response = await apiFetch('/api/voices/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const answer = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) throw new Error(answer.error?.message ?? message('characters.voices.actionFailed'));
    return answer;
  }

  async function bindRow(voice: VoiceRow): Promise<void> {
    const handle = window.prompt(
      message('characters.voices.bindHandlePrompt').replace('{voice}', voice.name),
    );
    if (!handle) return;
    try {
      await manage({
        action: 'bind',
        handle: handle.replace(/^@/, ''),
        ...(voice.id
          ? { voice_ulid: voice.id }
          : { preset_provider: voice.provider, preset_voice_id: voice.voice_id, preset_name: voice.name }),
      });
      setNote(
        message('characters.voices.bindDone')
          .replace('{voice}', voice.name)
          .replace('{handle}', handle.replace(/^@/, '')),
      );
      reload();
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : message('characters.voices.actionFailed'));
    }
  }

  async function makeDefault(voice: VoiceRow): Promise<void> {
    if (!voice.id) return;
    try {
      await manage({ action: 'set_default', voice_ulid: voice.id });
      setDefaultVoice(voice.id);
      setNote(message('characters.voices.defaultDone').replace('{voice}', voice.name));
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : message('characters.voices.actionFailed'));
    }
  }

  async function removeVoice(voice: VoiceRow): Promise<void> {
    if (!voice.id) return;
    if (!window.confirm(message('characters.voices.deleteConfirm').replace('{voice}', voice.name))) return;
    try {
      await manage({ action: 'delete', voice_ulid: voice.id });
      reload();
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : message('characters.voices.actionFailed'));
    }
  }

  useEffect(() => {
    reload();
    void fetch('/api/providers')
      .then(
        (response) => response.json() as Promise<{ providers: Array<{ id: string; connected: boolean }> }>,
      )
      .then((body) => {
        const connected = new Set(body.providers.filter((p) => p.connected).map((p) => p.id));
        setDesignProvider(connected.has('minimax') ? 'minimax' : connected.has('fal') ? 'fal' : null);
      })
      .catch(() => setDesignProvider(null));
  }, [reload]);

  const submitDesign = useCallback(() => {
    if (!designProvider) return;
    setDesigning(true);
    setDesignNote(undefined);
    void apiFetch('/api/voices/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'design',
        name: designName,
        provider: designProvider,
        description: designDescription,
        preview_text: designPreview,
        ...(designLanguage ? { language: designLanguage } : {}),
        ...(designGender ? { gender: designGender } : {}),
        confirm_cost_usd: DESIGN_COST_USD,
      }),
    })
      .then(
        (response) =>
          response.json() as Promise<{ voice?: { voice_id: string }; error?: { message: string } }>,
      )
      .then((body) => {
        if (body.error) throw new Error(body.error.message);
        setDesignNote(message('characters.voices.designDone'));
        setDesignOpen(false);
        reload();
      })
      .catch((cause: unknown) =>
        setDesignNote(cause instanceof Error ? cause.message : message('characters.voices.designFailed')),
      )
      .finally(() => setDesigning(false));
  }, [designProvider, designName, designDescription, designPreview, designLanguage, designGender, reload]);

  const visible = useMemo(() => (rows ? filterVoiceRows(rows, provider, '') : []), [rows, provider]);

  return (
    <div className="voices-tab" data-testid="voices-tab">
      <div className="characters-filters">
        <label className="characters-sort">
          {message('characters.voices.filterProvider')}
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="">{message('characters.voices.allProviders')}</option>
            {VOICE_FILTER_PROVIDERS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        {designProvider ? (
          <button
            type="button"
            className="btn"
            data-testid="voice-design-open"
            onClick={() => setDesignOpen(true)}
          >
            {message('characters.voices.design')}
          </button>
        ) : null}
        {/* PRD-08:226 puts "Clone voice" on this tab; it was reachable only from
            inside a Character (F-118). */}
        <button
          type="button"
          className="btn"
          data-testid="voice-clone-open"
          onClick={() => setCloneOpen(true)}
        >
          {message('characters.voices.clone')}
        </button>
      </div>
      {designOpen && designProvider ? (
        <form
          className="voice-design-form"
          role="form"
          aria-label={message('characters.voices.designTitle')}
          onSubmit={(event) => {
            event.preventDefault();
            submitDesign();
          }}
        >
          <p className="muted">{message('characters.voices.designSynthetic')}</p>
          <label>
            {message('characters.voices.designName')}
            <input
              type="text"
              value={designName}
              onChange={(event) => setDesignName(event.target.value)}
              required
            />
          </label>
          <label>
            {message('characters.voices.designDescription')}
            <textarea
              value={designDescription}
              maxLength={MAX_DESIGN_DESCRIPTION}
              onChange={(event) => setDesignDescription(event.target.value)}
              required
            />
          </label>
          <label>
            {message('characters.voices.designPreview')}
            <input
              type="text"
              value={designPreview}
              onChange={(event) => setDesignPreview(event.target.value)}
              required
            />
          </label>
          <label>
            {message('characters.voices.designLanguage')}
            <input
              type="text"
              value={designLanguage}
              placeholder={message('characters.voices.designLanguageHint')}
              onChange={(event) => setDesignLanguage(event.target.value)}
            />
          </label>
          <label>
            {message('characters.voices.designGender')}
            <select value={designGender} onChange={(event) => setDesignGender(event.target.value)}>
              <option value="">{message('characters.voices.designGenderUnset')}</option>
              <option value="female">{message('characters.voices.designGenderFemale')}</option>
              <option value="male">{message('characters.voices.designGenderMale')}</option>
              <option value="neutral">{message('characters.voices.designGenderNeutral')}</option>
            </select>
          </label>
          <p className="voice-design-price" data-money="true" data-testid="voice-design-price">
            ${DESIGN_COST_USD.toFixed(2)}
          </p>
          <div className="voice-design-actions">
            <button type="button" className="btn" onClick={() => setDesignOpen(false)}>
              {message('characters.voices.designCancel')}
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={designing || designName === '' || designDescription === ''}
              data-testid="voice-design-submit"
            >
              {message('characters.voices.designConfirm')}
            </button>
          </div>
        </form>
      ) : null}
      {designNote ? (
        <p className="voices-note" role="status" data-testid="voice-design-note">
          {designNote}
        </p>
      ) : null}
      {rows && visible.length === 0 ? (
        <p className="muted voices-empty">{message('characters.voices.empty')}</p>
      ) : (
        <table className="voices-table">
          <thead>
            <tr>
              <th aria-label={message('characters.voices.play')} />
              <th>{message('characters.voices.colName')}</th>
              <th>{message('characters.voices.colProvider')}</th>
              <th>{message('characters.voices.colLanguage')}</th>
              <th>{message('characters.voices.colGender')}</th>
              <th>{message('characters.voices.colTags')}</th>
              <th>{message('characters.voices.colPrice')}</th>
              <th>{message('characters.voices.colType')}</th>
              <th aria-label={message('characters.voices.bindTo')} />
            </tr>
          </thead>
          <tbody>
            {visible.map((voice) => (
              <tr key={`${voice.provider}:${voice.voice_id}`} data-testid="voice-row">
                <td>
                  <button
                    type="button"
                    className="voices-play"
                    aria-label={message('characters.voices.play')}
                    title={message('characters.voices.previewUnavailable')}
                    onClick={() => setNote(message('characters.voices.previewUnavailable'))}
                  >
                    ▶
                  </button>
                </td>
                <td>{voice.name}</td>
                {/* UX-16: the user reads a name, not a provider id. */}
                <td>{voiceProviderLabel(voice.provider)}</td>
                <td>{voice.language}</td>
                <td>{voice.gender}</td>
                <td className="voices-tags">
                  {voice.tags.map((tag) => (
                    <span key={tag} className="character-tag">
                      {tag}
                    </span>
                  ))}
                </td>
                <td data-money="true">{voice.price_label}</td>
                <td>
                  {voice.kind === 'designed'
                    ? message('characters.voices.typeDesigned')
                    : voice.kind === 'clone'
                      ? message('characters.voices.typeClone')
                      : message('characters.voices.typePreset')}
                  {voice.id && voice.id === defaultVoice ? (
                    <span className="voices-default"> · {message('characters.voices.isDefault')}</span>
                  ) : null}
                </td>
                {/* PRD-08:202's row actions; Delete is for stored voices only. */}
                <td className="voices-actions">
                  <button type="button" onClick={() => void bindRow(voice)}>
                    {message('characters.voices.bindTo')}
                  </button>
                  {voice.id ? (
                    <>
                      <button type="button" onClick={() => void makeDefault(voice)}>
                        {message('characters.voices.setDefault')}
                      </button>
                      <button type="button" className="danger-text" onClick={() => void removeVoice(voice)}>
                        {message('characters.voices.deleteVoice')}
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {cloneOpen ? (
        <CloneVoiceDrawer
          onClose={() => setCloneOpen(false)}
          onCloned={() => {
            setCloneOpen(false);
            reload();
          }}
        />
      ) : null}
      {note ? (
        <p className="muted voices-note" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}
