// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { AsyncEntry } from '@napi-rs/keyring';
import { and, desc, eq } from 'drizzle-orm';
import * as z from 'zod';
import type { DatabaseState } from '@kilnry/db';
import { providerKeys, providers } from '@kilnry/db';
import { KilnryError } from '../errors.js';
import { ulid } from '../ids.js';
import type { ProviderId } from '../types.js';
import { decodeRecoveryKit, encodeRecoveryKit, formatRecoveryKit } from './recovery-kit.js';
import { maskProviderKey } from './key-detection.js';

const EnvelopeSchema = z.object({
  version: z.literal(1),
  kek_source: z.enum(['keychain', 'env', 'file', 'machine']),
  wrapped_dek: z.string(),
  kek_salt: z.string().optional(),
  kek_fingerprint: z.string().length(8),
  created_at: z.string().datetime(),
  rotated_at: z.string().datetime(),
});
type Envelope = z.infer<typeof EnvelopeSchema>;

export interface KeychainBridge {
  get(): Promise<string | undefined>;
  set(value: string): Promise<void>;
}

export interface KeyStoreOptions {
  dataDir: string;
  database: DatabaseState;
  environment?: NodeJS.ProcessEnv;
  keychain?: KeychainBridge;
  machineId?: string;
  now?: () => Date;
  onWarning?: (message: string, error?: unknown) => void;
}

export interface KeyStoreStatus {
  initialized: boolean;
  locked: boolean;
  source?: 'keychain' | 'env' | 'file' | 'machine';
  weaker_machine_key: boolean;
  fingerprint?: string;
}

interface ResolvedKek {
  key: Buffer;
  source: 'keychain' | 'env' | 'file' | 'machine';
  salt?: Buffer;
}

function fingerprint(key: Uint8Array): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function parseMasterKey(value: string, source: string): Buffer {
  const key = value.trim();
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    throw new KilnryError('INVALID_INPUT', `${source} must contain exactly 64 hexadecimal characters.`);
  }
  return Buffer.from(key, 'hex');
}

function wrap(key: Uint8Array, value: Uint8Array, aad: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64');
}

function unwrap(key: Uint8Array, encoded: string, aad: string): Buffer {
  const value = Buffer.from(encoded, 'base64');
  if (value.length < 29) throw new KilnryError('INVALID_INPUT', 'The encrypted key envelope is incomplete.');
  const nonce = value.subarray(0, 12);
  const tag = value.subarray(-16);
  const ciphertext = value.subarray(12, -16);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new KilnryError('INVALID_INPUT', 'The recovery key does not match this encrypted key store.', {
      cause: error,
    });
  }
}

async function writeEnvelope(path: string, envelope: Envelope): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function defaultKeychain(): KeychainBridge {
  const entry = new AsyncEntry('kilnry', 'master-key');
  return {
    get: async () => entry.getPassword(),
    set: async (value) => entry.setPassword(value),
  };
}

export class ProviderKeyStore {
  readonly #options: KeyStoreOptions;
  readonly #path: string;
  #kek?: Buffer;
  #dek?: Buffer;
  #source?: ResolvedKek['source'];
  #salt?: Buffer;
  #initialized = false;
  #locked = false;

  constructor(options: KeyStoreOptions) {
    this.#options = options;
    this.#path = join(options.dataDir, 'keys.enc');
  }

  async #readEnvelope(): Promise<Envelope | undefined> {
    try {
      return EnvelopeSchema.parse(JSON.parse(await readFile(this.#path, 'utf8')) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        throw new KilnryError('INVALID_INPUT', 'The encrypted provider-key envelope is corrupt.', {
          cause: error,
        });
      }
      throw error;
    }
  }

  async #machineKey(salt: Buffer): Promise<Buffer> {
    const identity = this.#options.machineId ?? `${hostname()}\0${userInfo().username}`;
    return Buffer.from(hkdfSync('sha256', Buffer.from(identity), salt, Buffer.from('kilnry-kek-v1'), 32));
  }

  async #configuredKey(): Promise<ResolvedKek | undefined> {
    const environment = this.#options.environment ?? process.env;
    if (environment.KILNRY_MASTER_KEY) {
      return { key: parseMasterKey(environment.KILNRY_MASTER_KEY, 'KILNRY_MASTER_KEY'), source: 'env' };
    }
    if (environment.KILNRY_MASTER_KEY_FILE) {
      const value = await readFile(environment.KILNRY_MASTER_KEY_FILE, 'utf8');
      return { key: parseMasterKey(value, 'KILNRY_MASTER_KEY_FILE'), source: 'file' };
    }
    return undefined;
  }

  async #resolveForNewStore(): Promise<ResolvedKek> {
    const configured = await this.#configuredKey();
    if (configured) return configured;
    const keychain = this.#options.keychain ?? defaultKeychain();
    try {
      const existing = await keychain.get();
      if (existing) return { key: parseMasterKey(existing, 'OS keychain entry'), source: 'keychain' };
      const key = randomBytes(32);
      await keychain.set(key.toString('hex'));
      return { key, source: 'keychain' };
    } catch (error) {
      this.#options.onWarning?.('OS keychain is unavailable; using the weaker machine-derived key.', error);
      const salt = randomBytes(32);
      return { key: await this.#machineKey(salt), source: 'machine', salt };
    }
  }

  async #resolveForEnvelope(envelope: Envelope): Promise<ResolvedKek | undefined> {
    const configured = await this.#configuredKey();
    if (configured) return configured;
    if (envelope.kek_source === 'machine') {
      if (!envelope.kek_salt)
        throw new KilnryError('INVALID_INPUT', 'The machine-key salt is missing from keys.enc.');
      const salt = Buffer.from(envelope.kek_salt, 'base64');
      return { key: await this.#machineKey(salt), source: 'machine', salt };
    }
    if (envelope.kek_source === 'keychain') {
      try {
        const value = await (this.#options.keychain ?? defaultKeychain()).get();
        return value ? { key: parseMasterKey(value, 'OS keychain entry'), source: 'keychain' } : undefined;
      } catch (error) {
        this.#options.onWarning?.(
          'OS keychain could not be opened. Enter the recovery kit to unlock provider keys.',
          error,
        );
        return undefined;
      }
    }
    return undefined;
  }

  async initialize(): Promise<KeyStoreStatus> {
    if (this.#initialized) return this.status();
    await mkdir(this.#options.dataDir, { recursive: true, mode: 0o700 });
    await this.#options.database.ready;
    const envelope = await this.#readEnvelope();
    if (!envelope) {
      const resolved = await this.#resolveForNewStore();
      this.#kek = resolved.key;
      this.#source = resolved.source;
      if (resolved.salt) this.#salt = resolved.salt;
      this.#initialized = true;
      return this.status();
    }
    const resolved = await this.#resolveForEnvelope(envelope);
    if (!resolved || fingerprint(resolved.key) !== envelope.kek_fingerprint) {
      this.#locked = true;
      this.#initialized = true;
      return this.status();
    }
    this.#kek = resolved.key;
    this.#source = resolved.source;
    if (resolved.salt) this.#salt = resolved.salt;
    this.#dek = unwrap(resolved.key, envelope.wrapped_dek, 'kilnry-dek:v1');
    this.#initialized = true;
    return this.status();
  }

  status(): KeyStoreStatus {
    return {
      initialized: this.#initialized,
      locked: this.#locked,
      ...(this.#source ? { source: this.#source } : {}),
      weaker_machine_key: this.#source === 'machine',
      ...(this.#kek ? { fingerprint: fingerprint(this.#kek) } : {}),
    };
  }

  #requireKek(): Buffer {
    if (!this.#initialized) throw new Error('ProviderKeyStore.initialize() must run before use.');
    if (!this.#kek || this.#locked) {
      throw new KilnryError(
        'INVALID_INPUT',
        'Provider keys are locked. Enter the recovery kit in Settings › Security.',
      );
    }
    return this.#kek;
  }

  async #ensureDek(): Promise<Buffer> {
    if (this.#dek) return this.#dek;
    const kek = this.#requireKek();
    const dek = randomBytes(32);
    const now = (this.#options.now ?? (() => new Date()))().toISOString();
    const envelope: Envelope = {
      version: 1,
      kek_source: this.#source ?? 'machine',
      wrapped_dek: wrap(kek, dek, 'kilnry-dek:v1'),
      ...(this.#salt ? { kek_salt: this.#salt.toString('base64') } : {}),
      kek_fingerprint: fingerprint(kek),
      created_at: now,
      rotated_at: now,
    };
    await writeEnvelope(this.#path, envelope);
    this.#dek = dek;
    return dek;
  }

  async save(
    provider: ProviderId,
    key: string,
    label?: string,
  ): Promise<{ id: string; key_prefix: string; recovery_kit?: string }> {
    const value = key.trim();
    if (value.length < 8 || value.length > 512)
      throw new KilnryError('INVALID_INPUT', 'Provider key must be between 8 and 512 characters.');
    const firstEnvelope = !(await this.#readEnvelope());
    const dek = await this.#ensureDek();
    const id = ulid();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, nonce);
    cipher.setAAD(Buffer.from(`${id}:v1`));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    const keyPrefix = maskProviderKey(value);
    await this.#options.database.db.transaction(async (transaction) => {
      await transaction
        .insert(providers)
        .values({ id: provider, enabled: true, status: 'ok', updatedAt: new Date() })
        .onConflictDoUpdate({
          target: providers.id,
          set: { enabled: true, status: 'ok', lastError: null, updatedAt: new Date() },
        });
      await transaction.delete(providerKeys).where(eq(providerKeys.providerId, provider));
      await transaction
        .insert(providerKeys)
        .values({ id, providerId: provider, label, keyPrefix, keyCiphertext: ciphertext, nonce });
    });
    return {
      id,
      key_prefix: keyPrefix,
      ...(firstEnvelope ? { recovery_kit: formatRecoveryKit(encodeRecoveryKit(this.#requireKek())) } : {}),
    };
  }

  async get(provider: ProviderId): Promise<string | undefined> {
    const dek = await this.#ensureDek();
    const rows = await this.#options.database.db
      .select()
      .from(providerKeys)
      .where(eq(providerKeys.providerId, provider))
      .orderBy(desc(providerKeys.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) return undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', dek, Buffer.from(row.nonce));
      decipher.setAAD(Buffer.from(`${row.id}:v1`));
      const stored = Buffer.from(row.keyCiphertext);
      decipher.setAuthTag(stored.subarray(-16));
      const plaintext = Buffer.concat([decipher.update(stored.subarray(0, -16)), decipher.final()]).toString(
        'utf8',
      );
      await this.#options.database.db
        .update(providerKeys)
        .set({ lastUsedAt: new Date() })
        .where(and(eq(providerKeys.id, row.id), eq(providerKeys.providerId, provider)));
      return plaintext;
    } catch (error) {
      throw new KilnryError('INVALID_INPUT', `The encrypted ${provider} key could not be opened.`, {
        cause: error,
      });
    }
  }

  async remove(provider: ProviderId): Promise<void> {
    await this.#options.database.db.transaction(async (transaction) => {
      await transaction.delete(providerKeys).where(eq(providerKeys.providerId, provider));
      await transaction
        .update(providers)
        .set({ enabled: false, status: 'not_connected', updatedAt: new Date() })
        .where(eq(providers.id, provider));
    });
  }

  recoveryKit(): string {
    return formatRecoveryKit(encodeRecoveryKit(this.#requireKek()));
  }

  async restoreRecoveryKit(kit: string): Promise<void> {
    const envelope = await this.#readEnvelope();
    if (!envelope) throw new KilnryError('NOT_FOUND', 'There is no encrypted key store to recover.');
    const kek = Buffer.from(decodeRecoveryKit(kit));
    if (fingerprint(kek) !== envelope.kek_fingerprint) {
      throw new KilnryError('INVALID_INPUT', 'That recovery kit does not match this installation.');
    }
    const dek = unwrap(kek, envelope.wrapped_dek, 'kilnry-dek:v1');
    const configured = await this.#configuredKey();
    if (!configured) {
      try {
        await (this.#options.keychain ?? defaultKeychain()).set(kek.toString('hex'));
      } catch (error) {
        this.#options.onWarning?.(
          'Recovery succeeded, but the OS keychain could not store the restored key.',
          error,
        );
      }
    }
    this.#kek = kek;
    this.#dek = dek;
    this.#source = configured?.source ?? 'keychain';
    this.#locked = false;
    this.#initialized = true;
  }
}
