-- Kilnry — https://github.com/ApoorvDixitt/kilnry
-- Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
-- SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
-- See LICENSE.md in the repository root. You may not remove or obscure this notice.
-- The foreign keys TRD-04 §3 names (F-82) and its partial client-request index
-- (F-84). Until now only the auth tables and provider_keys carried a foreign
-- key, so a direct delete of a folder, asset, run or chat session left its
-- children behind. Every key here is the TRD's, with its ON DELETE clause.
--
-- One key the TRD names is not added: character_references.asset_id →
-- assets(id) ON DELETE CASCADE. A Library reindex deletes every assets row and
-- re-creates each from its sidecar under the same id (library/reindex.ts); with
-- that cascade a reindex would delete every Character's references, which the
-- sidecars do not carry. It is recorded as OWNER DECISION NEEDED (task 57).
--
-- A database written before this migration may hold rows a key would refuse.
-- They are repaired first, without losing anything the user made: a missing
-- parent that is only a container (a folder, a chat session, a provider) is
-- re-created; a child whose parent is gone and that the TRD would have deleted
-- with it is deleted; an optional reference to a missing row is cleared.

-- Parents re-created.
INSERT INTO "folders" ("path", "name", "parent_path", "updated_at")
SELECT DISTINCT a."folder_path",
       CASE WHEN a."folder_path" = '' THEN 'Library' ELSE regexp_replace(a."folder_path", '^.*/', '') END,
       CASE WHEN position('/' IN a."folder_path") > 0 THEN regexp_replace(a."folder_path", '/[^/]*$', '') ELSE NULL END,
       now()
FROM "assets" a
WHERE a."folder_path" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "folders" f WHERE f."path" = a."folder_path");

INSERT INTO "chat_sessions" ("id")
SELECT DISTINCT m."session_id" FROM "chat_messages" m
WHERE NOT EXISTS (SELECT 1 FROM "chat_sessions" s WHERE s."id" = m."session_id");

INSERT INTO "providers" ("id")
SELECT DISTINCT m."provider_id" FROM "models" m
WHERE m."provider_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "providers" p WHERE p."id" = m."provider_id");

-- Children the TRD cascades away with their parent.
DELETE FROM "asset_tags" t WHERE NOT EXISTS (SELECT 1 FROM "assets" a WHERE a."id" = t."asset_id");
DELETE FROM "asset_lineage" l
WHERE NOT EXISTS (SELECT 1 FROM "assets" a WHERE a."id" = l."child_id")
   OR NOT EXISTS (SELECT 1 FROM "assets" a WHERE a."id" = l."parent_id");
DELETE FROM "asset_characters" c WHERE NOT EXISTS (SELECT 1 FROM "assets" a WHERE a."id" = c."asset_id");
DELETE FROM "run_steps" s WHERE NOT EXISTS (SELECT 1 FROM "runs" r WHERE r."id" = s."run_id");
DELETE FROM "character_versions" v WHERE NOT EXISTS (SELECT 1 FROM "characters" c WHERE c."id" = v."character_id");
DELETE FROM "character_references" r
WHERE NOT EXISTS (
  SELECT 1 FROM "character_versions" v WHERE v."character_id" = r."character_id" AND v."version" = r."version"
);
DELETE FROM "trained_identities" t
WHERE NOT EXISTS (
  SELECT 1 FROM "character_versions" v WHERE v."character_id" = t."character_id" AND v."version" = t."version"
);
DELETE FROM "character_voices" cv WHERE NOT EXISTS (SELECT 1 FROM "characters" c WHERE c."id" = cv."character_id");
-- A binding to a voice that no longer exists binds nothing (deleteVoice removes
-- bindings first, so only a direct delete leaves one).
DELETE FROM "character_voices" cv WHERE NOT EXISTS (SELECT 1 FROM "voices" v WHERE v."id" = cv."voice_ulid");
DELETE FROM "price_snapshots" p WHERE NOT EXISTS (SELECT 1 FROM "models" m WHERE m."id" = p."model_ulid");

-- Optional references cleared; the row and its money stay.
UPDATE "run_steps" s SET "job_id" = NULL
WHERE s."job_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = s."job_id");
UPDATE "spend_ledger" l SET "job_id" = NULL
WHERE l."job_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = l."job_id");
DELETE FROM "publish_posts" p WHERE NOT EXISTS (SELECT 1 FROM "publish_accounts" a WHERE a."id" = p."account_id");

-- The keys (TRD-04 §3).
ALTER TABLE "models" ADD CONSTRAINT "models_provider_id_providers_id_fk"
  FOREIGN KEY ("provider_id") REFERENCES "providers"("id");
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_model_ulid_models_id_fk"
  FOREIGN KEY ("model_ulid") REFERENCES "models"("id");
ALTER TABLE "assets" ADD CONSTRAINT "assets_folder_path_folders_path_fk"
  FOREIGN KEY ("folder_path") REFERENCES "folders"("path") ON DELETE CASCADE;
ALTER TABLE "asset_tags" ADD CONSTRAINT "asset_tags_asset_id_assets_id_fk"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;
ALTER TABLE "asset_lineage" ADD CONSTRAINT "asset_lineage_child_id_assets_id_fk"
  FOREIGN KEY ("child_id") REFERENCES "assets"("id") ON DELETE CASCADE;
ALTER TABLE "asset_lineage" ADD CONSTRAINT "asset_lineage_parent_id_assets_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "assets"("id") ON DELETE CASCADE;
ALTER TABLE "asset_characters" ADD CONSTRAINT "asset_characters_asset_id_assets_id_fk"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE;
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_job_id_jobs_id_fk"
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id");
ALTER TABLE "character_versions" ADD CONSTRAINT "character_versions_character_id_characters_id_fk"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE;
ALTER TABLE "character_references" ADD CONSTRAINT "character_references_version_fk"
  FOREIGN KEY ("character_id", "version") REFERENCES "character_versions"("character_id", "version") ON DELETE CASCADE;
ALTER TABLE "trained_identities" ADD CONSTRAINT "trained_identities_version_fk"
  FOREIGN KEY ("character_id", "version") REFERENCES "character_versions"("character_id", "version") ON DELETE CASCADE;
ALTER TABLE "character_voices" ADD CONSTRAINT "character_voices_character_id_characters_id_fk"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE;
ALTER TABLE "character_voices" ADD CONSTRAINT "character_voices_voice_ulid_voices_id_fk"
  FOREIGN KEY ("voice_ulid") REFERENCES "voices"("id");
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_job_id_jobs_id_fk"
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id");
ALTER TABLE "publish_posts" ADD CONSTRAINT "publish_posts_account_id_publish_accounts_id_fk"
  FOREIGN KEY ("account_id") REFERENCES "publish_accounts"("id");

-- F-84: TRD-04 §3 "create unique index jobs_client_request_idx on
-- jobs(client_request_id) where client_request_id is not null;". The shipped
-- index had no predicate; NULLs were already distinct, so dedup behaves the same.
DROP INDEX IF EXISTS "jobs_client_request_idx";
CREATE UNIQUE INDEX "jobs_client_request_idx" ON "jobs" USING btree ("client_request_id")
  WHERE "client_request_id" IS NOT NULL;
