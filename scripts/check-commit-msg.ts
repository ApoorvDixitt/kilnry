// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { checkCommitSubject } from './commit-subject';

// The commit-msg hook passes the path of the file holding the proposed message.
const messagePath = process.argv[2];
if (!messagePath) {
  process.stderr.write('check-commit-msg expects the commit message file path as its argument.\n');
  process.exit(1);
}

const message = readFileSync(messagePath, 'utf8');

const staged = spawnSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' });
const changed = staged.status === 0 ? staged.stdout.split('\n').filter(Boolean) : [];
const touchesProductCode = changed.some((path) => path.startsWith('apps/') || path.startsWith('packages/'));

const reason = checkCommitSubject({ message, touchesProductCode });
if (reason) {
  process.stderr.write(`Commit message rejected: ${reason}\n`);
  process.stderr.write(
    'Use the form "type(area): what changed and why it matters (F-XXX-NN)" from decision D-50.\n',
  );
  process.exit(1);
}
