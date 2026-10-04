'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

interface UpdatesInfo {
  current: string;
  channel: 'stable' | 'beta';
  auto_check: boolean;
  update_command: string;
}

type CheckState =
  | { status: 'up_to_date'; current: string }
  | { status: 'available'; current: string; latest: string; released_at?: string; notes?: string }
  | { status: 'offline'; current: string };

export function UpdatesSettings({ initial }: { initial: UpdatesInfo }): React.ReactNode {
  const [info, setInfo] = useState<UpdatesInfo>(initial);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckState>();
  const [copied, setCopied] = useState(false);

  const persist = useCallback((patch: Partial<Pick<UpdatesInfo, 'channel' | 'auto_check'>>) => {
    setInfo((prev) => (prev ? { ...prev, ...patch } : prev));
    void apiFetch('/api/updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(patch.channel ? { update_channel: patch.channel } : {}),
        ...(patch.auto_check === undefined ? {} : { update_check: patch.auto_check }),
      }),
    }).catch(() => undefined);
  }, []);

  // The one explicit network call: only when the user clicks Check now
  // (F-SET-07 / F-NFR-02 — no request to GitHub otherwise).
  const checkNow = useCallback(() => {
    setChecking(true);
    setResult(undefined);
    void apiFetch('/api/updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check' }),
    })
      .then((response) => response.json() as Promise<{ state: CheckState }>)
      .then((body) => setResult(body.state))
      .catch(() => setResult({ status: 'offline', current: info.current }))
      .finally(() => setChecking(false));
  }, [info]);

  return (
    <section className="settings-section updates-settings" data-testid="updates-settings">
      <h1>{message('settings.updates.title')}</h1>
      <p className="updates-version" data-testid="updates-version">
        {message('settings.updates.version').replace('{version}', info.current)}
      </p>

      <label className="updates-channel">
        {message('settings.updates.channel')}
        <select
          value={info.channel}
          onChange={(event) => persist({ channel: event.target.value as 'stable' | 'beta' })}
        >
          <option value="stable">{message('settings.updates.channelStable')}</option>
          <option value="beta">{message('settings.updates.channelBeta')}</option>
        </select>
      </label>
      {info.channel === 'beta' ? (
        <p className="updates-beta-note" role="note">
          {message('settings.updates.betaNote')}
        </p>
      ) : null}

      <label className="updates-autocheck">
        <input
          type="checkbox"
          checked={info.auto_check}
          onChange={(event) => persist({ auto_check: event.target.checked })}
        />
        {message('settings.updates.autoCheck')}
      </label>

      <button
        type="button"
        className="btn"
        disabled={checking}
        data-testid="updates-check"
        onClick={checkNow}
      >
        {message('settings.updates.checkNow')}
      </button>

      {result ? (
        <div className="updates-result" role="status" data-testid="updates-result">
          {result.status === 'up_to_date' ? (
            <p>{message('settings.updates.upToDate')}</p>
          ) : result.status === 'offline' ? (
            <p>{message('settings.updates.offline')}</p>
          ) : (
            <>
              <p data-testid="updates-available">
                {message('settings.updates.available')
                  .replace('{version}', result.latest)
                  .replace('{date}', result.released_at ?? '')}
              </p>
              {result.notes ? <pre className="updates-notes">{result.notes}</pre> : null}
            </>
          )}
        </div>
      ) : null}

      <div className="updates-command">
        <p>{message('settings.updates.command')}</p>
        <code data-testid="updates-command">{info.update_command}</code>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void navigator.clipboard?.writeText(info.update_command).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? message('settings.updates.copied') : message('settings.updates.copy')}
        </button>
      </div>

      <p className="updates-backup muted">{message('settings.updates.backup')}</p>
    </section>
  );
}
