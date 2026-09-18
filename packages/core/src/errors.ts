// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import * as z from 'zod';

export const ErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'NOT_FOUND',
  'NO_PROVIDER',
  'BUDGET_EXCEEDED',
  'MODERATION_REJECTED',
  'RATE_LIMITED',
  'INSUFFICIENT_FUNDS',
  'PROVIDER_ERROR',
  'TIMEOUT',
  'CANCELLED',
  'CONFIRMATION_REQUIRED',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

const retryableDefaults: Record<ErrorCode, boolean> = {
  INVALID_INPUT: false,
  NOT_FOUND: false,
  NO_PROVIDER: false,
  BUDGET_EXCEEDED: false,
  MODERATION_REJECTED: false,
  RATE_LIMITED: true,
  INSUFFICIENT_FUNDS: false,
  PROVIDER_ERROR: true,
  TIMEOUT: true,
  CANCELLED: false,
  CONFIRMATION_REQUIRED: false,
};

export interface KilnryErrorOptions {
  retryable?: boolean;
  provider?: string;
  provider_code?: string;
  details?: unknown;
  cause?: unknown;
}

export class KilnryError extends Error {
  readonly code: ErrorCode;
  readonly options: KilnryErrorOptions;

  constructor(code: ErrorCode, message: string, options: KilnryErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'KilnryError';
    this.code = code;
    this.options = options;
  }

  toJSON(): {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    provider?: string;
    provider_code?: string;
    details?: unknown;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.options.retryable ?? retryableDefaults[this.code],
      ...(this.options.provider ? { provider: this.options.provider } : {}),
      ...(this.options.provider_code ? { provider_code: this.options.provider_code } : {}),
      ...(this.options.details === undefined ? {} : { details: this.options.details }),
    };
  }
}
