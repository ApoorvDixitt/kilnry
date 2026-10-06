-- Kilnry — https://github.com/ApoorvDixitt/kilnry
-- Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
-- SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
-- See LICENSE.md in the repository root. You may not remove or obscure this notice.
-- The Chat defaults PRD-14 and PRD-11 name (F-104): a $5.00 session budget for
-- Run automatically and the $0.50 auto-approve threshold for Ask me first.
-- Seeded once; a value the user already saved is left as it is.
INSERT INTO "settings" ("key", "value")
VALUES ('chat.session_budget_usd', '5'::jsonb), ('chat.auto_approve_below_usd', '0.5'::jsonb)
ON CONFLICT ("key") DO NOTHING;
