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
  defaultLlmRef,
  enginePreEstimate,
  meterStep,
  registerChatTools,
  resolveModel,
  streamChatTurn,
  toFileParts,
  toolSpendUsd,
  trackApprovals,
  type LlmProvider,
  type LlmRef,
  type LlmRegistryRow,
} from '@kilnry/agent';
import { loadConfig, loadRegistry } from '@kilnry/core';
import { assets as assetsTable, chatMessages, chatSessions, settings, spendLedger } from '@kilnry/db';
import { adapters, detectOllama } from '@kilnry/providers';
import { promptLibraryRoot } from '@kilnry/skills';
import { validateUIMessages } from 'ai';
import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import * as z from 'zod';
import { errorResponse, requireSession } from '../../../server/http';
import { presetServices } from '../../../server/presets';
import { ensureRuntimeEngine, runtimeServices } from '../../../server/runtime';
import { projectMemoryBody } from '../../../server/project-memory';
import { firstMessageText } from '../../../server/chat-transcript';
import { skillRoots } from '../../../server/skills';
import { chatSessionDefaults, sessionRowDefaults } from '../../../server/chat-session';
import { networkOnline } from '../../../server/network';

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
    // Validate the chat transport payload against the AI SDK UI-message schema at
    // the boundary, so a malformed or hostile message array is rejected before it
    // reaches the agent rather than being cast through unchecked (F-CHT-01).
    const messages = await validateUIMessages({ messages: input.messages });
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

    // The approval policy prices a pending call with the same engine estimate the
    // tool will use, so the number on the card is the number that gets confirmed.
    const estimatePending = engine
      ? enginePreEstimate((canonical, constraints) =>
          engine.estimate(canonical as never, constraints as never),
        )
      : async () => ({ estimate_usd: 0, calls: [] });
    const planned = new Map<string, Awaited<ReturnType<typeof estimatePending>>>();
    const planKey = (name: string, value: Record<string, unknown>): string =>
      `${name}:${JSON.stringify(value)}`;
    const preEstimate = cachedPreEstimate(async (name, value) => {
      const plan = await estimatePending(name, value);
      planned.set(planKey(name, value), plan);
      return plan;
    });
    // One live object: the policy reads spent_usd when it decides, and every
    // spend this turn (a tool's confirmed estimate, the language model's
    // tokens) is added to it as it happens, so a later call in the same turn
    // sees the earlier ones (F-104).
    const policySession = {
      autonomy: session.autonomy,
      spent_usd: session.spent_usd,
      ...(typeof session.budget_usd === 'number' ? { budget_usd: session.budget_usd } : {}),
      ...(typeof session.auto_approve_below_usd === 'number'
        ? { auto_approve_below_usd: session.auto_approve_below_usd }
        : {}),
    };
    const addSessionSpend = async (delta: number): Promise<void> => {
      if (!(delta > 0)) return;
      policySession.spent_usd += delta;
      await services.database.db
        .update(chatSessions)
        .set({ spentUsd: sql`spent_usd + ${String(delta)}`, updatedAt: new Date() })
        .where(eq(chatSessions.id, session.id));
    };
    // The spend writes a tool result starts; the turn waits for them before it
    // persists its messages, so the next turn reads the new total.
    const pendingSpends: Array<Promise<void>> = [];
    const toolApproval = approvalPolicy({ session: policySession, preEstimate });
    // Remember which calls the card answered and which the policy let through,
    // so each job records who confirmed it (TRD-04's confirmed_by).
    const approvals = trackApprovals(toolApproval);

    // The observed network state, read the way every route reads it (F-117):
    // the in-process flag is not shared between Next's per-route module
    // instances, so the persisted transition is the answer.
    const online = await networkOnline(services.database);

    const tools = registerChatTools({
      services: {
        db: services.database,
        scope: 'full',
        adapters,
        // Chat's approval policy has already stopped any call that needs the
        // user's answer. Once the SDK executes it, the shared tool must not ask
        // for a second confirmation of the same price.
        autoApproveBelowUsd: Number.POSITIVE_INFINITY,
        jobSource: 'chat',
        confirmedBy: (name, value) => approvals.confirmerFor(name, value),
        assetUrl: (assetId: string) => `http://127.0.0.1:${config.port}/api/media/${assetId}`,
        ...(engine ? { engine } : {}),
        ...(config.library_root ? { libraryRoot: config.library_root } : {}),
        ...(openrouterKey ? { openrouterKey } : {}),
        skillsRoots: await skillRoots(services.database),
        presets: await presetServices(services.database),
      },
      chatSessionId: session.id,
      // One offline signal for the whole turn (F40, D-70): the observed network
      // state. It was `llm.local === true` here and `isNetworkOnline()` for the
      // prompt, so the two disagreed in both directions — a local model with the
      // network up lost the cloud spend tools, and a cloud model with the
      // network down kept them and called providers that could not answer
      // (F-39).
      offline: !online,
      // A spend tool that proceeded adds its confirmed estimate (or settled
      // actual) to the session, so Run automatically's session budget counts
      // the generations it pays for, not only the tokens (F-104, PRD-14:173).
      onToolResult: (event) => {
        pendingSpends.push(addSessionSpend(toolSpendUsd(event.name, event.structured)));
      },
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
      messages,
      llm,
      // Offline mode is keyed on the observed network state, not on the model
      // being local (F40). A local model stays fully capable while online; any
      // model drops its spend tools while the network is down.
      online,
      promptsRoot: promptLibraryRoot(),
      ...(session.folder && config.library_root
        ? { memoryBody: await projectMemoryBody(config.library_root, session.folder) }
        : {}),
      tools,
      toolApproval: approvals.policy,
      approvalDescriptor: (name, value) => planned.get(planKey(name, value)),
      ...(attached.parts.length > 0 ? { attachmentParts: attached.parts } : {}),
      generateMessageId: () => randomUUID(),
      onMessages: async (turnMessages) => {
        await Promise.all(pendingSpends);
        // Persist the thread so the session survives a reload and can be exported
        // (F-CHT-12). Each UIMessage is stored with its parts as-is, upserted by
        // id so a regenerated message replaces its row.
        for (const turnMessage of turnMessages) {
          const parts = (turnMessage as { parts?: unknown[] }).parts ?? [];
          await services.database.db
            .insert(chatMessages)
            .values({ id: turnMessage.id, sessionId: session.id, role: turnMessage.role, parts })
            .onConflictDoUpdate({ target: chatMessages.id, set: { parts } });
        }
        // Title the session from its first user message the first time.
        if (!session.title) {
          const firstUser = turnMessages.find((entry) => entry.role === 'user');
          const text = firstUser ? firstMessageText(firstUser) : '';
          if (text !== '') {
            await services.database.db
              .update(chatSessions)
              .set({ title: text.slice(0, 80), updatedAt: new Date() })
              .where(eq(chatSessions.id, session.id));
          }
        }
      },
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
            recordSpend: async (_sessionId, delta) => {
              await addSessionSpend(delta);
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
  title?: string;
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
      ...(row.title ? { title: row.title } : {}),
      autonomy: row.autonomy === 'run_automatically' ? 'run_automatically' : 'ask_first',
      ...(row.budgetUsd ? { budget_usd: Number(row.budgetUsd) } : {}),
      spent_usd: Number(row.spentUsd ?? '0'),
      ...(row.autoApproveBelowUsd ? { auto_approve_below_usd: Number(row.autoApproveBelowUsd) } : {}),
    };
  }
  // A new session always carries a numeric budget and threshold, from
  // Settings › Chat or the canon defaults (F-104).
  const defaults = await chatSessionDefaults(services.database);
  await services.database.db
    .insert(chatSessions)
    .values({ id, ...sessionRowDefaults(defaults) })
    .onConflictDoNothing({ target: chatSessions.id });
  return {
    id,
    autonomy: defaults.autonomy,
    spent_usd: 0,
    budget_usd: defaults.budget_usd,
    auto_approve_below_usd: defaults.auto_approve_below_usd,
  };
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
  // Neither the session nor the workspace names a model, which is the state of
  // every fresh install: the first Chat message failed with NO_PROVIDER and told
  // the user to connect a key they had already connected (F-13). PRD-16 §5 and
  // TRD-11 §2 name the default — OpenRouter's Claude Sonnet when an OpenRouter
  // key exists, else the first connected direct provider, else a local Ollama
  // model — and Settings › Chat already shows exactly that as a fallback it never
  // persisted. It is chosen here and written to chat.default_llm, so the
  // selection the user is shown is the selection that runs (A.4).
  const fallback = defaultLlmRef({
    connected: await connectedLlmProviders(services),
    ollamaModels: await localToolModels(services),
  });
  if (!fallback) return undefined;
  await services.database.db
    .insert(settings)
    .values({ key: 'chat.default_llm', value: fallback })
    .onConflictDoNothing({ target: settings.key });
  return fallback;
}

const LLM_KEY_PROVIDERS = ['openrouter', 'anthropic', 'openai', 'google'] as const;

async function connectedLlmProviders(
  services: Awaited<ReturnType<typeof runtimeServices>>,
): Promise<LlmProvider[]> {
  const connected: LlmProvider[] = [];
  for (const provider of LLM_KEY_PROVIDERS) {
    // anthropic is a chat-only provider id, outside the media adapter union the
    // key store is typed with (the settings route reads it the same way).
    const key = await services.keyStore.get(provider as never).catch(() => undefined);
    if (key) connected.push(provider);
  }
  return connected;
}

async function localToolModels(services: Awaited<ReturnType<typeof runtimeServices>>): Promise<string[]> {
  const base = await readSetting(services, 'chat.ollama_base_url');
  const detected = await detectOllama(typeof base === 'string' && base ? { base_url: base } : {});
  return detected.models.filter((model) => model.tools).map((model) => model.name);
}

async function readSetting(
  services: Awaited<ReturnType<typeof runtimeServices>>,
  key: string,
): Promise<unknown> {
  const rows = await services.database.db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value;
}
