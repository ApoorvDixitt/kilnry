// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { EventHub } from '@kilnry/core';
import { describe, expect, it, vi } from 'vitest';
import {
  alwaysAsk,
  approvalPolicy,
  AUTO_APPROVE_BELOW_USD_DEFAULT,
  cachedPreEstimate,
  deniedResult,
  isSpendingAction,
  trackApprovals,
  withConfirmedCost,
  type ApprovalSession,
  type ApprovalVerdict,
} from './approval.js';
import { headerMeter, meterStep, sessionBudgetReachedText, wouldExceedSessionBudget } from './metering.js';

const askFirst: ApprovalSession = { autonomy: 'ask_first', spent_usd: 0, budget_usd: 5 };
const automatic: ApprovalSession = { autonomy: 'run_automatically', spent_usd: 0, budget_usd: 5 };

function policyFor(session: ApprovalSession, estimateUsd: number, wouldExceedCaps = false) {
  return approvalPolicy({
    session,
    preEstimate: async () => ({ estimate_usd: estimateUsd, would_exceed_caps: wouldExceedCaps }),
  });
}

async function verdict(
  session: ApprovalSession,
  tool: string,
  input: Record<string, unknown>,
  estimateUsd = 0.1,
  wouldExceedCaps = false,
): Promise<ApprovalVerdict | 'NOT_REGISTERED'> {
  const policy = policyFor(session, estimateUsd, wouldExceedCaps);
  const entry = policy[tool];
  if (!entry) return 'NOT_REGISTERED';
  return entry(input);
}

describe('approval policy (F-CHT-02, TRD-11 §5)', () => {
  it('never asks for a read-only tool: it is not in the policy at all', async () => {
    const policy = policyFor(askFirst, 1);
    for (const name of [
      'kilnry_models',
      'kilnry_estimate',
      'kilnry_providers',
      'kilnry_budget',
      'kilnry_skills',
    ]) {
      expect(policy[name]).toBeUndefined();
    }
  });

  it('never asks for free local work', async () => {
    const policy = policyFor(askFirst, 1);
    expect(policy['kilnry_ffmpeg']).toBeUndefined();
    expect(policy['kilnry_import']).toBeUndefined();
  });

  it('always asks before training, cloning or publishing, in both modes', async () => {
    for (const session of [askFirst, automatic]) {
      expect(await verdict(session, 'kilnry_characters_manage', { action: 'train' }, 0.01)).toBe(
        'user-approval',
      );
      expect(await verdict(session, 'kilnry_voices', { action: 'clone' }, 0.01)).toBe('user-approval');
      expect(await verdict(session, 'kilnry_publish', { action: 'publish' }, 0.01)).toBe('user-approval');
    }
  });

  it('always asks before deleting, moving or renaming Library files', async () => {
    for (const action of ['delete', 'move', 'rename']) {
      expect(await verdict(askFirst, 'kilnry_library_manage', { action })).toBe('user-approval');
    }
    expect(await verdict(askFirst, 'kilnry_library_manage', { action: 'tag' })).toBeUndefined();
  });

  it('Ask me first: approves above the threshold, proceeds at or below it', async () => {
    expect(await verdict(askFirst, 'kilnry_generate', { prompt: 'a' }, 0.75)).toBe('user-approval');
    expect(await verdict(askFirst, 'kilnry_generate', { prompt: 'a' }, 0.5)).toBeUndefined();
    expect(await verdict(askFirst, 'kilnry_generate', { prompt: 'a' }, 0.04)).toBeUndefined();
  });

  it('Ask me first: honours a session threshold that overrides the default', async () => {
    const session: ApprovalSession = { ...askFirst, auto_approve_below_usd: 2 };
    expect(AUTO_APPROVE_BELOW_USD_DEFAULT).toBe(0.5);
    expect(await verdict(session, 'kilnry_generate', { prompt: 'a' }, 1.5)).toBeUndefined();
    expect(await verdict(session, 'kilnry_generate', { prompt: 'a' }, 2.5)).toBe('user-approval');
  });

  it('Run automatically: proceeds inside the budget and identifies the session-cap pause', async () => {
    expect(await verdict(automatic, 'kilnry_generate', { prompt: 'a' }, 2)).toBeUndefined();
    const nearlySpent: ApprovalSession = { ...automatic, spent_usd: 4.5 };
    expect(await verdict(nearlySpent, 'kilnry_generate', { prompt: 'a' }, 1)).toEqual({
      type: 'user-approval',
      reason: 'session-budget:5.00',
    });
  });

  it('leaves a daily or monthly cap to the tool rather than a card', async () => {
    expect(await verdict(askFirst, 'kilnry_generate', { prompt: 'a' }, 10, true)).toBeUndefined();
  });

  it('shows a card at the cap when the workspace asks at its caps', async () => {
    const policy = approvalPolicy({
      session: askFirst,
      preEstimate: async () => ({ estimate_usd: 10, would_exceed_caps: true }),
      capBehavior: 'ask',
    });
    expect(await policy['kilnry_generate']?.({ prompt: 'a' })).toBe('user-approval');
  });

  it('does not ask for the free actions of a spending tool', async () => {
    expect(await verdict(askFirst, 'kilnry_workflows', { action: 'plan' }, 9)).toBeUndefined();
    expect(await verdict(askFirst, 'kilnry_presets', { action: 'list' }, 9)).toBeUndefined();
    expect(await verdict(askFirst, 'kilnry_voices', { action: 'list' }, 9)).toBeUndefined();
    expect(isSpendingAction('kilnry_analyze', { task: 'transcribe_local' })).toBe(false);
    expect(isSpendingAction('kilnry_analyze', { task: 'describe' })).toBe(true);
  });

  it('names the consent-bearing calls through alwaysAsk', () => {
    expect(alwaysAsk('kilnry_voices', { action: 'clone' })).toBe(true);
    expect(alwaysAsk('kilnry_voices', { action: 'list' })).toBe(false);
  });

  it('records who confirmed each call: the card above the threshold, the policy below it', async () => {
    const above = trackApprovals(policyFor(askFirst, 0.75));
    expect(await above.policy['kilnry_generate']?.({ prompt: 'a' })).toBe('user-approval');
    expect(above.confirmerFor('kilnry_generate', { prompt: 'a' })).toBe('user');
    // The runtime injects the confirmed cost before running an approved call; it
    // is still the same call that was judged.
    expect(above.confirmerFor('kilnry_generate', { prompt: 'a', confirm_cost_usd: 0.75 })).toBe('user');

    const below = trackApprovals(policyFor(askFirst, 0.04));
    expect(await below.policy['kilnry_generate']?.({ prompt: 'a' })).toBeUndefined();
    expect(below.confirmerFor('kilnry_generate', { prompt: 'a' })).toBe('auto');
  });

  it('records Run automatically inside the budget as automatic, and its cap pause as the user', async () => {
    const inside = trackApprovals(policyFor(automatic, 2));
    expect(await inside.policy['kilnry_generate']?.({ prompt: 'a' })).toBeUndefined();
    expect(inside.confirmerFor('kilnry_generate', { prompt: 'a' })).toBe('auto');

    const overCap = trackApprovals(policyFor({ ...automatic, spent_usd: 4.5 }, 1));
    expect(await overCap.policy['kilnry_generate']?.({ prompt: 'a' })).toEqual({
      type: 'user-approval',
      reason: 'session-budget:5.00',
    });
    expect(overCap.confirmerFor('kilnry_generate', { prompt: 'a' })).toBe('user');
  });

  it('treats a call the policy never judged as the policy’s own decision', () => {
    const tracked = trackApprovals(policyFor(askFirst, 1));
    expect(tracked.confirmerFor('kilnry_generate', { prompt: 'unjudged' })).toBe('auto');
  });

  it('injects the confirmed cost and reports a denial the model can read', () => {
    expect(withConfirmedCost({ prompt: 'a' }, 0.42)).toEqual({ prompt: 'a', confirm_cost_usd: 0.42 });
    expect(deniedResult().error.code).toBe('CANCELLED');
  });

  it('prices the same pending call only once inside the cache window', async () => {
    const estimate = vi.fn(async () => ({ estimate_usd: 1 }));
    const cached = cachedPreEstimate(estimate, 60_000);
    await cached('kilnry_generate', { prompt: 'a' });
    await cached('kilnry_generate', { prompt: 'a' });
    expect(estimate).toHaveBeenCalledOnce();
    await cached('kilnry_generate', { prompt: 'b' });
    expect(estimate).toHaveBeenCalledTimes(2);
  });
});

describe('session metering (F-CHT-02, TRD-11 §9)', () => {
  const llm = {
    ref: { provider: 'openrouter' as const, model: 'anthropic/claude-sonnet-5' },
    price: { in: 2, out: 10 },
  };

  it('prices a step, writes a ledger entry, adds it up and announces it', async () => {
    const hub = new EventHub();
    const seen: unknown[] = [];
    hub.subscribe((event) => seen.push(event.event));
    const writeLedger = vi.fn(async () => undefined);
    const recordSpend = vi.fn(async () => undefined);

    const result = await meterStep(
      {
        session: { id: 'session-1', folder: 'Campaign_A', budget_usd: 5, spent_usd: 1 },
        llm,
        writeLedger,
        recordSpend,
        hub,
      },
      { inputTokens: 100_000, outputTokens: 10_000 },
    );

    // 100k in at $2/M plus 10k out at $10/M.
    expect(result.cost_usd).toBeCloseTo(0.2 + 0.1, 6);
    expect(result.session_spent_usd).toBeCloseTo(1.3, 6);
    expect(result.budget_reached).toBe(false);
    expect(writeLedger).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'llm', provider_id: 'openrouter', folder: 'Campaign_A' }),
    );
    expect(recordSpend).toHaveBeenCalledWith('session-1', result.cost_usd);
    expect(seen).toEqual([
      expect.objectContaining({ type: 'chat.usage', session_id: 'session-1', session_spent_usd: 1.3 }),
    ]);
  });

  it('meters a local model at nothing', async () => {
    const result = await meterStep(
      {
        session: { id: 'session-1', spent_usd: 0 },
        llm: { ref: { provider: 'ollama', model: 'qwen3:8b' }, price: { in: 0, out: 0 } },
        writeLedger: async () => undefined,
        recordSpend: async () => undefined,
        hub: new EventHub(),
      },
      { inputTokens: 500_000, outputTokens: 500_000 },
    );
    expect(result.cost_usd).toBe(0);
  });

  it('reports the budget as reached once the total meets the cap', async () => {
    const result = await meterStep(
      {
        session: { id: 'session-1', budget_usd: 1, spent_usd: 0.95 },
        llm,
        writeLedger: async () => undefined,
        recordSpend: async () => undefined,
        hub: new EventHub(),
      },
      { inputTokens: 100_000, outputTokens: 0 },
    );
    expect(result.budget_reached).toBe(true);
  });

  it('projects whether the next step would pass the budget', () => {
    expect(wouldExceedSessionBudget({ spent_usd: 4.9, budget_usd: 5 }, 0.2)).toBe(true);
    expect(wouldExceedSessionBudget({ spent_usd: 4.9, budget_usd: 5 }, 0.05)).toBe(false);
    expect(wouldExceedSessionBudget({ spent_usd: 100 }, 5)).toBe(false);
  });

  it('ends on a sentence that names the cap', () => {
    expect(sessionBudgetReachedText(5)).toBe(
      'Session budget reached ($5.00). Raise it in the header to continue.',
    );
  });

  it('renders the header meter', () => {
    expect(headerMeter({ llm_usd: 0.012, tools_usd: 2.4, budget_usd: 5 })).toBe(
      'LLM $0.012 · tools $2.40 · session $2.41 / $5.00',
    );
  });
});
