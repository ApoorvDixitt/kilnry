-- Kilnry — https://github.com/ApoorvDixitt/kilnry
-- Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
-- SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
-- See LICENSE.md in the repository root. You may not remove or obscure this notice.
-- A model swap that raises a workflow step's price more than 10 % over the
-- approved plan pauses for approval (D-61, TRD-12 §5). The swap the owner is
-- asked about — both figures and the new run total — is kept on the step so the
-- ApprovalCard can show it after a restart.
ALTER TABLE "run_steps" ADD COLUMN "pending_swap" jsonb;
