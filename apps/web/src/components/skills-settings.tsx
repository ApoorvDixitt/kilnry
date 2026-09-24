'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';
import {
  isReadOnly,
  licenseLabel,
  npxInstallCommand,
  sourceLabelKey,
  type SkillRow,
} from './skills-settings-logic';

export function SkillsSettings(): React.ReactNode {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState<{ name: string; body: string } | null>(null);
  const [pending, setPending] = useState(false);

  function refresh(): void {
    void fetch('/api/skills')
      .then((response) => (response.ok ? (response.json() as Promise<{ skills: SkillRow[] }>) : null))
      .then((body) => {
        if (body) setSkills(body.skills);
      });
  }

  useEffect(refresh, []);

  async function toggle(skill: SkillRow): Promise<void> {
    setPending(true);
    try {
      await apiFetch(`/api/skills/${encodeURIComponent(skill.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !skill.enabled }),
      });
      refresh();
    } finally {
      setPending(false);
    }
  }

  async function showPreview(skill: SkillRow): Promise<void> {
    const response = await fetch(`/api/skills/${encodeURIComponent(skill.name)}`);
    if (!response.ok) return;
    const body = (await response.json()) as { skill: { name: string; body_markdown: string } };
    setPreview({ name: body.skill.name, body: body.skill.body_markdown });
  }

  async function uninstall(skill: SkillRow): Promise<void> {
    setPending(true);
    try {
      const response = await apiFetch(`/api/skills/${encodeURIComponent(skill.name)}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { reason?: string };
        setStatus(body.reason ?? message('settings.skills.removeFailed'));
        return;
      }
      refresh();
    } finally {
      setPending(false);
    }
  }

  async function installFromUrl(): Promise<void> {
    if (url.trim() === '') return;
    setPending(true);
    setStatus('');
    try {
      const response = await apiFetch('/api/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        issues?: Array<{ message: string }>;
      };
      if (response.ok && body.ok) {
        setUrl('');
        setStatus(message('settings.skills.installed'));
        refresh();
      } else {
        setStatus(body.issues?.[0]?.message ?? message('settings.skills.installFailed'));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="settings-panel" aria-label={message('settings.skills.title')}>
      <h2>{message('settings.skills.title')}</h2>
      <p className="settings-hint">{message('settings.skills.intro')}</p>

      <div className="skills-install">
        <label htmlFor="skill-url">{message('settings.skills.installLabel')}</label>
        <div className="skills-install-row">
          <input
            id="skill-url"
            type="url"
            value={url}
            placeholder={message('settings.skills.installPlaceholder')}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button type="button" onClick={() => void installFromUrl()} disabled={pending || url.trim() === ''}>
            {message('settings.skills.install')}
          </button>
        </div>
        <code className="skills-npx">{npxInstallCommand(url)}</code>
        {status !== '' ? <p className="settings-status">{status}</p> : null}
      </div>

      <ul className="skills-list">
        {skills.map((skill) => (
          <li key={skill.name} className="skills-row">
            <div className="skills-row-main">
              <span className="skills-name">{skill.name}</span>
              <span className="skills-source">{message(sourceLabelKey(skill.source))}</span>
              {licenseLabel(skill.license) !== '' ? (
                <span className="skills-license">{licenseLabel(skill.license)}</span>
              ) : (
                <span className="skills-license is-muted">{message('settings.skills.noLicense')}</span>
              )}
            </div>
            <p className="skills-description">{skill.description}</p>
            <div className="skills-row-actions">
              <label className="skills-toggle">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  disabled={pending}
                  onChange={() => void toggle(skill)}
                />
                <span>{message('settings.skills.enabled')}</span>
              </label>
              <button type="button" onClick={() => void showPreview(skill)}>
                {message('settings.skills.preview')}
              </button>
              {!isReadOnly(skill.source) ? (
                <button type="button" onClick={() => void uninstall(skill)} disabled={pending}>
                  {message('settings.skills.remove')}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {preview ? (
        <div className="skills-preview" role="dialog" aria-label={message('settings.skills.previewLabel')}>
          <header>
            <span>{preview.name}</span>
            <button type="button" onClick={() => setPreview(null)}>
              {message('settings.skills.close')}
            </button>
          </header>
          <pre>{preview.body}</pre>
        </div>
      ) : null}
    </section>
  );
}
