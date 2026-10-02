// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase, providerKeys } from '@kilnry/db';
import { ProviderKeyStore, type KeychainBridge } from './key-store.js';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

function memoryKeychain(): KeychainBridge & { value: string | undefined } {
  return {
    value: undefined,
    get() {
      return Promise.resolve(this.value);
    },
    set(value) {
      this.value = value;
      return Promise.resolve();
    },
  };
}

function unavailableKeychain(): KeychainBridge {
  return {
    get: () => Promise.reject(new Error('fixture keychain unavailable')),
    set: () => Promise.reject(new Error('fixture keychain unavailable')),
  };
}

function allBytes(root: string): Buffer {
  const chunks: Buffer[] = [];
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else chunks.push(readFileSync(child));
    }
  };
  walk(root);
  return Buffer.concat(chunks);
}

describe('provider key store', () => {
  it('locks on simulated key loss only under the test harness and never in a release build', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kilnry-keys-'));
    const state = createDatabase(dataDir, { memory: true });
    cleanup.push(async () => {
      await closeDatabaseState(state);
      rmSync(dataDir, { recursive: true, force: true });
    });
    const keychain = memoryKeychain();
    const open = (environment: NodeJS.ProcessEnv): ProviderKeyStore =>
      new ProviderKeyStore({ dataDir, database: state, keychain, environment });

    const production = open({});
    await production.initialize();
    const saved = await production.save('fal', ['harness', 'provider', 'credential'].join('-'));
    expect(() => production.simulateMasterKeyLoss()).toThrow(/only available under the test harness/);
    const release = open({ KILNRY_TEST_MSW: '1', KILNRY_RELEASE_BUILD: '1' });
    await release.initialize();
    expect(() => release.simulateMasterKeyLoss()).toThrow(/only available under the test harness/);

    const harness = open({ KILNRY_TEST_MSW: '1' });
    const before = await harness.initialize();
    harness.simulateMasterKeyLoss();
    const after = harness.status();
    expect(after.locked).toBe(true);
    expect(after.checksum_words).toBe(before.checksum_words);
    await expect(harness.get('fal')).rejects.toThrow(/locked/);
    await harness.restoreRecoveryKit(saved.recovery_kit!);
    expect(harness.status().locked).toBe(false);
    expect(await harness.get('fal')).toBe(['harness', 'provider', 'credential'].join('-'));
  });

  it('envelope-encrypts provider keys, round-trips recovery, and binds ciphertext to row id', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kilnry-keys-'));
    const state = createDatabase(dataDir, { memory: true });
    cleanup.push(async () => {
      await closeDatabaseState(state);
      rmSync(dataDir, { recursive: true, force: true });
    });
    const keychain = memoryKeychain();
    const store = new ProviderKeyStore({ dataDir, database: state, keychain });
    await store.initialize();
    const plaintext = ['integration', 'provider', 'credential'].join('-');
    const saved = await store.save('fal', plaintext);
    expect(saved.recovery_kit).toMatch(/^kilnry1/);
    expect(await store.get('fal')).toBe(plaintext);
    expect(allBytes(dataDir).includes(Buffer.from(plaintext))).toBe(false);

    keychain.value = undefined;
    const locked = new ProviderKeyStore({ dataDir, database: state, keychain });
    expect((await locked.initialize()).locked).toBe(true);
    await locked.restoreRecoveryKit(saved.recovery_kit!);
    expect(await locked.get('fal')).toBe(plaintext);

    await state.db
      .update(providerKeys)
      .set({ id: '01J00000000000000000000000' })
      .where(eq(providerKeys.providerId, 'fal'));
    await expect(locked.get('fal')).rejects.toThrow(/could not be opened/i);
  });

  it('binds the machine-derived fallback to the OS machine identifier', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kilnry-machine-keys-'));
    const state = createDatabase(dataDir, { memory: true });
    cleanup.push(async () => {
      await closeDatabaseState(state);
      rmSync(dataDir, { recursive: true, force: true });
    });
    const warnings: string[] = [];
    const first = new ProviderKeyStore({
      dataDir,
      database: state,
      keychain: unavailableKeychain(),
      machineId: 'machine-a',
      onWarning: (message) => warnings.push(message),
    });
    expect(await first.initialize()).toMatchObject({ source: 'machine', weaker_machine_key: true });
    await first.save('fal', 'fixture-machine-credential');
    const copiedToAnotherMachine = new ProviderKeyStore({
      dataDir,
      database: state,
      keychain: unavailableKeychain(),
      machineId: 'machine-b',
    });
    expect(await copiedToAnotherMachine.initialize()).toMatchObject({ locked: true });
    expect(warnings).toContain('OS keychain is unavailable; using the weaker machine-derived key.');
  });
});
