// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { spawn } from 'node:child_process';

export function openBrowser(url: string): void {
  if (process.env.KILNRY_NO_OPEN === '1') return;
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? { file: 'rundll32', args: ['url.dll,FileProtocolHandler', url] }
        : { file: 'xdg-open', args: [url] };
  const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' });
  child.once('error', (error) => {
    process.stderr.write(`Could not open a browser: ${error.message}. Open ${url} yourself.\n`);
  });
  child.unref();
}
