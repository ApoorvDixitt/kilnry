-- Kilnry — https://github.com/ApoorvDixitt/kilnry
-- Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
-- SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
-- See LICENSE.md in the repository root. You may not remove or obscure this notice.
-- The run's drive flags, persisted so a resume after restart honours them: a
-- Run-automatically run and the intake's "Skip approvals" tick proceed through a
-- soft gate instead of pausing (TRD-12 §4 line 116). The drive job carries only
-- the run id, so these cannot ride on the request that started the run.
ALTER TABLE "runs" ADD COLUMN "automatic" boolean NOT NULL DEFAULT false;
ALTER TABLE "runs" ADD COLUMN "skip_approvals" boolean NOT NULL DEFAULT false;
