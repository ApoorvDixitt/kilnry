-- Kilnry — https://github.com/ApoorvDixitt/kilnry
-- Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
-- SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
-- See LICENSE.md in the repository root. You may not remove or obscure this notice.
-- A foreach iteration's steps share a step_id, so keying run_steps by step_id
-- collided their rows and lost a per-iteration step's outputs on resume
-- (F-WFL-04). Key the row by its unique instance id instead.
ALTER TABLE "run_steps" ADD COLUMN "instance_id" text NOT NULL DEFAULT '';
UPDATE "run_steps" SET "instance_id" = "step_id" WHERE "instance_id" = '';
ALTER TABLE "run_steps" DROP CONSTRAINT "run_steps_run_id_step_id_pk";
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_instance_id_pk" PRIMARY KEY ("run_id", "instance_id");
