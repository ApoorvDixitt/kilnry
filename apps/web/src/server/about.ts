// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Server-side pieces for the About page's Export diagnostics (F-SET-11). It
// assembles a doctor-style health snapshot and reads the registry snapshot ages
// from the database (ages only — never prices or keys), then hands them to
// core's buildDiagnosticsFiles, which scrubs everything. The checks mirror
// `kilnry doctor` but run inline so the web server need not depend on the CLI
// package (which would churn the lockfile and the server bundle).

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { priceSnapshots } from '@kilnry/db';
import type { DiagnosticsInput, KilnryConfig } from '@kilnry/core';
import { runtimeServices } from './runtime';

interface DoctorCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  summary: string;
}

function doctorChecks(config: KilnryConfig): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split('.')[0] ?? 0);
  checks.push({
    id: 'node.version',
    status: major >= 24 ? 'pass' : major >= 22 ? 'warn' : 'fail',
    summary: nodeVersion,
  });

  checks.push({
    id: 'datadir',
    status: existsSync(config.data_dir) ? 'pass' : 'warn',
    summary: existsSync(config.data_dir)
      ? `${config.data_dir} (mode ${(statSync(config.data_dir).mode & 0o777).toString(8)})`
      : `${config.data_dir} not created yet`,
  });

  checks.push({
    id: 'library.root',
    status: config.library_root && existsSync(config.library_root) ? 'pass' : 'warn',
    summary: config.library_root ?? 'not configured',
  });

  const ffmpeg = spawnSync(process.env.KILNRY_FFMPEG ?? 'ffmpeg', ['-version'], {
    encoding: 'utf8',
    timeout: 4000,
  });
  checks.push({
    id: 'ffmpeg.binary',
    status: ffmpeg.status === 0 ? 'pass' : 'warn',
    summary: (ffmpeg.stdout ?? '').split('\n')[0] || 'ffmpeg not found',
  });

  return checks;
}

export async function gatherDiagnostics(config: KilnryConfig): Promise<DiagnosticsInput> {
  const doctor = { checks: doctorChecks(config) };

  let snapshotAges: Array<{ model: string; fetched_at: string }>;
  try {
    const services = await runtimeServices();
    const rows = await services.database.db
      .select({ model: priceSnapshots.modelUlid, fetchedAt: priceSnapshots.fetchedAt })
      .from(priceSnapshots);
    snapshotAges = rows.map((row) => ({
      model: row.model,
      fetched_at: row.fetchedAt instanceof Date ? row.fetchedAt.toISOString() : String(row.fetchedAt),
    }));
  } catch {
    snapshotAges = [];
  }

  return { dataDir: config.data_dir, doctor, config, snapshotAges };
}
