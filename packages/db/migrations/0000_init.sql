-- Kilnry — https://github.com/ApoorvDixitt/kilnry
-- Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
-- SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
-- See LICENSE.md in the repository root. You may not remove or obscure this notice.

CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"scope" text PRIMARY KEY NOT NULL,
	"cap_usd" numeric(12, 6),
	"behavior" text DEFAULT 'block' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text,
	"provider_id" text,
	"model_id" text,
	"folder" text,
	"character_ids" text[],
	"kind" text,
	"estimate_usd" numeric(12, 6),
	"actual_usd" numeric(12, 6) NOT NULL,
	"currency_note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"source" text,
	"path" text,
	"json" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"indicative_cost_usd" numeric(12, 6),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"name" text PRIMARY KEY NOT NULL,
	"description" text,
	"license" text,
	"source" text,
	"path" text,
	"frontmatter" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text,
	"source" text,
	"path" text,
	"yaml" text NOT NULL,
	"inputs_schema" jsonb,
	"cost_range" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_handle_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"character_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_references" (
	"id" text PRIMARY KEY NOT NULL,
	"character_id" text NOT NULL,
	"version" integer NOT NULL,
	"asset_id" text NOT NULL,
	"role" text NOT NULL,
	"view" text,
	"label" text,
	"weight" numeric(3, 2) DEFAULT '1' NOT NULL,
	"position" integer,
	"face_embedding" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_versions" (
	"character_id" text NOT NULL,
	"version" integer NOT NULL,
	"parent_version" integer,
	"appearance" jsonb,
	"injection_defaults" jsonb,
	"cast_params" jsonb,
	"frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_versions_character_id_version_pk" PRIMARY KEY("character_id","version")
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"tags" text[],
	"is_real_person" boolean DEFAULT false NOT NULL,
	"consent_status" text DEFAULT 'n/a' NOT NULL,
	"consent_evidence_asset_id" text,
	"consent_granted_at" timestamp with time zone,
	"license" text DEFAULT 'private' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "characters_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "trained_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"character_id" text NOT NULL,
	"version" integer NOT NULL,
	"provider_id" text NOT NULL,
	"kind" text NOT NULL,
	"remote_id" text,
	"artifact_url" text,
	"local_path" text,
	"sha256" text,
	"base_model" text,
	"trigger_word" text,
	"default_scale" numeric(3, 2),
	"status" text NOT NULL,
	"job_id" text,
	"cost_usd" numeric(12, 6),
	"trained_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"source_asset_ids" text[],
	"error" text
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"usage" jsonb,
	"cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"folder" text,
	"llm_provider" text,
	"llm_model" text,
	"autonomy" text DEFAULT 'ask_first' NOT NULL,
	"budget_usd" numeric(12, 6),
	"spent_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"auto_approve_below_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source" text NOT NULL,
	"provider_id" text,
	"model_id" text,
	"request" jsonb NOT NULL,
	"resolved" jsonb,
	"characters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"medias" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"adjustments" text[],
	"estimate_usd" numeric(12, 6),
	"authoritative_usd" numeric(12, 6),
	"actual_usd" numeric(12, 6),
	"unit_price" jsonb,
	"provider_request_id" text,
	"provider_status_url" text,
	"progress" numeric(4, 3),
	"step_label" text,
	"error_code" text,
	"error_message" text,
	"retryable" boolean,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_id" text,
	"step_id" text,
	"preset_id" text,
	"chat_session_id" text,
	"client_request_id" text,
	"target_folder" text,
	"output_asset_ids" text[],
	"confirmed_cost_usd" numeric(12, 6),
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "asset_characters" (
	"asset_id" text NOT NULL,
	"character_id" text NOT NULL,
	"version" integer NOT NULL,
	"strategy" text NOT NULL,
	CONSTRAINT "asset_characters_asset_id_character_id_pk" PRIMARY KEY("asset_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "asset_lineage" (
	"child_id" text NOT NULL,
	"parent_id" text NOT NULL,
	"role" text,
	CONSTRAINT "asset_lineage_child_id_parent_id_pk" PRIMARY KEY("child_id","parent_id")
);
--> statement-breakpoint
CREATE TABLE "asset_tags" (
	"asset_id" text NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "asset_tags_asset_id_tag_pk" PRIMARY KEY("asset_id","tag")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"folder_path" text,
	"kind" text NOT NULL,
	"mime" text,
	"bytes" bigint,
	"sha256" text,
	"width" integer,
	"height" integer,
	"duration_s" numeric(10, 3),
	"fps" numeric(6, 2),
	"has_audio" boolean,
	"source" text,
	"provider_id" text,
	"model_id" text,
	"prompt" text,
	"resolved_prompt" text,
	"negative_prompt" text,
	"params" jsonb,
	"seed" bigint,
	"estimate_usd" numeric(12, 6),
	"actual_usd" numeric(12, 6),
	"job_id" text,
	"run_id" text,
	"step_id" text,
	"provider_request_id" text,
	"moderation" jsonb,
	"retention_until" timestamp with time zone,
	"label" text,
	"rating" smallint DEFAULT 0 NOT NULL,
	"user_notes" text,
	"consistency" jsonb,
	"sidecar_ok" boolean DEFAULT true NOT NULL,
	"sidecar_mtime" timestamp with time zone,
	"file_mtime" timestamp with time zone,
	"trashed_at" timestamp with time zone,
	"original_path" text,
	"created_at" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"path" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_path" text,
	"asset_count" integer DEFAULT 0 NOT NULL,
	"project_notes" text,
	"default_character" text,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "smart_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text DEFAULT 'full' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"capabilities" text[] NOT NULL,
	"params_schema" jsonb NOT NULL,
	"media_roles" jsonb NOT NULL,
	"supports" jsonb NOT NULL,
	"price_rule" jsonb NOT NULL,
	"retention_days" integer,
	"moderation" jsonb,
	"quality_tier" text,
	"tags" text[],
	"deprecated_at" timestamp with time zone,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"model_ulid" text NOT NULL,
	"unit" text NOT NULL,
	"amount_usd" numeric(12, 6) NOT NULL,
	"tiers" jsonb,
	"source" text,
	"source_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"label" text,
	"key_prefix" text,
	"key_ciphertext" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'not_connected' NOT NULL,
	"degraded_until" timestamp with time zone,
	"last_error" text,
	"last_tested_at" timestamp with time zone,
	"base_url" text,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"monthly_cap_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"display_name" text,
	"external_id" text,
	"token_ciphertext" "bytea",
	"nonce" "bytea",
	"status" text,
	"connected_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "publish_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"asset_id" text,
	"mode" text,
	"publish_id" text,
	"status" text,
	"title" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"position" integer,
	"name" text,
	"kind" text,
	"status" text,
	"job_id" text,
	"model_id" text,
	"estimate_usd" numeric(12, 6),
	"actual_usd" numeric(12, 6),
	"inputs" jsonb,
	"outputs" jsonb,
	"logs" text,
	"approval_required" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp with time zone,
	"decided_by" text,
	CONSTRAINT "run_steps_run_id_step_id_pk" PRIMARY KEY("run_id","step_id")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_version" text,
	"status" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"folder" text,
	"estimate_usd" numeric(12, 6),
	"spent_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"source" text,
	"chat_session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_voices" (
	"character_id" text NOT NULL,
	"version" integer NOT NULL,
	"voice_ulid" text NOT NULL,
	CONSTRAINT "character_voices_character_id_version_pk" PRIMARY KEY("character_id","version")
);
--> statement-breakpoint
CREATE TABLE "voices" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"voice_id" text NOT NULL,
	"name" text,
	"language" text,
	"gender" text,
	"tags" text[],
	"is_clone" boolean DEFAULT false NOT NULL,
	"clone_kind" text,
	"sample_asset_id" text,
	"preview_asset_id" text,
	"consent_confirmed_at" timestamp with time zone,
	"cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_keys" ADD CONSTRAINT "provider_keys_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "spend_day_idx" ON "spend_ledger" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "character_alias_idx" ON "character_handle_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_client_request_idx" ON "jobs" USING btree ("client_request_id");--> statement-breakpoint
CREATE INDEX "assets_folder_idx" ON "assets" USING btree ("folder_path","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "models_provider_model_idx" ON "models" USING btree ("provider_id","model_id");--> statement-breakpoint
CREATE INDEX "price_snapshots_model_idx" ON "price_snapshots" USING btree ("model_ulid","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "voices_provider_voice_idx" ON "voices" USING btree ("provider_id","voice_id");
