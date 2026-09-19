// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { spawnSync } from 'node:child_process';

import { checkCommitSubject, SUBJECT_RULE_BASE } from './commit-subject';

const ownerName = 'Apoorv Dixit';
const allowedEmails = new Set(['177645159+ApoorvDixitt@users.noreply.github.com']);
const bannedPaths = [
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^GEMINI\.md$/,
  /^\.cursor(?:\/|$)/,
  /^\.cursorrules$/,
  /^\.claude(?:\/|$)/,
  /^\.codex(?:\/|$)/,
  /^\.kiro(?:\/|$)/,
  /^\.github\/copilot-instructions\.md$/,
  /^\.windsurfrules$/,
  /^\.aider/,
  /^\.continue(?:\/|$)/,
  /\.prompt\.md$/,
];

function git(args: string[], allowNoCommits = false): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status === 0) return result.stdout;
  const message = result.stderr.trim();
  if (
    allowNoCommits &&
    /does not have any commits yet|unknown revision|bad revision|ambiguous argument 'HEAD'/.test(message)
  ) {
    return '';
  }
  throw new Error(`git ${args.join(' ')} failed: ${message}`);
}

const failures: string[] = [];
const tracked = git(['ls-files']).split('\n').filter(Boolean);
for (const path of tracked) {
  if (bannedPaths.some((pattern) => pattern.test(path))) failures.push(`tracked coding-agent file: ${path}`);
}

if (!process.env.CI) {
  const localName = git(['config', '--local', '--get', 'user.name']).trim();
  const localEmail = git(['config', '--local', '--get', 'user.email']).trim();
  if (localName !== ownerName) failures.push(`repository user.name must be ${ownerName}`);
  if (!allowedEmails.has(localEmail))
    failures.push(`repository user.email is not allowed: ${localEmail || '(unset)'}`);
} else {
  process.stdout.write('CI runner detected; validating committed identities rather than runner config.\n');
}

const log = git(['log', '--all', '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%G?%x1f%B%x1e'], true);
const unsigned: string[] = [];
for (const record of log
  .split('\x1e')
  .map((item) => item.trim())
  .filter(Boolean)) {
  const [
    hash = '',
    author = '',
    authorEmail = '',
    committer = '',
    committerEmail = '',
    signature = '',
    body = '',
  ] = record.split('\x1f');
  if (author !== ownerName || committer !== ownerName)
    failures.push(`${hash}: author and committer must be ${ownerName}`);
  if (!allowedEmails.has(authorEmail) || !allowedEmails.has(committerEmail))
    failures.push(`${hash}: unapproved email`);
  if (/^(Co-authored-by|Signed-off-by|Generated-by):/im.test(body))
    failures.push(`${hash}: prohibited trailer`);
  if (!['G', 'U'].includes(signature)) unsigned.push(hash);
}

// Decision D-50: every commit made after the M2 completion commit must have a
// subject a stranger can read. Older history predates the rule and is exempt.
const basePresent = git(['rev-parse', '--verify', '--quiet', `${SUBJECT_RULE_BASE}^{commit}`], true).trim();
if (basePresent) {
  const range = git(['log', `${SUBJECT_RULE_BASE}..HEAD`, '--no-merges', '--format=%H%x1f%B%x1e'], true);
  for (const record of range
    .split('\x1e')
    .map((item) => item.trim())
    .filter(Boolean)) {
    const [hash = '', message = ''] = record.split('\x1f');
    const changed = git(['show', '--name-only', '--format=', hash], true).split('\n').filter(Boolean);
    const touchesProductCode = changed.some(
      (path) => path.startsWith('apps/') || path.startsWith('packages/'),
    );
    const reason = checkCommitSubject({ message, touchesProductCode });
    if (reason) failures.push(`${hash}: unreadable commit subject — ${reason}`);
  }
} else {
  process.stdout.write('Subject-format base commit not present (shallow clone); skipping subject check.\n');
}

if (failures.length > 0) {
  process.stderr.write(`Provenance check failed:\n${failures.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(1);
}
if (unsigned.length > 0)
  process.stderr.write(`Warning: ${unsigned.length} commit(s) are unsigned by owner choice.\n`);
process.stdout.write(`Provenance verified across ${tracked.length} tracked files.\n`);
