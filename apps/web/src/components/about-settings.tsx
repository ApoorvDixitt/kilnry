'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { message } from '../lib/messages';

interface AboutInfo {
  version: string;
  node: string;
  platform: string;
  arch: string;
  license: string;
  license_url: string;
  no_telemetry: string;
}

export function AboutSettings({ initial }: { initial: AboutInfo }): React.ReactNode {
  const [packages, setPackages] = useState<Array<{ name: string; version: string }> | null>(null);
  const [diagnosticsNote, setDiagnosticsNote] = useState<string>();

  const loadNotices = useCallback(() => {
    void apiFetch('/api/about', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'notices' }),
    })
      .then((response) => response.json() as Promise<{ packages: Array<{ name: string; version: string }> }>)
      .then((body) => setPackages(body.packages))
      .catch(() => setPackages([]));
  }, []);

  const exportDiagnostics = useCallback(() => {
    void apiFetch('/api/about', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'diagnostics' }),
    })
      .then((response) => response.json() as Promise<{ diagnostics?: unknown }>)
      .then((body) => {
        const blob = new Blob([JSON.stringify(body.diagnostics, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'kilnry-diagnostics.json';
        anchor.click();
        URL.revokeObjectURL(url);
        setDiagnosticsNote(message('settings.about.diagnosticsDone'));
      })
      .catch(() => setDiagnosticsNote(message('settings.about.diagnosticsFailed')));
  }, []);

  return (
    <section className="settings-section about-settings" data-testid="about-settings">
      <h1>{message('settings.about.title')}</h1>
      <p className="about-version" data-testid="about-version">
        {message('settings.about.version').replace('{version}', initial.version)}
      </p>
      <p className="about-build muted" data-testid="about-build">
        {message('settings.about.build')
          .replace('{node}', initial.node)
          .replace('{platform}', `${initial.platform}-${initial.arch}`)}
      </p>

      <h2>{message('settings.about.licenceHeading')}</h2>
      <p>{initial.license}</p>
      <a className="btn" href={initial.license_url} target="_blank" rel="noreferrer">
        {message('settings.about.readLicence')}
      </a>
      <p className="about-no-telemetry">{initial.no_telemetry}</p>

      <h2>{message('settings.about.noticesHeading')}</h2>
      {packages ? (
        <ul className="about-notices" data-testid="about-notices">
          {packages.slice(0, 500).map((pkg) => (
            <li key={pkg.name}>
              {pkg.name} {pkg.version}
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
      <button type="button" className="btn" data-testid="about-diagnostics" onClick={exportDiagnostics}>
        {message('settings.about.exportDiagnostics')}
      </button>
      {diagnosticsNote ? (
        <p className="about-diagnostics-note" role="status">
          {diagnosticsNote}
        </p>
      ) : null}
    </section>
  );
}
