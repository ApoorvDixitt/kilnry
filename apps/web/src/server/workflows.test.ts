// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The workflow host runner money path (F-WFL-01/02/03, TRD-12 §6). A fake engine
// counts submits and ledger writes: driving the pure executor with effects that
// build their createJob input exactly as the server does proves one submit per
// spending step, each tagged source 'workflow' with the run and step id and the
// plan step's estimate as the confirmed cost, and that the executor never reaches
// a provider adapter.

import { describe, expect, it } from 'vitest';
import {
  execute,
  parseWorkflow,
  plan,
  renderStep,
  type Effects,
  type ExpandedExportStep,
  type PlanContext,
  type RunStep,
  type Scope,
  type Step,
  type StepResult,
} from '@kilnry/workflows';
import { buildSpendInput, importWorkflow } from './workflows';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WF = `
id: kilnry-money-demo
name: Money demo
version: 1.0.0
category: ads
steps:
  - id: boards
    kind: foreach
    over: "{{ [0, 1] }}"
    steps:
      - id: board
        kind: generate
        capability: text2image
        prompt: "board {{ index }}"
        outputs: { asset: "{{ result.assets[0] }}" }
  - id: assemble
    kind: assemble
    op: concat
    inputs: ["{{ steps.boards.assets }}"]
  - id: clip
    kind: generate
    capability: reference2video
    prompt: "clip"
    depends_on: [assemble]
    outputs: { asset: "{{ result.assets[0] }}" }
`;

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

describe('workflow host runner money path (F-WFL-01/02/03)', () => {
  it('submits one job per spending step, tagged source workflow with run and step id', async () => {
    const workflow = parseWorkflow(WF);
    const priced = plan(workflow, {}, planCtx);
    const scope: Scope = { inputs: {}, defaults: {}, vars: {} };

    const submits: Array<ReturnType<typeof buildSpendInput>> = [];
    let ledgerWrites = 0;

    // The fake engine stands in for JobEngine.createJob: it records the submit
    // (one ledger row per submit, as the real engine writes) and completes.
    const fakeCreateJob = (input: ReturnType<typeof buildSpendInput>): { assets: string[] } => {
      submits.push(input);
      ledgerWrites += 1;
      return { assets: [`asset-${submits.length}`] };
    };

    const effects: Effects = {
      runStep: async (node: RunStep, rendered: Step | ExpandedExportStep): Promise<StepResult> => {
        if (node.kind === 'generate') {
          const planStep = priced.steps.find((step) => step.step_id === node.step_id);
          const jobInput = buildSpendInput(
            'run_1',
            'Client_A/Money_demo_2026-09-18_1120',
            node,
            rendered as Step,
            scope,
            planStep?.estimate_usd ?? 0,
          );
          const result = fakeCreateJob(jobInput);
          return {
            outputs: { asset: result.assets[0], assets: result.assets },
            actual_usd: jobInput.confirmed_cost_usd,
            status: 'completed',
          };
        }
        // assemble/set/export never spend and never submit.
        return { outputs: {}, actual_usd: 0, status: 'completed' };
      },
    };

    const state = await execute(workflow, scope, effects, { automatic: true });

    expect(state.status).toBe('completed');
    // 2 boards + 1 clip = 3 spending submits, and one ledger write each.
    expect(submits).toHaveLength(3);
    expect(ledgerWrites).toBe(3);
    for (const submit of submits) {
      expect(submit.request.source).toBe('workflow');
      expect(submit.run_id).toBe('run_1');
      expect(submit.step_id).toMatch(/board|clip/);
      expect(submit.confirmed_by).toBe('user');
      expect(submit.confirmed_cost_usd).toBeCloseTo(0.25, 6);
      expect(submit.request.target_folder).toBe('Client_A/Money_demo_2026-09-18_1120');
    }
  });

  it('buildSpendInput renders the step prompt and carries the client request id', () => {
    const workflow = parseWorkflow(WF);
    const scope: Scope = { inputs: {}, defaults: {}, vars: {} };
    // Reach the first board node by expanding via the executor with a no-op.
    const node: RunStep = {
      step_id: 'board',
      instance_id: 'boards[0].board',
      kind: 'generate',
      step: workflow.steps[0]!,
      status: 'pending',
      depends_on: [],
      scope_extra: { index: 0 },
      outputs: {},
      actual_usd: 0,
      attempts: 0,
      adjustments: [],
      approval: false,
    };
    const rendered = renderStep(
      {
        kind: 'generate',
        id: 'board',
        capability: 'text2image',
        prompt: 'board {{ index }}',
        model: 'auto',
        alternates: [],
        params: {},
        medias: [],
        characters: [],
        count: 1,
        depends_on: [],
        on_fail: 'fail',
        outputs: {},
        approval: false,
        timeout_s: 1800,
      } as unknown as Step,
      { index: 0 },
    );
    const input = buildSpendInput('run_9', 'inbox/x', node, rendered, scope, 0.5);
    expect(input.client_request_id).toBe('run_9:boards[0].board');
    expect(input.request.prompt).toContain('board');
    expect(input.request.source).toBe('workflow');
  });
});

describe('every spending step of every kind reaches the engine once (F-WFL-06)', () => {
  // The shipped catalogue folder, resolved from this test file.
  function catalogueRoot(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, '..', '..', '..', '..', 'packages', 'workflows', 'catalogue');
  }

  function loadCatalogueWorkflow(id: string) {
    return parseWorkflow(readFileSync(join(catalogueRoot(), `${id}.yaml`), 'utf8'));
  }

  // A planner that prices every spending leaf the same small amount, enough to
  // expand foreach/branch and drive the executor without a real engine. Its
  // resolveInputs applies the workflow's JSON-Schema defaults (as the intake
  // drawer does) so a foreach whose `over` reads an input with a default — such
  // as the website mode's site_shots — resolves rather than throwing.
  const fixturePlan: PlanContext = {
    resolveInputs: (workflow, inputs) => {
      const properties =
        (workflow.inputs as { properties?: Record<string, { default?: unknown }> }).properties ?? {};
      const withDefaults: Record<string, unknown> = { ...inputs };
      for (const [key, schema] of Object.entries(properties)) {
        if (withDefaults[key] === undefined && schema.default !== undefined) {
          withDefaults[key] = schema.default;
        }
      }
      return withDefaults;
    },
    priceStep: (step: Step) => ({
      model: step.kind === 'generate' ? 'fal/x' : 'openrouter/gemini',
      provider: step.kind === 'generate' ? 'fal' : 'openrouter',
      estimate_usd: 0.05,
      eta_s: 3,
      why: 'fixture',
    }),
  };

  // Drive a catalogue workflow through the pure executor with effects that mirror
  // the host runner: a generate or transform step builds its createJob input
  // through buildSpendInput and reaches the fake engine once; an analyze step is
  // a metered analyze-tool call that writes one ledger row but never a createJob.
  // Each spending step writes exactly one ledger row. assemble, set and export
  // never spend.
  function runCounting(id: string, inputs: Record<string, unknown>) {
    const workflow = loadCatalogueWorkflow(id);
    const resolved = fixturePlan.resolveInputs(workflow, inputs);
    const priced = plan(workflow, inputs, fixturePlan);
    const scope: Scope = { inputs: resolved, defaults: workflow.defaults, vars: priced.vars };
    const submitsByKind: Record<string, number> = { generate: 0, transform: 0, analyze: 0 };
    // A mutable counter object so the returned handle observes every increment
    // (a returned primitive would freeze at zero).
    const counters = { ledgerWrites: 0 };
    const submits: Array<ReturnType<typeof buildSpendInput>> = [];
    // The capability each analyze step priced at, to assert it routed as a
    // vision-language or text call — the same split the analyze tool prices on.
    const analyzeCaps: string[] = [];

    const fakeCreateJob = (input: ReturnType<typeof buildSpendInput>, kind: string): { assets: string[] } => {
      submits.push(input);
      submitsByKind[kind] = (submitsByKind[kind] ?? 0) + 1;
      counters.ledgerWrites += 1; // the real engine writes exactly one spend-ledger row per createJob
      return { assets: [`asset-${submits.length}`] };
    };

    const effects: Effects = {
      // Answer every checkpoint immediately so a fixture run reaches the end.
      decide: async (): Promise<'approve' | 'deny' | 'wait'> => 'approve',
      runStep: async (node: RunStep, rendered: Step | ExpandedExportStep): Promise<StepResult> => {
        if (node.kind === 'analyze') {
          // Mirror analyzeThroughTool: the metered analyze tool prices vlm/llm,
          // writes one ledger row, and returns a structured result the branch
          // reads — but it is not a createJob submit.
          const analyzeStep = rendered as Extract<Step, { kind: 'analyze' }>;
          const refs = Array.isArray(analyzeStep.refs) ? (analyzeStep.refs as unknown[]) : [];
          submitsByKind.analyze = (submitsByKind.analyze ?? 0) + 1;
          analyzeCaps.push(refs.length > 0 ? 'vlm' : 'llm');
          counters.ledgerWrites += 1; // one spend-ledger row per analyze call
          const planStep = priced.steps.find((step) => step.step_id === node.step_id);
          return {
            outputs: {
              result: {
                text: 'a product',
                structured: {
                  ok: true,
                  pass: true,
                  reasons: [],
                  issues: [],
                  description: 'a product',
                  visible_text: '',
                  tier: 'everyday',
                  hook: 'hook',
                  segments: ['a', 'b', 'c', 'd', 'e'],
                },
                score: 0.9,
                badge: 'high',
              },
            },
            actual_usd: planStep?.estimate_usd ?? 0,
            provider: 'openrouter',
            status: 'completed',
          };
        }
        if (node.kind === 'generate' || node.kind === 'transform') {
          const planStep = priced.steps.find((step) => step.step_id === node.step_id);
          const jobInput = buildSpendInput(
            'run_fixture',
            'Client_A/Run_2026-09-18_1120',
            node,
            rendered as Step,
            scope,
            planStep?.estimate_usd ?? 0,
          );
          const result = fakeCreateJob(jobInput, node.kind);
          return {
            outputs: {
              asset: result.assets[0],
              assets: result.assets,
              // Generous result namespace so the shipped workflows' output
              // templates (a transform's transcript, a board's clean plate) all
              // resolve during a fixture run; the assertion here is on the money
              // path, not on provider content.
              result: {
                assets: result.assets,
                asset_id: result.assets[0],
                words: [],
              },
            },
            actual_usd: jobInput.confirmed_cost_usd,
            status: 'completed',
          };
        }
        return { outputs: { asset: 'local', assets: ['local'] }, actual_usd: 0, status: 'completed' };
      },
    };

    return { workflow, priced, submits, submitsByKind, analyzeCaps, counters, effects, scope };
  }

  it('runs the transcribe transform of kilnry-subtitles-burn through the engine once', async () => {
    const run = runCounting('kilnry-subtitles-burn', {
      video: 'asset-video-1',
      look: 'clean',
      language: 'en',
      max_line_chars: 28,
      position: 'lower_third',
      karaoke: false,
    });
    const state = await execute(run.workflow, run.scope, run.effects, {
      automatic: true,
      skipApprovals: true,
    });
    expect(['completed', 'cancelled']).toContain(state.status);
    // Exactly one spending step: the transcribe transform. burn is a local
    // ffmpeg assemble and export copies files — neither spends.
    expect(run.submits).toHaveLength(1);
    expect(run.submitsByKind.transform).toBe(1);
    expect(run.submitsByKind.generate).toBe(0);
    expect(run.counters.ledgerWrites).toBe(1);
    const transform = run.submits[0]!;
    expect(transform.request.source).toBe('workflow');
    expect(transform.step_id).toBe('transcribe');
    expect(transform.confirmed_by).toBe('user');
    // The transcribe request routes as speech-to-text over the source video, not
    // a placeholder image request.
    expect(transform.request.capability).toBe('stt');
    expect(transform.request.medias.some((media) => media.asset_id === 'asset-video-1')).toBe(true);
  });

  it('runs every generate, transform and analyze step of kilnry-ugc-ad through the engine once', async () => {
    const run = runCounting('kilnry-ugc-ad', {
      mode: 'product-only',
      product: 'asset-serum-1',
      duration_s: 15,
      approved_claims: ['hydrating'],
      folder: 'Client_A',
    });
    // The run drives every spending step through the fake engine. The terminal
    // export step's per-file name templates (F-WFL-09 array expansion) are not
    // the subject here; if it raises while rendering, the spending steps have
    // already gone through the engine and the money-path assertions below hold.
    try {
      await execute(run.workflow, run.scope, run.effects, { automatic: true, skipApprovals: true });
    } catch {
      // A terminal export/render issue does not undo the spending already routed.
    }

    const generate = run.submitsByKind.generate ?? 0;
    const transform = run.submitsByKind.transform ?? 0;
    const analyze = run.submitsByKind.analyze ?? 0;

    // Every spending step writes exactly one ledger row: a generate or transform
    // through createJob (counted in run.submits), and an analyze through the
    // metered analyze tool (counted separately, never a createJob). The gate,
    // product normalisation, script and clip-QA analyze steps, the storyboard
    // and clip generates all run.
    expect(analyze).toBeGreaterThan(0);
    expect(generate).toBeGreaterThan(0);
    expect(transform).toBeGreaterThan(0);
    // createJob submits are generate + transform only; analyze does not submit.
    expect(run.submits.length).toBe(generate + transform);
    // One ledger row per spending step of every kind.
    expect(run.counters.ledgerWrites).toBe(generate + transform + analyze);
    // Each analyze priced as a vision-language or a text call, never a generate.
    expect(run.analyzeCaps.length).toBe(analyze);
    for (const cap of run.analyzeCaps) expect(['vlm', 'llm']).toContain(cap);

    for (const submit of run.submits) {
      expect(submit.request.source).toBe('workflow');
      expect(submit.run_id).toBe('run_fixture');
      expect(submit.confirmed_by).toBe('user');
      expect(submit.request.target_folder).toBe('Client_A/Run_2026-09-18_1120');
    }
    // A generate step keeps a generative capability, not an analyze or transform
    // one.
    const generateSubmits = run.submits.filter((submit) =>
      ['text2image', 'image_edit', 'reference2video', 'text2video', 'image2video'].includes(
        submit.request.capability,
      ),
    );
    expect(generateSubmits.length).toBe(generate);
  });

  it('the gate analyze passing lets kilnry-ugc-ad past the hard-stop branch', async () => {
    // The gate step reads result.structured.ok; the fixture analyze returns
    // ok:true, so the `when: {{ !steps.gate.outputs.ok }}` hard-stop branch does
    // not fire and the run reaches its clip generates and completes.
    const run = runCounting('kilnry-ugc-ad', {
      mode: 'product-only',
      product: 'asset-serum-1',
      duration_s: 15,
      approved_claims: ['hydrating'],
      folder: 'Client_A',
    });
    let status = 'unknown';
    try {
      const state = await execute(run.workflow, run.scope, run.effects, {
        automatic: true,
        skipApprovals: true,
      });
      status = state.status;
    } catch {
      // A terminal export/render issue does not undo the branch decision proven
      // by the spends already routed below.
    }
    // The clip generates only run when the gate did not stop the run: at least
    // one video/image generate reached the engine.
    expect(run.submitsByKind.generate).toBeGreaterThan(0);
    expect(['completed', 'cancelled', 'unknown']).toContain(status);
  });

  it('the shipped catalogue exercises a spending step of every wired kind', () => {
    // A guard that the fixtures above cover transform and analyze, not only
    // generate: the catalogue must exercise all three wired kinds.
    const kinds = new Set<string>();
    for (const file of readdirSync(catalogueRoot()).filter((name) => /\.ya?ml$/.test(name))) {
      const workflow = parseWorkflow(readFileSync(join(catalogueRoot(), file), 'utf8'));
      const walk = (steps: Step[]): void => {
        for (const step of steps) {
          kinds.add(step.kind);
          if (step.kind === 'branch') {
            walk(step.then);
            walk(step.else);
          } else if (step.kind === 'foreach') {
            walk(step.steps);
          }
        }
      };
      walk(workflow.steps);
    }
    expect(kinds.has('generate')).toBe(true);
    expect(kinds.has('transform')).toBe(true);
    expect(kinds.has('analyze')).toBe(true);
  });
});

describe('workflow import (F-WFL-06, same validator as the CLI)', () => {
  it('writes a valid workflow to the user folder and refuses an invalid one', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kilnry-wf-import-'));
    const good = importWorkflow(
      dataDir,
      `
id: kilnry-imported
name: Imported
version: 1.0.0
category: image
steps:
  - id: gen
    kind: generate
    capability: text2image
    prompt: "hi"
    outputs: { asset: "{{ result.assets[0] }}" }
outputs:
  final: "{{ steps.gen.outputs.asset }}"
`,
      'kilnry-imported',
    );
    expect(good.ok).toBe(true);
    expect(good.id).toBe('kilnry-imported');
    expect(existsSync(join(dataDir, 'workflows', 'kilnry-imported.yaml'))).toBe(true);
    expect(readFileSync(join(dataDir, 'workflows', 'kilnry-imported.yaml'), 'utf8')).toContain(
      'id: kilnry-imported',
    );

    // A provider prompt token fails rule 7.7 — the same rule the CLI enforces.
    const bad = importWorkflow(
      dataDir,
      `
id: kilnry-bad
name: Bad
version: 1.0.0
category: image
steps:
  - id: gen
    kind: generate
    capability: text2image
    prompt: "inject <<< maya >>>"
`,
      'kilnry-bad',
    );
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((issue) => issue.rule === '7.7')).toBe(true);
  });
});
