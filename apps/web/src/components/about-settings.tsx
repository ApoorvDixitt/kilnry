'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

interface AboutInfo {
  version: string;
  platform: string;
  arch: string;
  node: string;
  next: string;
  pglite: string;
  ffmpeg: string;
  data_dir: string;
  build_line: string;
  license: string;
  license_url: string;
  no_telemetry: string;
}

interface Notice {
  name: string;
  version: string;
  license: string;
}

const LINKS = [
  { key: 'docs', href: 'https://docs.kilnry.app' },
  { key: 'github', href: 'https://github.com/ApoorvDixitt/kilnry' },
  { key: 'changelog', href: 'https://github.com/ApoorvDixitt/kilnry/blob/main/CHANGELOG.md' },
  { key: 'roadmap', href: 'https://github.com/ApoorvDixitt/kilnry/blob/main/docs/STATUS.md' },
  { key: 'report', href: 'https://github.com/ApoorvDixitt/kilnry/issues/new' },
] as const;

export function AboutSettings({ initial }: { initial: AboutInfo }): React.ReactNode {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [licenceText, setLicenceText] = useState<string>();
  const [confirmDiagnostics, setConfirmDiagnostics] = useState(false);
  const [diagnosticsPath, setDiagnosticsPath] = useState<string>();
  const [diagnosticsError, setDiagnosticsError] = useState<string>();

  const loadNotices = useCallback(() => {
    void apiFetch('/api/about', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'notices' }),
    })
      .then((response) => response.json() as Promise<{ packages: Notice[] }>)
      .then((body) => setNotices(body.packages))
      .catch(() => setNotices([]));
  }, []);

  const openLicence = useCallback(() => {
    void apiFetch(initial.license_url)
      .then((response) => response.text())
      .then((text) => setLicenceText(text))
      .catch(() => setLicenceText(message('settings.about.licenceUnavailableBody')));
  }, [initial.license_url]);

  const exportDiagnostics = useCallback(() => {
    setConfirmDiagnostics(false);
    setDiagnosticsError(undefined);
    void apiFetch('/api/about', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'diagnostics' }),
    })
      .then((response) => response.json() as Promise<{ path?: string; error?: { message?: string } }>)
      .then((body) => {
        if (body.path) setDiagnosticsPath(body.path);
        else setDiagnosticsError(body.error?.message ?? message('settings.about.diagnosticsFailed'));
      })
      .catch(() => setDiagnosticsError(message('settings.about.diagnosticsFailed')));
  }, []);

  return (
    <section className="settings-section about-settings" data-testid="about-settings">
      <h1>{message('settings.about.title')}</h1>
      <p className="about-version" data-testid="about-version">
        {message('settings.about.product').replace('{version}', initial.version)}
      </p>
      <p className="about-build muted" data-testid="about-build">
        {initial.build_line}
      </p>

      <h2>{message('settings.about.licenceHeading')}</h2>
      <p>{initial.license}</p>
      <button type="button" className="btn" data-testid="about-read-licence" onClick={openLicence}>
        {message('settings.about.readLicence')}
      </button>
      <p className="about-no-telemetry">{initial.no_telemetry}</p>

      <h2>{message('settings.about.linksHeading')}</h2>
      <ul className="about-links">
        {LINKS.map((link) => (
          <li key={link.key}>
            <a href={link.href} target="_blank" rel="noreferrer">
              {message(`settings.about.link.${link.key}`)}
            </a>
          </li>
        ))}
      </ul>

      <h2>{message('settings.about.noticesHeading')}</h2>
      {notices ? (
        <ul className="about-notices" data-testid="about-notices">
          {notices.slice(0, 500).map((pkg) => (
            <li key={pkg.name}>
              {pkg.name} {pkg.version} — {pkg.license}
            </li>
          ))}
        </ul>
      ) : (
        <button type="button" className="btn" data-testid="about-notices-load" onClick={loadNotices}>
          {message('settings.about.showNotices')}
        </button>
      )}
      <p className="muted">{message('settings.about.ffmpegNote')}</p>

      <h2>{message('settings.about.diagnosticsHeading')}</h2>
      <p className="muted">{message('settings.about.diagnosticsBody')}</p>
      <button
        type="button"
        className="btn"
        data-testid="about-diagnostics"
        onClick={() => setConfirmDiagnostics(true)}
      >
        {message('settings.about.exportDiagnostics')}
      </button>
      {diagnosticsPath ? (
        <p className="about-diagnostics-note" role="status" data-testid="about-diagnostics-path">
          {message('settings.about.diagnosticsDone').replace('{path}', diagnosticsPath)}
        </p>
      ) : null}
      {diagnosticsError ? (
        <p className="about-diagnostics-error" role="alert">
          {diagnosticsError}
        </p>
      ) : null}

      <h2>{message('settings.about.toolsHeading')}</h2>
      <ul className="about-tools">
        <li>
          <Link href="/?checklist=1" data-testid="about-checklist">
            {message('settings.about.showChecklist')}
          </Link>
        </li>
        <li>
          <Link href="/settings/security" data-testid="about-recovery-kit">
            {message('settings.about.recoveryKit')}
          </Link>
        </li>
      </ul>
      <p className="about-data-folder" data-testid="about-data-folder">
        {message('settings.about.dataFolder').replace('{path}', initial.data_dir)}
      </p>

      {confirmDiagnostics ? (
        <div
          className="dialog-backdrop"
          role="dialog"
          aria-modal="true"
          data-testid="about-diagnostics-confirm"
        >
          <div className="dialog">
            <p>{message('settings.about.diagnosticsConfirm')}</p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setConfirmDiagnostics(false)}>
                {message('settings.about.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="about-diagnostics-confirm-go"
                onClick={exportDiagnostics}
              >
                {message('settings.about.exportDiagnostics')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {licenceText !== undefined ? (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" data-testid="about-licence-dialog">
          <div className="dialog">
            <h3>{message('settings.about.licenceHeading')}</h3>
            <pre className="licence-text">{licenceText}</pre>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setLicenceText(undefined)}>
                {message('settings.about.close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
