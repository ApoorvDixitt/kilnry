// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Discovery and pricing tools (TRD-10 §3.1): kilnry_models, kilnry_estimate,
// kilnry_providers, kilnry_budget. All four are read-only; they read the model
// registry, price a request through the same engine the composer uses, report
// provider health, and report spend against caps. None of them spends money.

import * as z from 'zod';
import { budgetStatus } from '../budget/enforcer.js';
import { spendLedgerGrouped, type LedgerGroupBy } from '../budget/spend-ledger.js';
import { loadRegistry, priceSummary, providerRouteStates } from '../registry/store.js';
import { listProviders } from '../providers/service.js';
import { toolError, type KilnryTool, type ToolResult, type ToolServices } from './types.js';

function connectedNote(connected: boolean): string {
  return connected ? 'connected' : 'not connected';
}

// kilnry_models — find models and what they can do.
export const modelsTool: KilnryTool = {
  name: 'kilnry_models',
  description:
    'Find models and what they can do. List, search, or get one model, or recommend one for a capability. Returns each model with its capabilities, parameter schema, media roles, price, retention, feature support, and whether its provider is connected. Read-only; never spends.',
  inputSchema: {
    action: z.enum(['list', 'search', 'get', 'recommend']).default('list'),
    capability: z.string().optional(),
    provider: z.string().optional(),
    query: z.string().optional(),
    model: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  },
  outputSchema: {
    models: z.array(z.record(z.string(), z.unknown())),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async execute(input, services: ToolServices): Promise<ToolResult> {
    const capability = typeof input.capability === 'string' ? input.capability : undefined;
    const provider = typeof input.provider === 'string' ? input.provider : undefined;
    const query = typeof input.query === 'string' ? input.query.toLowerCase() : undefined;
    const model = typeof input.model === 'string' ? input.model : undefined;
    const limit = typeof input.limit === 'number' ? input.limit : 20;

    const [registry, providerStates] = await Promise.all([
      loadRegistry(services.db),
      providerRouteStates(services.db),
    ]);

    let rows = registry.models.filter((entry) => {
      if (capability && !(entry.capabilities as readonly string[]).includes(capability)) return false;
      if (provider && entry.provider !== provider) return false;
      if (model && entry.model_id !== model) return false;
      if (query && !`${entry.model_id} ${entry.display_name}`.toLowerCase().includes(query)) return false;
      return true;
    });
    rows = rows.slice(0, limit);

    const models = rows.map((entry) => {
      const snapshot = registry.snapshots.get(`${entry.provider}:${entry.model_id}`);
      const summary = snapshot ? priceSummary(snapshot.rule) : undefined;
      return {
        provider: entry.provider,
        model_id: entry.model_id,
        display_name: entry.display_name,
        capabilities: entry.capabilities,
        connected: providerStates[entry.provider]?.connected ?? false,
        ...(snapshot && summary
          ? { price: { unit: summary.unit, amount_usd: summary.amount, fetched_at: snapshot.fetched_at } }
          : {}),
      };
    });

    const text =
      models.length === 0
        ? 'No models match that filter.'
        : `${models.length} model(s): ${models.map((entry) => entry.display_name).join(', ')}.`;
    return { text, structuredContent: { models } };
  },
};

// kilnry_estimate — price a generation or transform before running it.
export const estimateTool: KilnryTool = {
  name: 'kilnry_estimate',
  description:
    'Price a generation or transform before running it. Give the kind, an optional model (auto by default), the prompt, parameters, media inputs, a count of one to four, and character handles. Returns the estimated cost, the chosen route, an explanation, the estimated time, and whether it would exceed a budget cap. Read-only; never spends.',
  inputSchema: {
    kind: z.string(),
    model: z.string().default('auto'),
    prompt: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    count: z.number().int().min(1).max(4).default(1),
    characters: z.array(z.string()).optional(),
  },
  outputSchema: {
    estimate_usd: z.number().optional(),
    route: z.record(z.string(), z.unknown()).optional(),
    eta_s: z.number().optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async execute(input, services: ToolServices): Promise<ToolResult> {
    if (!services.engine) {
      return toolError('NO_PROVIDER', 'Pricing is unavailable because the engine is not running.');
    }
    const kind = typeof input.kind === 'string' ? input.kind : 'image';
    const model = typeof input.model === 'string' ? input.model : 'auto';
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    const count = typeof input.count === 'number' ? input.count : 1;
    const params = (input.params as Record<string, unknown> | undefined) ?? {};
    try {
      const priced = await services.engine.estimate(
        {
          kind: kind as never,
          prompt,
          model: model === 'auto' ? undefined : model,
          params,
          medias: [],
          count,
          injections: [],
        } as never,
        {},
      );
      const usd = priced.estimate.authoritative_usd ?? priced.estimate.estimate_usd;
      return {
        text: `About $${usd.toFixed(2)} on ${priced.estimate.route.provider} ${priced.estimate.route.model} (~${priced.estimate.eta_s}s).`,
        structuredContent: {
          estimate_usd: priced.estimate.estimate_usd,
          route: priced.estimate.route,
          eta_s: priced.estimate.eta_s,
        },
      };
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : 'PROVIDER_ERROR';
      return toolError(code, error instanceof Error ? error.message : 'Could not price this request.');
    }
  },
};

// kilnry_providers — connected providers and health.
export const providersTool: KilnryTool = {
  name: 'kilnry_providers',
  description:
    'List connected providers and their health, or test one. Returns each provider with whether it is connected, its status, how many models it offers, this month spend, and any last error. Read-only; testing a provider makes a cheap round trip to it.',
  inputSchema: {
    action: z.enum(['list', 'test']).default('list'),
    provider: z.string().optional(),
  },
  outputSchema: {
    providers: z.array(z.record(z.string(), z.unknown())),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  async execute(_input, services: ToolServices): Promise<ToolResult> {
    if (!services.adapters) {
      return toolError('NO_PROVIDER', 'Provider health is unavailable because adapters are not loaded.');
    }
    const summaries = await listProviders(services.db, services.adapters);
    const providers = summaries.map((summary) => ({
      id: summary.id,
      connected: summary.connected,
      status: summary.status,
      model_count: summary.model_count,
      spend_month_usd: summary.spend_month_usd,
    }));
    const connected = providers.filter((entry) => entry.connected).length;
    return {
      text: `${connected} of ${providers.length} providers ${connectedNote(connected > 0)}.`,
      structuredContent: { providers },
    };
  },
};

// kilnry_budget — spend and caps.
export const budgetTool: KilnryTool = {
  name: 'kilnry_budget',
  description:
    'Report spend and budget caps. Returns the daily, monthly, and session caps with the auto-approve threshold, plus how much has been spent in each period. Read-only; never spends.',
  inputSchema: {
    action: z.enum(['status', 'ledger']).default('status'),
    period: z.enum(['today', 'month', 'session']).optional(),
    group_by: z.enum(['provider', 'model', 'folder', 'character', 'day']).optional(),
  },
  outputSchema: {
    caps: z.array(z.record(z.string(), z.unknown())),
    ledger: z.array(z.record(z.string(), z.unknown())).optional(),
  },
  annotations: { readOnlyHint: true },
  async execute(input, services: ToolServices): Promise<ToolResult> {
    if (input.action === 'ledger') {
      const now = new Date();
      const from =
        input.period === 'month'
          ? new Date(now.getFullYear(), now.getMonth(), 1)
          : new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const groupBy = (input.group_by as LedgerGroupBy | undefined) ?? 'provider';
      const groups = await spendLedgerGrouped(services.db, { from, to: now, group_by: groupBy });
      const total = groups.reduce((sum, group) => sum + group.actual_usd, 0);
      const text =
        groups.length === 0
          ? 'No spend recorded for that period.'
          : `$${total.toFixed(2)} across ${groups.length} ${groupBy}(s): ${groups
              .slice(0, 5)
              .map((group) => `${group.key} $${group.actual_usd.toFixed(2)}`)
              .join(', ')}.`;
      return { text, structuredContent: { caps: [], ledger: groups } };
    }
    const lines = await budgetStatus(services.db.db);
    const caps = lines.map((line) => ({
      scope: line.scope,
      cap_usd: line.cap_usd,
      spent_usd: line.spent_usd,
      behavior: line.behavior,
    }));
    const text =
      caps.length === 0
        ? 'No budget caps are set.'
        : caps
            .map((cap) => `${cap.scope}: $${cap.spent_usd.toFixed(2)} of $${cap.cap_usd.toFixed(2)}`)
            .join('; ') + '.';
    return { text, structuredContent: { caps } };
  },
};

// The discovery and pricing group in TRD-10 §3.1 order.
export const DISCOVERY_TOOLS: KilnryTool[] = [modelsTool, estimateTool, providersTool, budgetTool];
