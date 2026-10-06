-- Kilnry — https://github.com/ApoorvDixitt/kilnry
-- Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
-- SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
-- See LICENSE.md in the repository root. You may not remove or obscure this notice.
-- Whether a Character version reads as a minor (PRD-07 §7, F-07): an `age:`
-- tag under eighteen or descriptor words that name a minor. Training and voice
-- cloning are refused for it regardless of consent; the flag is stored on the
-- version so the card can show it. Rows written before this migration read
-- false here and are recomputed from their tags and descriptor on load.
ALTER TABLE "character_versions" ADD COLUMN "minor_suspected" boolean NOT NULL DEFAULT false;
