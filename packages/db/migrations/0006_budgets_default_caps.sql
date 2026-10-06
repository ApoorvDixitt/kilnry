-- Kilnry — https://github.com/ApoorvDixitt/kilnry
-- Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
-- SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
-- See LICENSE.md in the repository root. You may not remove or obscure this notice.
-- The default spending caps PRD-14 promises (F-08): $10.00 a day and $100.00 a
-- month, both blocking. Seeded once; a cap the user already saved — including a
-- deliberately blank one, stored as a null cap — is left exactly as it is.
INSERT INTO "budgets" ("scope", "cap_usd", "behavior")
VALUES ('daily', 10.000000, 'block'), ('monthly', 100.000000, 'block')
ON CONFLICT ("scope") DO NOTHING;
