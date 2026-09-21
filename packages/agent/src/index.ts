// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

export {};

export {
  assembleInstructions,
  buildSkillsIndex,
  renderPrompt,
  skillSystemMessage,
  applyLoadedSkill,
  touchLoadedSkill,
  promptsRootFrom,
  BLOCK_BUDGETS,
  MAX_LOADED_SKILLS,
  type Autonomy,
  type PromptVars,
  type AssembleInput,
  type AssembledInstructions,
  type SkillIndexEntry,
  type LoadedSkill,
} from './instructions.js';

export {
  resolveModel,
  llmPrice,
  llmCaps,
  formatLlmPrice,
  defaultLlmRef,
  listChatModels,
  tokensToUsd,
  ModelResolutionError,
  DEFAULT_LLM,
  OLLAMA_TOOL_MODELS,
  type LlmProvider,
  type LlmRef,
  type LlmPrice,
  type LlmCaps,
  type ResolvedLlm,
  type LlmRegistryRow,
} from './model.js';

export {
  registerChatTools,
  chatToolNames,
  compactForModel,
  MODEL_OUTPUT_BUDGET,
  type ChatToolContext,
} from './tools.js';

export {
  streamChatTurn,
  turnInstructions,
  MAX_STEPS,
  MAX_STEPS_SMALL_CONTEXT,
  type ChatSessionState,
  type ChatTurnInput,
} from './chat.js';

export {
  approvalPolicy,
  alwaysAsk,
  isSpendingAction,
  cachedPreEstimate,
  withConfirmedCost,
  deniedResult,
  AUTO_APPROVE_BELOW_USD_DEFAULT,
  SPEND_TOOLS,
  type ApprovalSession,
  type ApprovalPolicyInput,
  type ApprovalVerdict,
  type PreEstimate,
} from './approval.js';

export {
  meterStep,
  wouldExceedSessionBudget,
  sessionBudgetReachedText,
  headerMeter,
  type StepUsage,
  type MeterInput,
  type MeteredStep,
  type LedgerWriter,
  type SpendRecorder,
} from './metering.js';

export {
  enginePreEstimate,
  pendingRequests,
  type EngineEstimate,
  type EngineEstimator,
  type PlannedCall,
  type ChatPreEstimate,
} from './pre-estimate.js';
