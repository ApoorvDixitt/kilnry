// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// A loopback stand-in for the GitHub releases host, used only by the e2e run
// (F-SET-07). The app's KILNRY_RELEASES_BASE (TRD-18 §1) points here, so the
// Updates "Check now" request is a real HTTP GET that this server answers — no
// mock inside the app process. It serves the two manifests the check reads and
// counts every manifest request so the test can assert that nothing is fetched
// until the user clicks (PRD-16 §7 acceptance 1).

import { createServer, type Server } from 'node:http';

export const RELEASES_FIXTURE_PORT = 3124;

// The stable and beta manifests. 9.9.9 is far newer than any real build, so the
// check always resolves to "available"; the beta manifest carries a beta note.
const STABLE_MANIFEST = {
  version: '9.9.9',
  released_at: '1 Dec',
  notes: 'What is new in 9.9.9:\n- A fixture release used only by the Kilnry e2e suite.',
};
const BETA_MANIFEST = {
  version: '9.9.9',
  released_at: '1 Dec',
  notes: 'Beta channel 9.9.9: pre-release build for testing. Expect rough edges.',
};

export function startReleasesFixture(port = RELEASES_FIXTURE_PORT): { server: Server; count: () => number } {
  let manifestRequests = 0;
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (url.startsWith('/__count')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ manifest_requests: manifestRequests }));
      return;
    }
    if (url.includes('/download/beta/manifest.json')) {
      manifestRequests += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(BETA_MANIFEST));
      return;
    }
    if (url.includes('/latest/download/manifest.json')) {
      manifestRequests += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(STABLE_MANIFEST));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
  });
  server.listen(port, '127.0.0.1');
  return { server, count: () => manifestRequests };
}
