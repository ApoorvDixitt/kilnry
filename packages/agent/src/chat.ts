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
  type UIMessageChunk,
} from 'ai';
import type { AttachmentPart } from './attachments.js';
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
  /** Attachment parts to add to the newest user message (TRD-11 §8). */
  attachmentParts?: AttachmentPart[];
  /** Which tools need the user's approval before they run (TRD-11 §5). */
  toolApproval?: Record<string, unknown>;
  /** Which priced plan belongs on a tool approval request. */
  approvalDescriptor?: (toolName: string, input: Record<string, unknown>) => unknown;
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
 * Add the attachment parts to the newest user message, so the files the user
 * attached arrive with the message they belong to (TRD-11 §8).
 */
export function withAttachments<T>(messages: T[], parts?: AttachmentPart[]): T[] {
  if (!parts || parts.length === 0) return messages;
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    const entry = out[i] as { role?: string; content?: unknown } | undefined;
    if (!entry || entry.role !== 'user') continue;
    const content = Array.isArray(entry.content)
      ? [...(entry.content as unknown[]), ...parts]
      : [{ type: 'text', text: String(entry.content ?? '') }, ...parts];
    out[i] = { ...entry, content } as T;
    return out;
  }
  return out;
}

/**
 * Run one chat turn and return the streamed response (TRD-11 §1 steps 2 to 8).
 * Token cost is metered per step so the header and the Cost tab can follow the
 * spend as it happens.
 */
export async function streamChatTurn(input: ChatTurnInput): Promise<Response> {
  const steps = input.llm.caps.context < 16_384 ? MAX_STEPS_SMALL_CONTEXT : MAX_STEPS;
  const { tokensToUsd } = await import('./model.js');
  const { wouldExceedSessionBudget } = await import('./metering.js');

  // The session's spend grows as the turn runs; the loop stops when the next
  // step would take it past the cap (TRD-11 §9).
  let spentUsd = input.session.spent_usd;
  let lastStepUsd = 0;

  const result = streamText({
    model: input.llm.model,
    instructions: turnInstructions(input),
    messages: withAttachments(await convertToModelMessages(input.messages), input.attachmentParts),
    tools: input.tools,
    stopWhen: [
      isStepCount(steps),
      () =>
        wouldExceedSessionBudget(
          {
            spent_usd: spentUsd,
            ...(typeof input.session.budget_usd === 'number' ? { budget_usd: input.session.budget_usd } : {}),
          },
          lastStepUsd,
        ),
    ],
    ...(input.toolApproval ? { toolApproval: input.toolApproval as never } : {}),
    onStepEnd: async ({ usage }) => {
      lastStepUsd = tokensToUsd(usage ?? {}, input.llm.price);
      spentUsd += lastStepUsd;
      await input.onStepEnd?.({ usage, cost_usd: lastStepUsd });
    },
    onEnd: async ({ usage }) => {
      await input.onTurnEnd?.({ usage, cost_usd: tokensToUsd(usage ?? {}, input.llm.price) });
    },
  });

  const uiStream = toUIMessageStream({
    stream: result.stream,
    originalMessages: input.messages,
    ...(input.generateMessageId ? { generateMessageId: input.generateMessageId } : {}),
    onEnd: async ({ messages }) => {
      await input.onMessages?.(messages);
    },
  });

  // The SDK's approval chunk carries the approval id but not the application's
  // priced plan. Follow the matching tool-input chunk by call id and attach the
  // plan as the approval descriptor, which the UI message reader preserves.
  const describedStream = input.approvalDescriptor
    ? uiStream.pipeThrough(approvalDescriptorTransform(input.approvalDescriptor))
    : uiStream;

  return createUIMessageStreamResponse({ stream: describedStream });
}

/**
 * Match a UI approval request to the tool input that preceded it and attach the
 * plan the approval policy priced. Kept as a stream transform so all clients see
 * the same descriptor, not only the React screen.
 */
function approvalDescriptorTransform(
  descriptor: (toolName: string, input: Record<string, unknown>) => unknown,
): TransformStream<UIMessageChunk, UIMessageChunk> {
  const calls = new Map<string, { toolName: string; input: Record<string, unknown> }>();
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (chunk.type === 'tool-input-available') {
        calls.set(chunk.toolCallId, {
          toolName: chunk.toolName,
          input:
            chunk.input && typeof chunk.input === 'object' ? (chunk.input as Record<string, unknown>) : {},
        });
      }
      if (chunk.type === 'tool-approval-request') {
        const call = calls.get(chunk.toolCallId);
        if (call) {
          controller.enqueue({
            ...chunk,
            approvalDescriptor: descriptor(call.toolName, call.input),
          });
          return;
        }
      }
      controller.enqueue(chunk);
    },
  });
}
