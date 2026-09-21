// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it } from 'vitest';
import {
  APPROVAL_EXPIRY_HOURS,
  approvalExpired,
  invalidInputResult,
  llmErrorPart,
  MAX_RETRY_AFTER_S,
  retryingStatusText,
  stepCapReachedText,
  toolErrorResult,
} from './errors.js';

describe('language model failures (TRD-11 §14)', () => {
  it('an empty balance names the account and is not retried', () => {
    const part = llmErrorPart({ status: 402, provider: 'openrouter' });
    expect(part).toEqual({
      type: 'data-error',
      code: 'INSUFFICIENT_FUNDS',
      provider: 'openrouter',
      message: 'Your OpenRouter balance is empty. Top up or switch model.',
      retryable: false,
    });
  });

  it('a busy provider is retried once within the wait ceiling', () => {
    const part = llmErrorPart({ status: 429, provider: 'anthropic', retry_after_s: 8 });
    expect(part.code).toBe('RATE_LIMITED');
    expect(part.retry_once).toBe(true);
    expect(part.retry_after_s).toBe(8);
    expect(part.message).toContain('Anthropic is busy');
  });

  it('caps the wait a provider can ask for', () => {
    expect(llmErrorPart({ status: 429, retry_after_s: 600 }).retry_after_s).toBe(MAX_RETRY_AFTER_S);
  });

  it('a moderated message is kept so the user can edit it', () => {
    const part = llmErrorPart({ status: 403, provider: 'openrouter' });
    expect(part.code).toBe('MODERATION_REJECTED');
    expect(part.keep_message).toBe(true);
    expect(part.retryable).toBe(false);
    expect(part.message).toBe('OpenRouter refused that message. Edit it and send it again.');
  });

  it('a stream that drops part-way keeps what arrived and offers to regenerate', () => {
    const part = llmErrorPart({ provider: 'openai', mid_stream: true });
    expect(part.code).toBe('PROVIDER_ERROR');
    expect(part.retryable).toBe(true);
    expect(part.message).toContain('What arrived is kept');
  });

  it('names the provider generically when it is unknown', () => {
    expect(llmErrorPart({ status: 402 }).message).toBe(
      'Your the provider balance is empty. Top up or switch model.',
    );
  });

  it('shows a status line while the retry is waiting', () => {
    expect(retryingStatusText()).toBe('Provider busy, retrying…');
  });
});

describe('loop and tool failures (TRD-11 §14)', () => {
  it('ends on a sentence when the step cap is reached', () => {
    expect(stepCapReachedText(12)).toBe("I stopped after 12 steps. Say 'continue' to go on.");
  });

  it('reports a tool failure as a value the model can answer', () => {
    const result = toolErrorResult('BUDGET_EXCEEDED', "Today's cap is reached.", { provider: 'fal' });
    expect(result.error).toEqual({
      code: 'BUDGET_EXCEEDED',
      message: "Today's cap is reached.",
      retryable: false,
      provider: 'fal',
    });
  });

  it('summarises the schema problems in model-made input', () => {
    const result = invalidInputResult([
      { path: ['requests', 0, 'kind'], message: 'Required' },
      { message: 'Unrecognised key' },
    ]);
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.message).toBe('requests.0.kind: Required; Unrecognised key');
  });

  it('falls back to a plain sentence when there are no issues to list', () => {
    expect(invalidInputResult([]).error.message).toBe('The tool input did not match its schema.');
  });
});

describe('unanswered approvals (TRD-11 §14)', () => {
  it('counts an approval as denied a day after it was asked', () => {
    const asked = new Date('2026-09-20T10:00:00Z');
    expect(approvalExpired(asked, new Date('2026-09-20T22:00:00Z'))).toBe(false);
    expect(approvalExpired(asked, new Date('2026-09-21T10:00:00Z'))).toBe(true);
    expect(APPROVAL_EXPIRY_HOURS).toBe(24);
  });
});
