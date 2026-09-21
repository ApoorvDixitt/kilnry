// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The approval policy behind the two autonomy modes (F-CHT-02, TRD-11 §5).
// It decides, per tool call, whether the user must approve before it runs.
//
// Reading never asks. Free local work never asks. Deleting, moving or renaming
// Library files always asks because it cannot be undone. Training an identity,
// cloning a voice and publishing always ask in both modes because they carry
// consent. Everything else that spends money is judged on its estimate:
//
//   Ask me first        approve when the estimate is above the session's
//                       auto-approve threshold; below it the call proceeds and
//                       the card simply reports what it cost.
//   Run automatically   proceed inside the session budget, and ask only when
//                       this spend would push the session over it.
//
// A daily, monthly or folder cap is not an approval question: the tool itself
// refuses with BUDGET_EXCEEDED so the assistant can offer a smaller plan. The
// single exception is a workspace whose cap behaviour is "ask", where the cap
// does produce a card.

import { KILNRY_TOOLS, type KilnryTool } from '@kilnry/core';
import type { Autonomy } from './instructions.js';

/** The default auto-approve threshold for Ask-me-first (PRD-11 §3). */
export const AUTO_APPROVE_BELOW_USD_DEFAULT = 0.5;

/** Tools that can spend money (TRD-11 §5). */
export const SPEND_TOOLS = new Set([
  'kilnry_generate',
  'kilnry_transform',
  'kilnry_analyze',
  'kilnry_characters_manage',
  'kilnry_voices',
  'kilnry_workflows',
  'kilnry_presets',
  'kilnry_publish',
]);

/** Free, non-destructive tools that never need approval. */
const NEVER_ASK = new Set(['kilnry_ffmpeg', 'kilnry_import']);

/** Actions of a spending tool that do not themselves spend. */
const NON_SPENDING_ACTIONS: Record<string, string[]> = {
  kilnry_workflows: ['list', 'get', 'plan'],
  kilnry_presets: ['list', 'get'],
  kilnry_voices: ['list', 'get'],
  kilnry_characters_manage: ['create', 'update', 'delete', 'set_consent', 'bind_voice'],
  kilnry_publish: ['list', 'targets'],
  kilnry_analyze: ['probe', 'transcribe_local'],
};

/** Library actions that destroy or move the user's files. */
const DESTRUCTIVE_LIBRARY_ACTIONS = ['delete', 'move', 'rename'];

/**
 * Consent-bearing or irreversible calls that always ask, in both autonomy modes
 * (PRD-11 §3). Training and cloning create a likeness; publishing is public;
 * deleting cannot be undone.
 */
export function alwaysAsk(name: string, input: Record<string, unknown>): boolean {
  const action = typeof input['action'] === 'string' ? input['action'] : '';
  if (name === 'kilnry_characters_manage' && action === 'train') return true;
  if (name === 'kilnry_voices' && action === 'clone') return true;
  if (name === 'kilnry_publish' && action === 'publish') return true;
  if (name === 'kilnry_library_manage' && DESTRUCTIVE_LIBRARY_ACTIONS.includes(action)) return true;
  return false;
}

/** Whether this call of a spending tool actually spends. */
export function isSpendingAction(name: string, input: Record<string, unknown>): boolean {
  const free = NON_SPENDING_ACTIONS[name];
  if (!free) return true;
  const action = typeof input['action'] === 'string' ? input['action'] : '';
  if (name === 'kilnry_analyze') {
    const task = typeof input['task'] === 'string' ? input['task'] : '';
    return !free.includes(task);
  }
  return action === '' ? true : !free.includes(action);
}

/** What the estimator tells the policy about a pending spend. */
export interface PreEstimate {
  estimate_usd: number;
  /** True when a daily, monthly or folder cap would be exceeded. */
  would_exceed_caps?: boolean;
}

export interface ApprovalSession {
  autonomy: Autonomy;
  spent_usd: number;
  budget_usd?: number;
  auto_approve_below_usd?: number;
}

export interface ApprovalPolicyInput {
  session: ApprovalSession;
  /** Prices a pending call the same way the tool will. */
  preEstimate: (name: string, input: Record<string, unknown>) => Promise<PreEstimate>;
  /** The workspace cap behaviour; "ask" is the one cap that shows a card. */
  capBehavior?: 'block' | 'ask';
  tools?: KilnryTool[];
}

/** The AI SDK asks for this verdict before running a tool. */
export type ApprovalVerdict = 'user-approval' | undefined;

/**
 * Build the per-tool approval record the runtime passes to the model call
 * (TRD-11 §5). Read-only and free tools are left out entirely, which is how the
 * SDK is told they never need approval.
 */
export function approvalPolicy(
  input: ApprovalPolicyInput,
): Record<string, (options: { input: Record<string, unknown> }) => Promise<ApprovalVerdict>> {
  const { session, preEstimate } = input;
  const tools = input.tools ?? KILNRY_TOOLS;
  const threshold = session.auto_approve_below_usd ?? AUTO_APPROVE_BELOW_USD_DEFAULT;
  const policy: Record<string, (options: { input: Record<string, unknown> }) => Promise<ApprovalVerdict>> =
    {};

  for (const definition of tools) {
    const name = definition.name;
    // Reading never asks — but the catalogue marks kilnry_voices and
    // kilnry_analyze read-only even though cloning a voice carries consent and
    // a vision-language analysis spends money (TRD-11 §5 lists both as spending
    // tools). The spending list therefore wins over the read-only hint, because
    // the consent gate must never be skipped.
    if (definition.annotations.readOnlyHint === true && !SPEND_TOOLS.has(name)) continue;
    if (NEVER_ASK.has(name)) continue;

    if (name === 'kilnry_library_manage') {
      // Destructive but free: ask only for the actions that lose data.
      policy[name] = async ({ input: callInput }) =>
        alwaysAsk(name, callInput) ? 'user-approval' : undefined;
      continue;
    }

    if (!SPEND_TOOLS.has(name)) continue;

    policy[name] = async ({ input: callInput }) => {
      if (alwaysAsk(name, callInput)) return 'user-approval';
      if (!isSpendingAction(name, callInput)) return undefined;

      const estimate = await preEstimate(name, callInput);

      // A daily, monthly or folder cap is the tool's refusal, not a card —
      // unless the workspace asks at its caps, which is the one exception.
      if (estimate.would_exceed_caps === true) {
        return input.capBehavior === 'ask' ? 'user-approval' : undefined;
      }

      if (session.autonomy === 'ask_first') {
        return estimate.estimate_usd > threshold ? 'user-approval' : undefined;
      }

      // Run automatically: ask only when the session budget would be passed.
      if (
        typeof session.budget_usd === 'number' &&
        session.spent_usd + estimate.estimate_usd > session.budget_usd
      ) {
        return 'user-approval';
      }
      return undefined;
    };
  }

  return policy;
}

/**
 * Cache pre-estimates for a short while by tool and input, so asking the policy
 * and then running the tool does not price the same call twice (TRD-11 §5).
 */
export function cachedPreEstimate(
  estimate: (name: string, input: Record<string, unknown>) => Promise<PreEstimate>,
  ttlMs = 60_000,
  now: () => number = Date.now,
): (name: string, input: Record<string, unknown>) => Promise<PreEstimate> {
  const cache = new Map<string, { at: number; value: Promise<PreEstimate> }>();
  return async (name, input) => {
    const key = `${name}:${JSON.stringify(input)}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = estimate(name, input);
    cache.set(key, { at: now(), value });
    return value;
  };
}

/**
 * The cost the runtime injects when a call is approved or auto-approved, so the
 * model never has to learn the confirmation handshake (TRD-11 §5).
 */
export function withConfirmedCost(
  input: Record<string, unknown>,
  estimateUsd: number,
): Record<string, unknown> {
  return { ...input, confirm_cost_usd: estimateUsd };
}

/** The result a denied call returns to the model (TRD-11 §5). */
export function deniedResult(): { error: { code: string; message: string; retryable: boolean } } {
  return { error: { code: 'CANCELLED', message: 'User denied.', retryable: false } };
}
