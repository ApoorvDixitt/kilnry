// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// An assemble step (a local ffmpeg concat, mux or burn) and an export step both
// produce a file but spend nothing, so the real host effects must still record
// the asset id and path they yield — otherwise a workflow whose outputs.final is
// an assemble or an export resolves to nothing on disk (F-WFL-09). These cases
// drive the real runEffects against an in-memory database and read the built
// manifest, not a mock: an assemble-final workflow's final is the new assembled
// asset, an export-final workflow's final is the exported asset.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabaseState, createDatabase, assets, type DatabaseState } from '@kilnry/db';
import { eq } from 'drizzle-orm';
import type { JobEngine } from '@kilnry/core/jobs';
import { buildManifest, execute, parseWorkflow, plan, type PlanContext, type Step } from '@kilnry/workflows';
import { runEffects, type RunContext } from './workflows';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let database: DatabaseState;
let root: string;

// assemble and export never reach the engine; a bare stub proves it stays untouched.
const engine = {} as unknown as JobEngine;

const planCtx: PlanContext = {
  resolveInputs: () => ({}),
  priceStep: (step: Step) => ({
    model: 'fal/x',
    provider: 'fal',
    estimate_usd: step.kind === 'generate' ? 0.25 : 0,
    eta_s: 5,
    why: 'stub',
  }),
};

const ASSEMBLE_FINAL = `
id: kilnry-assemble-final
name: Assemble final
version: 1.0.0
category: video
steps:
  - id: shots
    kind: foreach
    over: "{{ [0, 1] }}"
    steps:
      - id: shot
        kind: generate
        capability: text2video
        prompt: "shot {{ index }}"
        outputs: { asset: "{{ result.assets[0] }}" }
  - id: cut
    kind: assemble
    op: concat
    inputs: ["{{ steps.shots.assets }}"]
    output_name: cut.mp4
    outputs: { asset: "{{ result.asset_id }}" }
outputs:
  final: "{{ steps.cut.outputs.asset }}"
`;

const EXPORT_FINAL = `
id: kilnry-export-final
name: Export final
version: 1.0.0
category: image
steps:
  - id: board
    kind: generate
    capability: text2image
    prompt: "board"
    outputs: { asset: "{{ result.assets[0] }}" }
  - id: export
    kind: export
    files:
      - { ref: "{{ steps.board.outputs.asset }}", name: board.png, tags: [deliverable] }
    outputs: { asset: "{{ result.asset_id }}" }
outputs:
  final: "{{ steps.export.outputs.asset }}"
`;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kilnry-assemble-'));
  database = createDatabase(join(root, 'data'), { memory: true });
  await database.ready;
  // One real source asset the generate steps' fake results point at, so export
  // has a row to copy and tag.
  await database.db.insert(assets).values({
    id: 'asset-source',
    path: 'inbox/source.png',
    kind: 'image',
    createdAt: new Date(),
  });
}, 60_000);

afterAll(async () => {
  await closeDatabaseState(database);
  rmSync(root, { recursive: true, force: true });
});

// A generate step is faked to complete with the seeded source asset; assemble
// and export run through the real handlers under test.

function runContext(id: string, priced: ReturnType<typeof plan>): RunContext {
  return {
    runId: `run-${id}`,
    plan: priced,
    workflow: parseWorkflow(id === 'assemble' ? ASSEMBLE_FINAL : EXPORT_FINAL),
    folder: `inbox/${id}`,
    startedAt: new Date().toISOString(),
    libraryRoot: '',
  };
}

async function drive(id: string, yaml: string) {
  const workflow = parseWorkflow(yaml);
  const priced = plan(workflow, {}, planCtx);
  const run = runContext(id, priced);
  const effects = runEffects(database, engine, run);
  // The generate step has no engine here, so intercept it: complete it with the
  // seeded source asset. assemble/export fall through to the real handlers.
  const real = effects.runStep;
  effects.runStep = async (node, rendered, scope) => {
    if (node.kind === 'generate') {
      return {
        outputs: { result: { assets: ['asset-source'], asset_id: 'asset-source' }, asset: 'asset-source' },
        actual_usd: 0,
        status: 'completed',
      };
    }
    return real(node, rendered, scope);
  };
  const state = await execute(workflow, { inputs: {}, defaults: {}, vars: {} }, effects, {
    automatic: true,
    skipApprovals: true,
  });
  const manifest = buildManifest({
    runId: run.runId,
    workflow,
    plan: priced,
    state,
    folder: run.folder,
    startedAt: run.startedAt,
    finishedAt: new Date().toISOString(),
  });
  return { state, manifest };
}

describe('assemble and export record the asset they produce (F-WFL-09)', () => {
  it('an assemble-final workflow resolves outputs.final to the new assembled asset with a path', async () => {
    const { state, manifest } = await drive('assemble', ASSEMBLE_FINAL);
    expect(state.status).toBe('completed');
    const cut = state.steps.find((step) => step.step_id === 'cut')!;
    const assetId = cut.outputs.asset as string;
    expect(typeof assetId).toBe('string');
    expect(assetId).not.toBe('');
    // outputs.final in the manifest names that asset, not an empty string.
    expect(manifest.outputs.final).toBe(assetId);
    // The assembled file was registered with its run-folder path.
    const [row] = await database.db
      .select({ id: assets.id, path: assets.path, source: assets.source })
      .from(assets)
      .where(eq(assets.id, assetId));
    expect(row?.path).toBe('inbox/assemble/cut.mp4');
    expect(row?.source).toBe('assemble');
  });

  it('an export-final workflow resolves outputs.final to the exported asset', async () => {
    const { state, manifest } = await drive('export', EXPORT_FINAL);
    expect(state.status).toBe('completed');
    const exportStep = state.steps.find((step) => step.step_id === 'export')!;
    expect(exportStep.outputs.asset).toBe('asset-source');
    expect(exportStep.outputs.assets).toEqual(['asset-source']);
    expect(manifest.outputs.final).toBe('asset-source');
  });
});
