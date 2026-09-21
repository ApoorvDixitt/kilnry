'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

interface ChatModel {
  provider: string;
  model: string;
  price_label: string;
  vision: boolean;
}

interface ChatSettingsBody {
  chat: {
    default_llm: { provider: string; model: string } | null;
    autonomy: 'ask_first' | 'run_automatically';
    session_budget_usd: number | null;
    ollama_base_url: string;
  };
  models: ChatModel[];
  ollama: { detected: boolean; base_url: string; models: number };
}

function refKey(model: { provider: string; model: string }): string {
  return `${model.provider}:${model.model}`;
}

export function ChatSettings(): React.ReactNode {
  const [models, setModels] = useState<ChatModel[]>([]);
  const [selected, setSelected] = useState('');
  const [autonomy, setAutonomy] = useState<'ask_first' | 'run_automatically'>('ask_first');
  const [budget, setBudget] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [ollama, setOllama] = useState<ChatSettingsBody['ollama'] | null>(null);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    try {
      const response = await fetch('/api/settings/chat');
      if (!response.ok) throw new Error(message('settings.chat.saveFailed'));
      const body = (await response.json()) as ChatSettingsBody;
      setModels(body.models);
      setSelected(body.chat.default_llm ? refKey(body.chat.default_llm) : '');
      setAutonomy(body.chat.autonomy);
      setBudget(body.chat.session_budget_usd === null ? '' : String(body.chat.session_budget_usd));
      setOllamaUrl(body.chat.ollama_base_url);
      setOllama(body.ollama);
    } catch {
      setStatus(message('settings.chat.saveFailed'));
    }
  }

  // Run automatically is a spending change: confirm before switching to it.
  function chooseAutonomy(next: 'ask_first' | 'run_automatically'): void {
    if (next === 'run_automatically' && !window.confirm(message('settings.chat.autonomyConfirm'))) return;
    setAutonomy(next);
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setStatus('');
    try {
      const [provider, ...rest] = selected.split(':');
      const response = await apiFetch('/api/settings/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_llm: selected === '' ? null : { provider, model: rest.join(':') },
          autonomy,
          session_budget_usd: budget.trim() === '' ? null : Number(budget),
          ollama_base_url: ollamaUrl,
        }),
      });
      if (!response.ok) throw new Error(message('settings.chat.saveFailed'));
      setStatus(message('settings.chat.saved'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : message('settings.chat.saveFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="settings-content chat-settings" onSubmit={(event) => void save(event)}>
      <header className="settings-heading">
        <p>{message('settings.chat.eyebrow')}</p>
        <h2>{message('settings.chat.title')}</h2>
        <span>{message('settings.chat.subtitle')}</span>
      </header>

      <label className="chat-field">
        <span>{message('settings.chat.defaultModel')}</span>
        {models.length === 0 ? (
          <p className="chat-empty">{message('settings.chat.noModels')}</p>
        ) : (
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {models.map((model) => (
              <option key={refKey(model)} value={refKey(model)}>
                {model.provider} · {model.model} · {model.price_label}
                {model.vision ? ` · ${message('settings.chat.visionLabel')}` : ''}
              </option>
            ))}
          </select>
        )}
        <small>{message('settings.chat.defaultModelHelp')}</small>
      </label>

      <fieldset className="chat-field">
        <legend>{message('settings.chat.autonomy')}</legend>
        <label>
          <input
            type="radio"
            name="autonomy"
            value="ask_first"
            checked={autonomy === 'ask_first'}
            onChange={() => chooseAutonomy('ask_first')}
          />
          <span>{message('settings.chat.autonomyAskFirst')}</span>
          <small>{message('settings.chat.autonomyAskFirstHelp')}</small>
        </label>
        <label>
          <input
            type="radio"
            name="autonomy"
            value="run_automatically"
            checked={autonomy === 'run_automatically'}
            onChange={() => chooseAutonomy('run_automatically')}
          />
          <span>{message('settings.chat.autonomyAutomatic')}</span>
          <small>{message('settings.chat.autonomyAutomaticHelp')}</small>
        </label>
      </fieldset>

      <label className="chat-field">
        <span>{message('settings.chat.sessionBudget')}</span>
        <div className="budget-input">
          <span aria-hidden>$</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={budget}
            placeholder={message('settings.chat.sessionBudgetPlaceholder')}
            onChange={(event) => setBudget(event.target.value)}
          />
        </div>
        <small>{message('settings.chat.sessionBudgetHelp')}</small>
      </label>

      <label className="chat-field">
        <span>{message('settings.chat.ollamaUrl')}</span>
        <input type="text" value={ollamaUrl} onChange={(event) => setOllamaUrl(event.target.value)} />
        <button type="button" onClick={() => void load()}>
          {message('settings.chat.ollamaTest')}
        </button>
        {ollama ? (
          <small>
            {ollama.detected
              ? message('settings.chat.ollamaReachable').replace('{count}', String(ollama.models))
              : message('settings.chat.ollamaMissing')}
          </small>
        ) : null}
      </label>

      <section className="chat-later" aria-label={message('settings.chat.laterTitle')}>
        <h3>{message('settings.chat.laterTitle')}</h3>
        <p>{message('settings.chat.laterReasoning')}</p>
        <p>{message('settings.chat.laterMemory')}</p>
      </section>

      <button type="submit" disabled={pending}>
        {message('settings.chat.save')}
      </button>
      {status === '' ? null : <p role="status">{status}</p>}
    </form>
  );
}
