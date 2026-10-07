// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// F-82 / F-84: migration 0010 adds the foreign keys TRD-04 §3 names and the
// partial client-request index. A database written before it may hold rows a
// key would refuse, so this builds one with migrations 0000–0009, seeds an
// orphan of every kind, applies 0010, and checks nothing the user made is lost
// and every key now holds.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const files = readdirSync(migrations)
  .filter((file) => file.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right));

async function upTo(client: PGlite, lastExclusive: string): Promise<void> {
  for (const file of files) {
    if (file.localeCompare(lastExclusive) >= 0) break;
    await client.exec(readFileSync(join(migrations, file), 'utf8'));
  }
}

const count = async (client: PGlite, sql: string): Promise<number> =>
  Number((await client.query<{ n: number }>(sql)).rows[0]?.n ?? 0);

describe('migration 0010 on a database seeded before it (F-82, F-84)', () => {
  it('repairs every kind of orphan, keeps what the user made, then enforces the keys', async () => {
    const client = new PGlite();
    await upTo(client, '0010');
    await client.exec(`
      insert into providers (id) values ('fal');
      insert into models (id, provider_id, model_id, display_name, capabilities, params_schema, media_roles, supports, price_rule)
        values ('m1', 'fal', 'flux', 'Flux', '{text2image}', '{}', '[]', '{}', '{}'),
               ('m2', 'gone-provider', 'x', 'X', '{text2image}', '{}', '[]', '{}', '{}');
      insert into price_snapshots (id, model_ulid, unit, amount_usd) values ('p1', 'm1', 'image', 0.01), ('p2', 'no-model', 'image', 0.01);
      insert into folders (path, name) values ('Client_A', 'Client_A');
      insert into assets (id, path, kind, created_at, folder_path) values
        ('a1', 'Client_A/one.png', 'image', now(), 'Client_A'),
        ('a2', 'Client_B/sub/two.png', 'image', now(), 'Client_B/sub');
      insert into asset_tags (asset_id, tag) values ('a1', 'keep'), ('gone-asset', 'orphan');
      insert into asset_lineage (child_id, parent_id) values ('a2', 'a1'), ('a2', 'gone-asset');
      insert into asset_characters (asset_id, character_id, version, strategy) values ('a1', 'c1', 1, 'text'), ('gone-asset', 'c1', 1, 'text');
      insert into jobs (id, kind, source, request) values ('j1', 'image', 'ui', '{}');
      insert into runs (id, workflow_id, status, inputs, plan) values ('r1', 'w', 'completed', '{}', '{}');
      insert into run_steps (run_id, step_id, instance_id, job_id) values
        ('r1', 's1', 's1', 'j1'), ('r1', 's2', 's2', 'gone-job'), ('gone-run', 's1', 's1', null);
      insert into spend_ledger (id, actual_usd, job_id) values ('l1', 0.05, 'j1'), ('l2', 0.07, 'gone-job');
      insert into characters (id, handle, kind, display_name) values ('c1', 'maya', 'character', 'Maya');
      insert into character_versions (character_id, version) values ('c1', 1), ('gone-character', 1);
      insert into character_references (id, character_id, version, asset_id, role) values
        ('cr1', 'c1', 1, 'a1', 'anchor'), ('cr2', 'c1', 9, 'a1', 'anchor'), ('cr3', 'c1', 1, 'gone-asset', 'anchor');
      insert into trained_identities (id, character_id, version, provider_id, kind, status) values
        ('t1', 'c1', 1, 'fal', 'lora', 'ready'), ('t2', 'c1', 9, 'fal', 'lora', 'ready');
      insert into voices (id, provider_id, voice_id) values ('v1', 'fal', 'riya');
      insert into character_voices (character_id, version, voice_ulid) values ('c1', 1, 'v1'), ('c1', 2, 'gone-voice'), ('gone-character', 1, 'v1');
      insert into chat_messages (id, session_id, role, parts) values ('cm1', 'session-without-row', 'user', '[]');
      insert into publish_accounts (id, platform) values ('pa1', 'youtube');
      insert into publish_posts (id, account_id) values ('pp1', 'pa1'), ('pp2', 'gone-account');
    `);

    await client.exec(readFileSync(join(migrations, '0010_foreign_keys.sql'), 'utf8'));

    // Containers re-created; everything the user made is still there.
    expect(await count(client, `select count(*)::int as n from assets`)).toBe(2);
    expect((await client.query(`select path, name, parent_path from folders order by path`)).rows).toEqual([
      { path: 'Client_A', name: 'Client_A', parent_path: null },
      { path: 'Client_B/sub', name: 'sub', parent_path: 'Client_B' },
    ]);
    expect(await count(client, `select count(*)::int as n from chat_messages`)).toBe(1);
    expect(
      await count(client, `select count(*)::int as n from chat_sessions where id = 'session-without-row'`),
    ).toBe(1);
    expect(await count(client, `select count(*)::int as n from providers where id = 'gone-provider'`)).toBe(
      1,
    );
    expect(
      await count(
        client,
        `select count(*)::int as n from character_references where asset_id = 'gone-asset'`,
      ),
    ).toBe(1);
    // Money stays; only the link to a job that does not exist is cleared.
    expect((await client.query(`select id, job_id from spend_ledger order by id`)).rows).toEqual([
      { id: 'l1', job_id: 'j1' },
      { id: 'l2', job_id: null },
    ]);
    expect((await client.query(`select step_id, job_id from run_steps order by step_id`)).rows).toEqual([
      { step_id: 's1', job_id: 'j1' },
      { step_id: 's2', job_id: null },
    ]);
    // Children whose parent is gone, which the TRD cascades away, are gone.
    expect(await count(client, `select count(*)::int as n from asset_tags`)).toBe(1);
    expect(await count(client, `select count(*)::int as n from asset_lineage`)).toBe(1);
    expect(await count(client, `select count(*)::int as n from asset_characters`)).toBe(1);
    expect(await count(client, `select count(*)::int as n from price_snapshots`)).toBe(1);
    expect(await count(client, `select count(*)::int as n from character_versions`)).toBe(1);
    expect(await count(client, `select count(*)::int as n from trained_identities`)).toBe(1);
    expect((await client.query(`select id from character_references order by id`)).rows).toEqual([
      { id: 'cr1' },
      { id: 'cr3' },
    ]);
    expect((await client.query(`select version from character_voices`)).rows).toEqual([{ version: 1 }]);
    expect((await client.query(`select id from publish_posts`)).rows).toEqual([{ id: 'pp1' }]);

    // The keys hold now.
    await expect(client.exec(`insert into asset_tags (asset_id, tag) values ('nope', 'x')`)).rejects.toThrow(
      /asset_tags_asset_id_assets_id_fk/,
    );
    await expect(
      client.exec(
        `insert into chat_messages (id, session_id, role, parts) values ('x', 'nope', 'user', '[]')`,
      ),
    ).rejects.toThrow(/chat_messages_session_id_chat_sessions_id_fk/);
    await client.exec(`delete from assets where id = 'a1'`);
    expect(await count(client, `select count(*)::int as n from asset_tags`)).toBe(0);
    expect(await count(client, `select count(*)::int as n from asset_lineage`)).toBe(0);
    await client.exec(`delete from folders where path = 'Client_B/sub'`);
    expect(await count(client, `select count(*)::int as n from assets`)).toBe(0);
    await client.exec(`delete from runs where id = 'r1'`);
    expect(await count(client, `select count(*)::int as n from run_steps`)).toBe(0);

    // F-84: the client-request index is partial, as TRD-04 §3 writes it.
    const index = await client.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'jobs_client_request_idx'`,
    );
    expect(index.rows[0]?.indexdef).toMatch(/WHERE \(client_request_id IS NOT NULL\)/);
    await client.close();
  }, 60_000);
});
