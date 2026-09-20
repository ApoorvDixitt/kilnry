'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import {
  MCP_CLIENTS,
  connectionSnippet,
  lastUsedLabel,
  type McpClient,
  type McpTokenRow,
} from './mcp-settings-logic';

const CLIENT_LABELS: Record<McpClient, string> = {
  claude_code: 'settings.mcp.clientClaudeCode',
  claude_desktop: 'settings.mcp.clientClaudeDesktop',
  cursor: 'settings.mcp.clientCursor',
  codex: 'settings.mcp.clientCodex',
};

export function McpSettings({ port }: { port: number }): React.ReactNode {
  const [tokens, setTokens] = useState<McpTokenRow[]>([]);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'full' | 'read_only'>('full');
  const [secret, setSecret] = useState<string | null>(null);
  const [client, setClient] = useState<McpClient>('claude_code');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  function refresh(): void {
    void fetch('/api/mcp/tokens')
      .then((response) => (response.ok ? (response.json() as Promise<{ tokens: McpTokenRow[] }>) : null))
      .then((body) => {
        if (body) setTokens(body.tokens);
      })
      .catch(() => setStatus(message('settings.mcp.saveFailed')));
  }

  useEffect(refresh, []);

  async function create(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    setStatus('');
    try {
      const response = await apiFetch('/api/mcp/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scope }),
      });
      const body = (await response.json()) as { token?: string };
      if (!response.ok || !body.token) throw new Error('failed');
      setSecret(body.token);
      setName('');
      refresh();
    } catch {
      setStatus(message('settings.mcp.saveFailed'));
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string): Promise<void> {
    if (!confirm(message('settings.mcp.revokeConfirm'))) return;
    try {
      await apiFetch('/api/mcp/tokens', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      refresh();
    } catch {
      setStatus(message('settings.mcp.saveFailed'));
    }
  }

  // The most recent token's secret (once) is used to pre-fill snippets; before
  // any token is created the snippets show the <TOKEN> placeholder.
  const snippetToken = secret ?? '<TOKEN>';

  return (
    <section className="settings-panel" aria-label={message('settings.mcp.title')}>
      <p className="settings-eyebrow">{message('settings.mcp.eyebrow')}</p>
      <h1>{message('settings.mcp.title')}</h1>
      <p className="settings-subtitle">{message('settings.mcp.subtitle')}</p>

      <h2>{message('settings.mcp.tokensTitle')}</h2>
      <p className="settings-subtitle">{message('settings.mcp.tokensSubtitle')}</p>

      <form className="mcp-token-form" onSubmit={(event) => void create(event)}>
        <label>
          <span>{message('settings.mcp.nameLabel')}</span>
          <input
            value={name}
            placeholder={message('settings.mcp.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          <span>{message('settings.mcp.scopeLabel')}</span>
          <select value={scope} onChange={(event) => setScope(event.target.value as 'full' | 'read_only')}>
            <option value="full">{message('settings.mcp.scopeFull')}</option>
            <option value="read_only">{message('settings.mcp.scopeReadOnly')}</option>
          </select>
        </label>
        <button type="submit" disabled={pending || name.trim().length === 0}>
          {message('settings.mcp.create')}
        </button>
      </form>

      {secret ? (
        <div className="mcp-token-secret" role="status">
          <p>{message('settings.mcp.created')}</p>
          <code>{secret}</code>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(secret)}>
            {message('settings.mcp.copy')}
          </button>
        </div>
      ) : null}

      {tokens.length === 0 ? (
        <p className="mcp-token-empty">{message('settings.mcp.empty')}</p>
      ) : (
        <ul className="mcp-token-list">
          {tokens.map((token) => (
            <li key={token.id} data-revoked={token.revoked}>
              <span className="mcp-token-name">{token.name}</span>
              <span className="mcp-token-scope">{token.scope}</span>
              <span className="mcp-token-used">
                {message('settings.mcp.lastUsed')}: {lastUsedLabel(token)}
              </span>
              {token.revoked ? (
                <span className="mcp-token-revoked">{message('settings.mcp.revoked')}</span>
              ) : (
                <button type="button" onClick={() => void revoke(token.id)}>
                  {message('settings.mcp.revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>{message('settings.mcp.snippetsTitle')}</h2>
      <div className="mcp-client-tabs" role="tablist" aria-label={message('settings.mcp.snippetsTitle')}>
        {MCP_CLIENTS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={client === option}
            className={client === option ? 'is-on' : ''}
            onClick={() => setClient(option)}
          >
            {message(CLIENT_LABELS[option])}
          </button>
        ))}
      </div>
      <pre className="mcp-snippet">
        <code>{connectionSnippet(client, snippetToken, port)}</code>
      </pre>
      <button
        type="button"
        className="mcp-snippet-copy"
        onClick={() => void navigator.clipboard?.writeText(connectionSnippet(client, snippetToken, port))}
      >
        {message('settings.mcp.copy')}
      </button>
      <p className="settings-subtitle">{message('settings.mcp.snippetHint')}</p>
      {status ? <p className="form-error">{status}</p> : null}
    </section>
  );
}
