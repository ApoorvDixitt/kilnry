// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Chat request lifecycle (TRD-11 §1). One turn is: load the session, resolve
// the language model the user chose, rebuild the system prompt from the prompt
// library and the session state, register the twenty Kilnry tools, run the tool
// loop, and stream the result back as user-interface message parts.
//
// The approval policy and the cost metering are supplied by the caller so the
// autonomy modes and the session budget can be added without reopening this
// file; when they are absent the loop runs with no extra approval gate and the
// tools' own budget checks still apply.

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type ToolSet,
  type UIMessage,
} from 'ai';
import {
  assembleInstructions,
  type Autonomy,
  type PromptVars,
  type SkillIndexEntry,
} from './instructions.js';
import type { LlmPrice, ResolvedLlm } from './model.js';

/** The most tool-calling steps one turn may take (TRD-11 §1). */
export const MAX_STEPS = 12;

/** The smaller step budget a local model with a short context window gets (§10). */
export const MAX_STEPS_SMALL_CONTEXT = 6;

/** The session state one turn reads (TRD-11 §1 step 1). */
export interface ChatSessionState {
  id: string;
  folder?: string;
  autonomy: Autonomy;
  budget_usd?: number;
  spent_usd: number;
  auto_approve_below_usd?: number;
}

export interface ChatTurnInput {
  session: ChatSessionState;
  /** The conversation so far, in the user-interface message shape. */
  messages: UIMessage[];
  /** The resolved language model, its price and its capabilities. */
  llm: ResolvedLlm;
  /** Where the prompt library lives, passed in by the application. */
  promptsRoot: string;
  /** The registered Kilnry tools for this turn. */
  tools: ToolSet;
  /** Enabled skills for the discover-then-load index block. */
  skills?: SkillIndexEntry[];
  /** The generated routing table block. */
  routingTable?: string;
  /** The project memory body for the session's folder. */
  memoryBody?: string;
  /** Extra prompt variables the caller knows (characters, providers, today). */
  vars?: PromptVars;
  /** Which tools need the user's approval before they run (TRD-11 §5). */
  toolApproval?: Record<string, unknown>;
  /** Called at the end of each step with the step's token usage and cost. */
  onStepEnd?: (event: { usage: unknown; cost_usd: number }) => void | Promise<void>;
  /** Called once when the turn ends, with the whole turn's usage. */
  onTurnEnd?: (event: { usage: unknown; cost_usd: number }) => void | Promise<void>;
  /** Persists the finished messages so the thread survives a reload. */
  onMessages?: (messages: UIMessage[]) => void | Promise<void>;
  /** Generates the assistant message id; supplied so ids stay stable in tests. */
  generateMessageId?: () => string;
}

/**
 * Build the `instructions` string for one turn from the session state. Kept
 * separate from the stream so the prompt can be inspected and tested without
 * calling a model.
 */
export function turnInstructions(input: ChatTurnInput): string {
  const vars: PromptVars = {
    autonomy: input.session.autonomy,
    llm_name: `${input.llm.ref.provider}/${input.llm.ref.model}`,
    llm_price: priceLabel(input.llm.price),
    ...(input.session.folder ? { folder: input.session.folder } : {}),
    ...(typeof input.session.auto_approve_below_usd === 'number'
      ? { auto_approve_below_usd: input.session.auto_approve_below_usd }
      : {}),
    ...(typeof input.session.budget_usd === 'number'
      ? {
          session_budget_usd: input.session.budget_usd,
          session_spent_usd: input.session.spent_usd,
          budget_remaining_usd: Math.max(input.session.budget_usd - input.session.spent_usd, 0),
        }
      : {}),
    ...input.vars,
  };
  const assembled = assembleInstructions({
    promptsRoot: input.promptsRoot,
    autonomy: input.session.autonomy,
    offline: input.llm.local,
    vars,
    ...(input.routingTable ? { routingTable: input.routingTable } : {}),
    ...(input.skills ? { skills: input.skills } : {}),
    ...(input.memoryBody ? { memoryBody: input.memoryBody } : {}),
  });
  return assembled.instructions;
}

function priceLabel(price: LlmPrice): string {
  if (price.in === 0 && price.out === 0) return 'free';
  return `$${price.in} / $${price.out} per M`;
}

/**
 * Run one chat turn and return the streamed response (TRD-11 §1 steps 2 to 8).
 * Token cost is metered per step so the header and the Cost tab can follow the
 * spend as it happens.
 */
export async function streamChatTurn(input: ChatTurnInput): Promise<Response> {
  const steps = input.llm.caps.context < 16_384 ? MAX_STEPS_SMALL_CONTEXT : MAX_STEPS;
  const { tokensToUsd } = await import('./model.js');

  const result = streamText({
    model: input.llm.model,
    instructions: turnInstructions(input),
    messages: await convertToModelMessages(input.messages),
    tools: input.tools,
    stopWhen: isStepCount(steps),
    ...(input.toolApproval ? { toolApproval: input.toolApproval as never } : {}),
    onStepEnd: async ({ usage }) => {
      await input.onStepEnd?.({ usage, cost_usd: tokensToUsd(usage ?? {}, input.llm.price) });
    },
    onEnd: async ({ usage }) => {
      await input.onTurnEnd?.({ usage, cost_usd: tokensToUsd(usage ?? {}, input.llm.price) });
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: input.messages,
      ...(input.generateMessageId ? { generateMessageId: input.generateMessageId } : {}),
      onEnd: async ({ messages }) => {
        await input.onMessages?.(messages);
      },
    }),
  });
}
