-- Kilnry — https://github.com/ApoorvDixitt/kilnry
-- Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
-- SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
-- See LICENSE.md in the repository root. You may not remove or obscure this notice.
-- TRD-14 §2 gates a bound voice on the engine that made it, not on the key that
-- paid for it. A MiniMax clone hosted on fal is stored provider_id 'fal', so the
-- old gate ("same provider") let it through to fal's Kokoro, whose voice enum
-- cannot contain it: the request was built with a voice id Kokoro rejects
-- (F-VOI-04, F-02). The engine is recorded per voice; existing rows are
-- backfilled from what their provider and clone kind already say.
ALTER TABLE "voices" ADD COLUMN "voice_model" text;

-- Existing rows are backfilled from the provider they were stored under, which
-- is the only fact they carry: a row written before this column cannot say
-- whether a 'fal' voice came from MiniMax or from Kling, and guessing would
-- change the routing of voices the user already uses. New clones record their
-- engine, so the gate tightens for voices made from here on.
UPDATE "voices" SET "voice_model" = "provider_id" WHERE "voice_model" IS NULL;
