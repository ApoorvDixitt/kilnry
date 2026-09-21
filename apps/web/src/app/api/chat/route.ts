// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// One chat turn (F-CHT-04, TRD-11 §1). The handler loads the session, resolves
// the language model the user chose, registers the twenty Kilnry tools, applies
// the approval policy for the session's autonomy mode, meters each step's token
// cost into the spend ledger, and streams the reply back as message parts.
//
// Every spend still goes through the same estimate, budget and audit path the
// composer uses: this route adds no shortcut of its own.

import { randomUUID } from 'node:crypto';
import {
  approvalPolicy,
  cachedPreEstimate,
  enginePreEstimate,
  meterStep,
  registerChatTools,
  resolveModel,
  streamChatTurn,
  toFileParts,
  type LlmProvider,
  type LlmRef,
  type LlmRegistryRow,
} from '@kilnry/agent';
import { loadConfig, loadRegistry } from '@kilnry/core';
import { assets as assetsTable, chatSessions, settings, spendLedger } from '@kilnry/db';
import { adapters, detectOllama } from '@kilnry/providers';
import { bundledSkillsRoot, promptLibraryRoot } from '@kilnry/skills';
import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../server/http';
import { ensureRuntimeEngine, runtimeServices } from '../../../server/runtime';

export const maxDuration = 300;

const Input = z.object({
  session_id: z.string().min(1),
  messages: z.array(z.unknown()),
  trigger: z.string().optional(),
  attachments: z
    .array(z.union([z.object({ asset_id: z.string() }), z.object({ handle: z.string() })]))
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession();
    const input = Input.parse(await request.json());
    const services = await runtimeServices();
    const config = loadConfig();
    const engine = await ensureRuntimeEngine().catch(() => undefined);
    const openrouterKey = await services.keyStore.get('openrouter').catch(() => undefined);

    const session = await loadOrCreateSession(services, input.session_id);

    const registry = await loadRegistry(services.database);
    const rows: LlmRegistryRow[] = registry.models.map((model) => ({
      provider: model.provider,
      model_id: model.model_id,
      capabilities: model.capabilities,
      price_rule: model.price_rule as LlmRegistryRow['price_rule'],
    }));

    const ref = await sessionModel(services, session);
    if (!ref) {
      return NextResponse.json(
        {
          error: {
            code: 'NO_PROVIDER',
            message:
              'Chat needs a language model. Connect an OpenRouter, Anthropic, OpenAI, or Google key in Settings › Providers, or run Ollama locally.',
            retryable: false,
          },
        },
        { status: 400 },
      );
    }

    const llm = await resolveModel({
      ref,
      rows,
      getKey: async (provider) => services.keyStore.get(provider as never).catch(() => undefined),
      ollamaShow: async (baseUrl, model) => {
        const detection = await detectOllama({ base_url: baseUrl });
        const found = detection.models.find((entry) => entry.name === model);
        if (!found) return undefined;
        return {
          capabilities: [...(found.tools ? ['tools'] : []), ...(found.vision ? ['vision'] : [])],
          ...(found.context_length ? { num_ctx: found.context_length } : {}),
        };
      },
    });

    const tools = registerChatTools({
      services: {
        db: services.database,
        scope: 'full',
        adapters,
        assetUrl: (assetId: string) => `http://127.0.0.1:${config.port}/api/media/${assetId}`,
        ...(engine ? { engine } : {}),
        ...(config.library_root ? { libraryRoot: config.library_root } : {}),
        ...(openrouterKey ? { openrouterKey } : {}),
        skillsRoots: { bundled: bundledSkillsRoot() },
      },
      chatSessionId: session.id,
    });

    // The approval policy prices a pending call with the same engine estimate the
    // tool will use, so the number on the card is the number that gets confirmed.
    const preEstimate = cachedPreEstimate(
      engine
        ? enginePreEstimate((canonical, constraints) =>
            engine.estimate(canonical as never, constraints as never),
          )
        : async () => ({ estimate_usd: 0 }),
    );
    const toolApproval = approvalPolicy({
      session: {
        autonomy: session.autonomy,
        spent_usd: session.spent_usd,
        ...(typeof session.budget_usd === 'number' ? { budget_usd: session.budget_usd } : {}),
        ...(typeof session.auto_approve_below_usd === 'number'
          ? { auto_approve_below_usd: session.auto_approve_below_usd }
          : {}),
      },
      preEstimate,
    });

    // Attachments arrive as ids; the agent reads them through the Library and,
    // when the model cannot see a file, analyses it first (TRD-11 §8).
    const attached = await toFileParts({
      attachments: input.attachments ?? [],
      caps: { vision: llm.caps.vision, local: llm.local },
      getAsset: async (assetId) => {
        const rows = await services.database.db
          .select()
          .from(assetsTable)
          .where(eq(assetsTable.id, assetId))
          .limit(1);
        const row = rows[0];
        if (!row) return undefined;
        return {
          id: row.id,
          path: row.path,
          kind: (row.kind ?? 'other') as 'image' | 'video' | 'audio' | 'other',
          mime: row.mime ?? 'application/octet-stream',
        };
      },
      assetUrl: (assetId) => `http://127.0.0.1:${config.port}/api/media/${assetId}`,
    });

    return streamChatTurn({
      session,
      messages: input.messages as never,
      llm,
      promptsRoot: promptLibraryRoot(),
      tools,
      toolApproval,
      ...(attached.parts.length > 0 ? { attachmentParts: attached.parts } : {}),
      generateMessageId: () => randomUUID(),
      onStepEnd: async ({ usage }) => {
        await meterStep(
          {
            session: {
              id: session.id,
              ...(session.folder ? { folder: session.folder } : {}),
              ...(typeof session.budget_usd === 'number' ? { budget_usd: session.budget_usd } : {}),
              spent_usd: session.spent_usd,
            },
            llm: { ref: llm.ref, price: llm.price },
            writeLedger: async (entry) => {
              await services.database.db.insert(spendLedger).values({
                id: randomUUID(),
                providerId: entry.provider_id,
                modelId: entry.model_id,
                folder: entry.folder ?? null,
                kind: entry.kind,
                estimateUsd: String(entry.estimate_usd),
                actualUsd: String(entry.actual_usd),
                currencyNote: entry.currency_note,
              });
            },
            recordSpend: async (sessionId, delta) => {
              await services.database.db
                .update(chatSessions)
                .set({ spentUsd: sql`spent_usd + ${String(delta)}`, updatedAt: new Date() })
                .where(eq(chatSessions.id, sessionId));
            },
          },
          usage as never,
        );
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

interface LoadedSession {
  id: string;
  folder?: string;
  autonomy: 'ask_first' | 'run_automatically';
  budget_usd?: number;
  spent_usd: number;
  auto_approve_below_usd?: number;
}

async function loadOrCreateSession(
  services: Awaited<ReturnType<typeof runtimeServices>>,
  id: string,
): Promise<LoadedSession> {
  const rows = await services.database.db.select().from(chatSessions).where(eq(chatSessions.id, id)).limit(1);
  const row = rows[0];
  if (row) {
    return {
      id: row.id,
      ...(row.folder ? { folder: row.folder } : {}),
      autonomy: row.autonomy === 'run_automatically' ? 'run_automatically' : 'ask_first',
      ...(row.budgetUsd ? { budget_usd: Number(row.budgetUsd) } : {}),
      spent_usd: Number(row.spentUsd ?? '0'),
      ...(row.autoApproveBelowUsd ? { auto_approve_below_usd: Number(row.autoApproveBelowUsd) } : {}),
    };
  }
  const stored = await readSetting(services, 'chat.autonomy');
  const budget = await readSetting(services, 'chat.session_budget_usd');
  const autonomy = stored === 'run_automatically' ? 'run_automatically' : 'ask_first';
  await services.database.db.insert(chatSessions).values({
    id,
    autonomy,
    ...(typeof budget === 'number' ? { budgetUsd: String(budget) } : {}),
  });
  return { id, autonomy, spent_usd: 0, ...(typeof budget === 'number' ? { budget_usd: budget } : {}) };
}

// The session's model, or the saved default when the session has none.
async function sessionModel(
  services: Awaited<ReturnType<typeof runtimeServices>>,
  session: LoadedSession,
): Promise<LlmRef | undefined> {
  const rows = await services.database.db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, session.id))
    .limit(1);
  const row = rows[0];
  if (row?.llmProvider && row.llmModel) {
    return { provider: row.llmProvider as LlmProvider, model: row.llmModel };
  }
  const stored = await readSetting(services, 'chat.default_llm');
  if (stored && typeof stored === 'object' && 'provider' in stored && 'model' in stored) {
    const value = stored as { provider: string; model: string };
    return { provider: value.provider as LlmProvider, model: value.model };
  }
  return undefined;
}

async function readSetting(
  services: Awaited<ReturnType<typeof runtimeServices>>,
  key: string,
): Promise<unknown> {
  const rows = await services.database.db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value;
}
