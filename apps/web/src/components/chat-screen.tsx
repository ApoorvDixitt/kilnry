'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The Chat screen (F-CHT-04, wireframes §11). A split pane: the conversation on
// the left at about forty percent, the Workspace on the right at sixty, with a
// draggable divider whose ratio is remembered. The Workspace has three tabs:
// Preview for the assets produced, Steps for the plan, and Cost for the session's
// running spend. On a narrow window the panes stack.
//
// When no language model is connected the whole screen is one card that says so
// and points at the two ways to fix it, because nothing else here can work.

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from '../lib/messages';
import { apiFetch } from '../lib/api-client';
import { attachmentKey, ChatAttachmentTray, type ChatAttachment } from './chat-attachment-tray';
import { confirmerLabel } from './jobs-table';
import {
  ApprovalCard,
  BudgetReachedCard,
  groupToolCalls,
  StepList,
  summariseArguments,
  ThinkingStep,
  ToolCallCard,
  type PlannedCall,
  type ToolCallState,
} from './message-parts';

/** The streamed parts this screen knows how to draw (TRD-11 §11). */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'step-start' }
  | { type: 'file'; url: string; mediaType: string }
  | { type: 'data-error'; code: string; message: string; retryable?: boolean; provider?: string }
  | {
      type: string;
      state?: ToolCallState;
      input?: unknown;
      output?: unknown;
      errorText?: string;
      toolName?: string;
      approval?: {
        id: string;
        reason?: string;
        requestReason?: string;
        descriptor?: { estimate_usd?: number; calls?: PlannedCall[] };
      };
    };

interface PartHandlers {
  autoApproveUsd?: number | undefined;
  onApprove: (approvalId: string, options: { autoApproveBelowUsd?: number }) => void;
  onDeny: (approvalId: string) => void;
  onEdit?: (() => void) | undefined;
  /** Runs the turn again after a failure that can be retried. */
  onRegenerate?: (() => void) | undefined;
}

// The planned calls an approval part carries, priced by the route before the SDK
// emitted the approval request and preserved as its descriptor.
function plannedCalls(part: MessagePart): PlannedCall[] {
  const approval = (
    part as {
      approval?: { descriptor?: { calls?: unknown } };
    }
  ).approval;
  const calls = approval?.descriptor?.calls;
  return Array.isArray(calls) ? (calls as PlannedCall[]) : [];
}

function plannedTotal(calls: PlannedCall[], part: MessagePart): number {
  if (calls.length > 0) return calls.reduce((sum, call) => sum + call.estimate_usd, 0);
  const approval = (
    part as {
      approval?: { descriptor?: { estimate_usd?: unknown } };
    }
  ).approval;
  const usd = approval?.descriptor?.estimate_usd;
  return typeof usd === 'number' ? usd : 0;
}

function sessionCapFrom(part: MessagePart): number | undefined {
  const reason = (part as { approval?: { requestReason?: unknown } }).approval?.requestReason;
  if (typeof reason !== 'string' || !reason.startsWith('session-budget:')) return undefined;
  const value = Number(reason.slice('session-budget:'.length));
  return Number.isFinite(value) ? value : undefined;
}

/** Draw one message's parts: text, tool cards, and approval cards. */
export function renderParts(parts: MessagePart[], handlers: PartHandlers): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const toolParts = parts.filter(
    (part) => part.type.startsWith('tool-') || part.type === 'dynamic-tool',
  ) as Array<MessagePart & { state?: ToolCallState }>;
  const groups = groupToolCalls(
    toolParts.map((part) => ({
      toolName:
        part.type === 'dynamic-tool' ? ((part as { toolName?: string }).toolName ?? '') : part.type.slice(5),
      state: part.state ?? 'input-available',
      part,
    })),
  );

  let groupIndex = 0;
  // A multi-step task (three or more planned tool calls) shows a step list at
  // the top of the message (F-CHT-08). A call awaiting approval is a checkpoint,
  // not a planned step, so it does not count toward the threshold.
  const stepItems = toolParts
    .filter((part) => part.state !== 'approval-requested')
    .map((part) => ({
      toolName:
        part.type === 'dynamic-tool' ? ((part as { toolName?: string }).toolName ?? '') : part.type.slice(5),
      summary: summariseArguments((part as { input?: unknown }).input),
      state: part.state ?? ('input-available' as ToolCallState),
    }));
  if (stepItems.length >= 3) {
    nodes.push(<StepList key="step-list" steps={stepItems} />);
  }
  for (const [index, part] of parts.entries()) {
    if (part.type === 'text') {
      nodes.push(<p key={`t-${index}`}>{(part as { text: string }).text}</p>);
      continue;
    }
    if (part.type === 'reasoning') {
      // Visible thinking (F-CHT-08): a collapsed "Thinking…" row above the text.
      const reasoning = part as { text: string; state?: string };
      nodes.push(
        <ThinkingStep key={`r-${index}`} text={reasoning.text} streaming={reasoning.state === 'streaming'} />,
      );
      continue;
    }
    if (part.type === 'step-start') {
      nodes.push(<hr key={`s-${index}`} className="chat-step-divider" />);
      continue;
    }
    if (part.type === 'file') {
      const file = part as { url: string; mediaType: string };
      nodes.push(
        <a key={`f-${index}`} className="chat-attachment-chip" href={file.url}>
          {file.mediaType}
        </a>,
      );
      continue;
    }
    if (part.type === 'data-error') {
      // One agreed outcome per failure (TRD-11 §14): the sentence says what to
      // do, and only a retryable failure offers to run the turn again.
      const failure = part as unknown as {
        code: string;
        message: string;
        retryable?: boolean;
      };
      nodes.push(
        <aside key={`e-${index}`} className="chat-error-banner" role="alert">
          <p>{failure.message}</p>
          {failure.code === 'INSUFFICIENT_FUNDS' ? (
            <a className="chat-secondary-button" href="/settings/providers">
              {message('chat.errorProviders')}
            </a>
          ) : null}
          {failure.retryable === true && handlers.onRegenerate ? (
            <button type="button" className="chat-secondary-button" onClick={handlers.onRegenerate}>
              {message('chat.errorRegenerate')}
            </button>
          ) : null}
        </aside>,
      );
      continue;
    }
    if (!part.type.startsWith('tool-') && part.type !== 'dynamic-tool') continue;

    const group = groups[groupIndex];
    // Only the first part of each group draws a card; the rest are counted in it.
    if (!group || group.head.part !== part) continue;
    groupIndex += 1;

    const toolName = group.head.toolName;
    const state = group.head.state;
    if (state === 'approval-requested') {
      const capUsd = sessionCapFrom(part);
      if (capUsd !== undefined) {
        nodes.push(<BudgetReachedCard key={`b-${index}`} capUsd={capUsd} />);
        continue;
      }
      const approvalId = (part as { approval?: { id?: string } }).approval?.id ?? '';
      const calls = plannedCalls(part);
      nodes.push(
        <ApprovalCard
          key={`a-${index}`}
          toolName={toolName}
          calls={calls}
          totalUsd={plannedTotal(calls, part)}
          {...(typeof handlers.autoApproveUsd === 'number'
            ? { autoApproveUsd: handlers.autoApproveUsd }
            : {})}
          onApprove={(options) => handlers.onApprove(approvalId, options)}
          onDeny={() => handlers.onDeny(approvalId)}
          {...(handlers.onEdit ? { onEdit: handlers.onEdit } : {})}
        />,
      );
      continue;
    }

    const withOutput = part as { input?: unknown; output?: unknown; errorText?: string };
    nodes.push(
      <ToolCallCard
        key={`c-${index}`}
        toolName={toolName}
        state={state}
        count={group.count}
        input={withOutput.input}
        {...(withOutput.output === undefined ? {} : { output: withOutput.output })}
        {...(withOutput.errorText === undefined ? {} : { errorText: withOutput.errorText })}
      />,
    );
  }
  return nodes;
}

// Remember the session threshold the approval card's checkbox sets.
async function saveSessionThreshold(sessionId: string, usd: number): Promise<void> {
  await apiFetch('/api/chat/session', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, auto_approve_below_usd: usd }),
  }).catch(() => undefined);
}

const RATIO_KEY = 'kilnry.chat.ratio';
const MIN_RATIO = 0.25;
const MAX_RATIO = 0.7;
const DEFAULT_RATIO = 0.4;

export interface ChatModelOption {
  provider: string;
  model: string;
  price_label: string;
}

export interface ChatScreenProps {
  sessionId: string;
  models: ChatModelOption[];
  defaultModel?: { provider: string; model: string };
  sessionBudgetUsd?: number;
  sessionAutonomy?: 'ask_first' | 'run_automatically';
  /** The threshold the approval card's auto-approve checkbox would set. */
  autoApproveUsd?: number;
  ollamaDetected?: boolean;
}

type WorkspaceTab = 'preview' | 'steps' | 'cost';

// The Cost tab reports provider media spend from completed Chat generation calls.
// Each tool output carries the total that was approved and who confirmed it, so
// no price is recomputed and no confirmer is guessed in the browser.
export interface ChatCostEntry {
  total_usd: number;
  confirmed_by: string;
}

export function chatGenerationEntries(messages: Array<{ parts?: unknown[] }>): ChatCostEntry[] {
  const entries: ChatCostEntry[] = [];
  for (const entry of messages) {
    for (const raw of entry.parts ?? []) {
      const part = raw as { type?: string; state?: string; output?: unknown };
      if (
        part.type !== 'tool-kilnry_generate' ||
        part.state !== 'output-available' ||
        !part.output ||
        typeof part.output !== 'object'
      ) {
        continue;
      }
      const output = part.output as {
        total_estimate_usd?: unknown;
        jobs?: Array<{ confirmed_by?: unknown }>;
      };
      if (typeof output.total_estimate_usd !== 'number') continue;
      const confirmer = output.jobs?.find((job) => typeof job.confirmed_by === 'string')?.confirmed_by;
      entries.push({
        total_usd: output.total_estimate_usd,
        confirmed_by: typeof confirmer === 'string' ? confirmer : 'auto',
      });
    }
  }
  return entries;
}

export function chatGenerationCost(messages: Array<{ parts?: unknown[] }>): number {
  const total = chatGenerationEntries(messages).reduce((sum, entry) => sum + entry.total_usd, 0);
  return Math.round(total * 100) / 100;
}

export function ChatScreen({
  sessionId,
  models,
  defaultModel,
  sessionBudgetUsd,
  sessionAutonomy = 'ask_first',
  autoApproveUsd,
  ollamaDetected = false,
}: ChatScreenProps): React.ReactNode {
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [tab, setTab] = useState<WorkspaceTab>('preview');
  const [mode, setMode] = useState<'chat' | 'agent'>('chat');
  const [selected, setSelected] = useState(
    defaultModel
      ? `${defaultModel.provider}:${defaultModel.model}`
      : models[0]
        ? `${models[0].provider}:${models[0].model}`
        : '',
  );
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [autonomy, setAutonomy] = useState(sessionAutonomy);
  const [budgetUsd, setBudgetUsd] = useState(sessionBudgetUsd ?? 5);
  const [controlError, setControlError] = useState<string>();
  const dragging = useRef(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: { session_id: sessionId },
        fetch: apiFetch,
      }),
    [sessionId],
  );
  const { messages, sendMessage, status, error, addToolApprovalResponse, regenerate } = useChat({
    id: sessionId,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const costEntries = chatGenerationEntries(messages);
  const generationCost = chatGenerationCost(messages);

  // Remember where the user put the divider.
  useEffect(() => {
    const stored = window.localStorage.getItem(RATIO_KEY);
    const parsed = stored === null ? Number.NaN : Number(stored);
    if (!Number.isNaN(parsed) && parsed >= MIN_RATIO && parsed <= MAX_RATIO) setRatio(parsed);
  }, []);

  const onDrag = useCallback((event: MouseEvent) => {
    if (!dragging.current) return;
    const next = Math.min(Math.max(event.clientX / window.innerWidth, MIN_RATIO), MAX_RATIO);
    setRatio(next);
  }, []);

  const stopDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    window.localStorage.setItem(RATIO_KEY, String(ratio));
  }, [ratio]);

  useEffect(() => {
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', stopDrag);
    return () => {
      window.removeEventListener('mousemove', onDrag);
      window.removeEventListener('mouseup', stopDrag);
    };
  }, [onDrag, stopDrag]);

  async function updateSession(patch: {
    autonomy?: 'ask_first' | 'run_automatically';
    budget_usd?: number;
  }): Promise<void> {
    setControlError(undefined);
    const response = await apiFetch('/api/chat/session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, ...patch }),
    });
    if (!response.ok) {
      setControlError(message('chat.failed'));
      return;
    }
    if (patch.autonomy) setAutonomy(patch.autonomy);
    if (typeof patch.budget_usd === 'number') setBudgetUsd(patch.budget_usd);
  }

  // No model, no chat: say what to do instead of showing an unusable screen.
  if (models.length === 0) {
    return (
      <section className="chat-empty-state">
        <h2>{message('chat.noKeyTitle')}</h2>
        <p>{message('chat.noKeyBody')}</p>
        <div className="chat-empty-actions">
          <a className="chat-primary" href="/settings/providers">
            {message('chat.noKeyProviders')}
          </a>
          <a className="chat-secondary" href="https://ollama.com" rel="noreferrer noopener" target="_blank">
            {message('chat.noKeyOllama')}
          </a>
        </div>
      </section>
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = draft.trim();
    if (text === '') return;
    setDraft('');
    // Attachments travel as ids: the agent resolves them through the Library.
    const body = {
      attachments: attachments.map((attachment) =>
        attachment.kind === 'asset' ? { asset_id: attachment.asset_id } : { handle: attachment.handle },
      ),
    };
    setAttachments([]);
    void sendMessage({ text }, { body });
  }

  const busy = status === 'submitted' || status === 'streaming';

  return (
    <div className="chat-screen" style={{ ['--chat-ratio' as string]: `${ratio}` }}>
      <header className="chat-header">
        <div className="chat-modes" role="tablist" aria-label={message('chat.title')}>
          {(['chat', 'agent'] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={mode === item}
              className={mode === item ? 'is-active' : ''}
              onClick={() => setMode(item)}
            >
              {message(item === 'chat' ? 'chat.tabChat' : 'chat.tabAgent')}
            </button>
          ))}
        </div>
        <label className="chat-model">
          <span>{message('chat.modelLabel')}</span>
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {models.map((model) => (
              <option key={`${model.provider}:${model.model}`} value={`${model.provider}:${model.model}`}>
                {model.model} · {model.price_label}
              </option>
            ))}
          </select>
        </label>
        {selected.startsWith('ollama:') ? (
          <span className="chat-offline-chip">{message('chat.offlineChip')}</span>
        ) : null}
        {ollamaDetected ? <span className="chat-ollama-chip">{message('chat.ollamaFree')}</span> : null}
        <label className="chat-session-control">
          <span>{message('chat.sessionAutonomy')}</span>
          <select
            aria-label={message('chat.sessionAutonomy')}
            value={autonomy}
            onChange={(event) =>
              void updateSession({
                autonomy: event.target.value as 'ask_first' | 'run_automatically',
              })
            }
          >
            <option value="ask_first">{message('settings.chat.autonomyAskFirst')}</option>
            <option value="run_automatically">{message('settings.chat.autonomyAutomatic')}</option>
          </select>
        </label>
        <label className="chat-session-control">
          <span>{message('chat.sessionBudgetInput')}</span>
          <input
            aria-label={message('chat.sessionBudgetInput')}
            type="number"
            min={0}
            step="0.01"
            value={budgetUsd}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 0) void updateSession({ budget_usd: value });
            }}
          />
        </label>
        <span className="chat-budget">
          {message('chat.sessionBudget')}: ${budgetUsd.toFixed(2)}
        </span>
        <a className="chat-export" href={`/api/chat/${encodeURIComponent(sessionId)}/export.md`} download>
          {message('chat.exportMarkdown')}
        </a>
        {controlError ? (
          <span className="chat-control-error" role="alert">
            {controlError}
          </span>
        ) : null}
      </header>

      <div className="chat-panes">
        <section className="chat-thread" aria-label={message('chat.threadLabel')}>
          <div className="chat-messages">
            {messages.length === 0 ? (
              <p className="chat-thread-empty">{message('chat.emptyThread')}</p>
            ) : (
              messages.map((entry) => (
                <article key={entry.id} className={`chat-message is-${entry.role}`}>
                  <h3>{message(entry.role === 'user' ? 'chat.you' : 'chat.agent')}</h3>
                  {renderParts(entry.parts as MessagePart[], {
                    autoApproveUsd,
                    onApprove: (approvalId, options) => {
                      if (typeof options.autoApproveBelowUsd === 'number') {
                        void saveSessionThreshold(sessionId, options.autoApproveBelowUsd);
                      }
                      addToolApprovalResponse({ id: approvalId, approved: true });
                    },
                    onDeny: (approvalId) => addToolApprovalResponse({ id: approvalId, approved: false }),
                    onEdit: () => {
                      setDraft(message('chat.editPlanPrompt'));
                      requestAnimationFrame(() =>
                        document.querySelector<HTMLTextAreaElement>('.chat-composer textarea')?.focus(),
                      );
                    },
                    onRegenerate: () => void regenerate(),
                  })}
                </article>
              ))
            )}
            {error ? (
              <p className="chat-error" role="alert">
                {message('chat.failed')}
              </p>
            ) : null}
          </div>
          <form className="chat-composer" onSubmit={submit}>
            <ChatAttachmentTray
              attachments={attachments}
              onAdd={(attachment) =>
                setAttachments((current) =>
                  current.some((entry) => attachmentKey(entry) === attachmentKey(attachment))
                    ? current
                    : [...current, attachment],
                )
              }
              onRemove={(key) =>
                setAttachments((current) => current.filter((entry) => attachmentKey(entry) !== key))
              }
            />
            <div className="chat-composer-row">
              <label className="chat-composer-field">
                <span className="chat-visually-hidden">{message('chat.composerPlaceholder')}</span>
                <textarea
                  rows={2}
                  value={draft}
                  placeholder={message('chat.composerPlaceholder')}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
              </label>
              <button type="submit" disabled={busy || draft.trim() === ''}>
                {message('chat.send')}
              </button>
            </div>
          </form>
        </section>

        <button
          type="button"
          className="chat-divider"
          aria-label={message('chat.resizeLabel')}
          onMouseDown={() => {
            dragging.current = true;
          }}
        />

        <section className="chat-workspace" aria-label={message('chat.workspaceLabel')}>
          <div className="chat-workspace-tabs" role="tablist" aria-label={message('chat.workspaceLabel')}>
            {(['preview', 'steps', 'cost'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                className={tab === item ? 'is-active' : ''}
                onClick={() => setTab(item)}
              >
                {message(
                  item === 'preview'
                    ? 'chat.tabPreview'
                    : item === 'steps'
                      ? 'chat.tabSteps'
                      : 'chat.tabCost',
                )}
              </button>
            ))}
          </div>
          <div className="chat-workspace-body" role="tabpanel">
            {tab === 'cost' && generationCost > 0 ? (
              <>
                {costEntries.map((entry, index) => (
                  <div className="chat-cost-row" key={`${entry.confirmed_by}-${index}`}>
                    <span>{confirmerLabel(entry.confirmed_by)}</span>
                    <span data-money="true">${entry.total_usd.toFixed(2)}</span>
                  </div>
                ))}
                <div className="chat-cost-ledger">
                  <span>{message('chat.approvalTotal')}</span>
                  <strong>${generationCost.toFixed(2)}</strong>
                </div>
              </>
            ) : (
              <p className="chat-workspace-empty">
                {message(
                  tab === 'preview'
                    ? 'chat.previewEmpty'
                    : tab === 'steps'
                      ? 'chat.stepsEmpty'
                      : 'chat.costEmpty',
                )}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
