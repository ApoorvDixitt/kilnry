// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// What a chat turn does when something goes wrong (TRD-11 §14).
//
// Each failure has one agreed outcome, because guessing is worse than stopping:
// an empty balance is not retried and says which account to top up; a busy
// provider is retried once and says so while it waits; a moderated message is
// kept so the user can edit it rather than losing what they wrote; a dropped
// stream keeps the partial text and offers to regenerate. A tool failure is never
// an exception — the model reads it as a result and answers.
//
// The step cap and the session budget end the turn with a sentence rather than an
// error, because neither is a fault: the user just has to say to continue.

/** The failure codes a chat turn can report (TRD-20 codes). */
export type ChatErrorCode =
  'INSUFFICIENT_FUNDS' | 'RATE_LIMITED' | 'MODERATION_REJECTED' | 'PROVIDER_ERROR' | 'INVALID_INPUT';

/** The error part the stream ends with, which the banner reads. */
export interface ChatErrorPart {
  type: 'data-error';
  code: ChatErrorCode;
  provider?: string;
  message: string;
  /** True when a Regenerate button should be offered. */
  retryable: boolean;
  /** True when the runtime should retry once itself before reporting. */
  retry_once?: boolean;
  /** How long to wait before that retry, in seconds. */
  retry_after_s?: number;
  /** True when the user's message is kept for editing. */
  keep_message?: boolean;
}

/** The longest the runtime waits on a busy provider before giving up (§14). */
export const MAX_RETRY_AFTER_S = 20;

/** How long an unanswered approval survives before it counts as denied (§14). */
export const APPROVAL_EXPIRY_HOURS = 24;

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  ollama: 'Ollama',
};

function label(provider: string | undefined): string {
  if (!provider) return 'the provider';
  return PROVIDER_LABELS[provider] ?? provider;
}

export interface LlmFailure {
  status?: number;
  provider?: string;
  /** Seconds the provider asked us to wait, from its Retry-After header. */
  retry_after_s?: number;
  /** True when the stream ended part-way through rather than never starting. */
  mid_stream?: boolean;
  message?: string;
}

/**
 * Turn a language-model failure into the part the stream ends with (§14).
 * The message is the sentence the banner shows, so it names the account or the
 * next step rather than repeating a status code.
 */
export function llmErrorPart(failure: LlmFailure): ChatErrorPart {
  const provider = failure.provider;
  const who = label(provider);

  if (failure.status === 402) {
    return {
      type: 'data-error',
      code: 'INSUFFICIENT_FUNDS',
      ...(provider ? { provider } : {}),
      message: `Your ${who} balance is empty. Top up or switch model.`,
      retryable: false,
    };
  }

  if (failure.status === 429) {
    const wait = Math.min(failure.retry_after_s ?? 5, MAX_RETRY_AFTER_S);
    return {
      type: 'data-error',
      code: 'RATE_LIMITED',
      ...(provider ? { provider } : {}),
      message: `${who} is busy. Kilnry waited ${wait} seconds and tried once more.`,
      retryable: true,
      retry_once: true,
      retry_after_s: wait,
    };
  }

  if (failure.status === 403) {
    return {
      type: 'data-error',
      code: 'MODERATION_REJECTED',
      ...(provider ? { provider } : {}),
      message: `${who} refused that message. Edit it and send it again.`,
      retryable: false,
      keep_message: true,
    };
  }

  // A drop part-way through, or any other provider fault: keep what arrived.
  return {
    type: 'data-error',
    code: 'PROVIDER_ERROR',
    ...(provider ? { provider } : {}),
    message:
      failure.mid_stream === true
        ? `${who} stopped part-way through. What arrived is kept; regenerate to finish it.`
        : (failure.message ?? `${who} could not answer. Try again.`),
    retryable: true,
  };
}

/** The status line shown while a busy provider is being retried (§14). */
export function retryingStatusText(): string {
  return 'Provider busy, retrying…';
}

/** The sentence a turn ends with when the step cap is reached (§14). */
export function stepCapReachedText(steps: number): string {
  return `I stopped after ${steps} steps. Say 'continue' to go on.`;
}

/**
 * A tool failure the model reads as a result rather than an exception (§14).
 * The card shows it as a finished call with an error line, because the call did
 * run; the reserved failed state is for a schema or runtime fault.
 */
export function toolErrorResult(
  code: string,
  message: string,
  extra: { retryable?: boolean; provider?: string } = {},
): { error: { code: string; message: string; retryable: boolean; provider?: string } } {
  return {
    error: {
      code,
      message,
      retryable: extra.retryable ?? false,
      ...(extra.provider ? { provider: extra.provider } : {}),
    },
  };
}

/** Summarise schema problems in model-made input after the one repair (§14). */
export function invalidInputResult(issues: Array<{ path?: Array<string | number>; message: string }>): {
  error: { code: 'INVALID_INPUT'; message: string; retryable: boolean };
} {
  const summary = issues
    .map((issue) => {
      const where = issue.path && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${where}${issue.message}`;
    })
    .join('; ');
  return {
    error: {
      code: 'INVALID_INPUT',
      message: summary === '' ? 'The tool input did not match its schema.' : summary,
      retryable: false,
    },
  };
}

/**
 * Whether an approval that was never answered has expired into a denial (§14).
 * A card left open across a closed tab is re-rendered when the session reopens;
 * a day later it counts as denied so the turn cannot hang forever.
 */
export function approvalExpired(requestedAt: Date, now: Date = new Date()): boolean {
  const hours = (now.getTime() - requestedAt.getTime()) / 3_600_000;
  return hours >= APPROVAL_EXPIRY_HOURS;
}
