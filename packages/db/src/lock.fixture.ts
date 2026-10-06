// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Child process for the data-directory lock test (F-101). Opens a file-backed
// database on argv[2], prints OPENED, writes `count` rows tagged with `tag`
// one at a time while printing WROTE <n>, then prints DONE and waits for
// SIGTERM so the parent decides when it lets go of the directory.

import { closeDatabaseState, createDatabase } from './client.js';

async function main(): Promise<void> {
  const [dataDir, tag, countText] = process.argv.slice(2);
  if (!dataDir || !tag) throw new Error('lock fixture needs <dataDir> <tag> [count]');
  const count = Number(countText ?? '20');
  const state = createDatabase(dataDir);
  await state.ready;
  process.stdout.write('OPENED\n');
  await state.client.exec('create table if not exists lock_probe (tag text not null, n int not null)');
  for (let n = 1; n <= count; n += 1) {
    await state.client.query('insert into lock_probe(tag, n) values ($1, $2)', [tag, n]);
    process.stdout.write(`WROTE ${n}\n`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  process.stdout.write('DONE\n');
  process.once('SIGTERM', () => {
    void closeDatabaseState(state).then(() => process.exit(0));
  });
  setInterval(() => undefined, 1000);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(3);
});
