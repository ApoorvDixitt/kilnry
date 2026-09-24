-- Kilnry — https://github.com/ApoorvDixitt/kilnry
-- Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
-- SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
-- See LICENSE.md in the repository root. You may not remove or obscure this notice.
ALTER TABLE "run_steps" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "adjustments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "error" text;