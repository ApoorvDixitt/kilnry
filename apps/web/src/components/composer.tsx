'use client';

// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from '../lib/messages';
import { ModelPicker, type ComposerMode, type PickerModel } from './model-picker';
import { ParamChips, type ComposerParams, type ParamsSchema } from './param-chips';
import { CostStrip, type BudgetLine, type CostEstimate } from './cost-strip';

const MODES: ComposerMode[] = ['image', 'video', 'audio', 'workflow'];

const MODE_LABEL: Record<ComposerMode, string> = {
  image: 'create.modeImage',
  video: 'create.modeVideo',
  audio: 'create.modeAudio',
  workflow: 'create.modeWorkflow',
};

const MODE_CAPABILITIES: Record<ComposerMode, string[]> = {
  image: ['text2image', 'image_edit'],
  video: ['text2video', 'image2video', 'reference2video', 'video2video'],
  audio: ['tts', 'voice_clone', 'music', 'sfx'],
  workflow: [],
};

export interface GenerateContext {
  hasAnyKey: boolean;
  promptEmpty: boolean;
  hasModelForMode: boolean;
  estimate: CostEstimate | null;
  overBudget: boolean;
}

// The single source of truth for whether Generate may fire and, if not, the exact
// reason shown in its tooltip. Kept pure so every disabled case is testable.
export function generateState(context: GenerateContext): { disabled: boolean; reason: string | null } {
  if (!context.hasAnyKey) return { disabled: true, reason: message('create.generateDisabledReason.noKey') };
  if (!context.hasModelForMode)
    return { disabled: true, reason: message('create.generateDisabledReason.noModel') };
  if (context.promptEmpty) return { disabled: true, reason: message('create.generateDisabledReason.empty') };
  if (!context.estimate) return { disabled: true, reason: message('create.generateDisabledReason.unpriced') };
  if (context.overBudget) return { disabled: true, reason: message('create.generateDisabledReason.budget') };
  return { disabled: false, reason: null };
}

export function ModeSegment({
  mode,
  onChange,
}: {
  mode: ComposerMode;
  onChange: (mode: ComposerMode) => void;
}): React.ReactNode {
  return (
    <div className="mode-segment" role="tablist" aria-label={message('create.title')}>
      {MODES.map((option) => {
        const disabled = option === 'workflow';
        return (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={mode === option}
            className={mode === option ? 'is-on' : ''}
            disabled={disabled}
            title={disabled ? message('create.workflowLater') : undefined}
            onClick={() => onChange(option)}
          >
            {message(MODE_LABEL[option])}
          </button>
        );
      })}
    </div>
  );
}

function modelsForMode(models: PickerModel[], mode: ComposerMode): PickerModel[] {
  const capabilities = new Set(MODE_CAPABILITIES[mode]);
  return models.filter(
    (model) =>
      !model.deprecated_at &&
      !model.tags.includes('hidden_expensive_route') &&
      model.capabilities.some((capability) => capabilities.has(capability)),
  );
}

export function Composer({
  models,
  budgets = [],
  estimate = null,
  now = Date.now(),
  onGenerate,
  onStateChange,
  seed,
}: {
  models: PickerModel[];
  budgets?: BudgetLine[];
  estimate?: CostEstimate | null;
  now?: number;
  onGenerate?: (payload: {
    mode: ComposerMode;
    prompt: string;
    model: string;
    params: ComposerParams;
  }) => void;
  onStateChange?: (state: {
    mode: ComposerMode;
    prompt: string;
    model: string;
    params: ComposerParams;
    ready: boolean;
  }) => void;
  seed?: { token: number; prompt: string } | undefined;
}): React.ReactNode {
  const [mode, setMode] = useState<ComposerMode>('image');
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<string | 'auto'>('auto');
  const [params, setParams] = useState<ComposerParams>({ count: 1 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // When a result tile asks to reuse its prompt, the page bumps the seed token
  // and the composer adopts that prompt text once per new token.
  const appliedSeed = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (seed && seed.token !== appliedSeed.current) {
      appliedSeed.current = seed.token;
      setPrompt(seed.prompt);
    }
  }, [seed]);

  const available = useMemo(() => modelsForMode(models, mode), [models, mode]);
  const hasAnyKey = models.some((model) => model.connected);
  const hasModelForMode = available.some((model) => model.connected);

  const activeSchema: ParamsSchema = useMemo(() => buildAutoSchema(mode), [mode]);

  const overBudget = useMemo(() => {
    if (!estimate) return false;
    const amount = estimate.authoritative_usd ?? estimate.estimate_usd;
    return budgets.some((line) => line.spent_usd + amount > line.cap_usd + 1e-9);
  }, [estimate, budgets]);

  const state = generateState({
    hasAnyKey,
    promptEmpty: prompt.trim().length === 0,
    hasModelForMode,
    estimate,
    overBudget,
  });

  // Switching mode keeps the prompt text; only the footer controls change.
  const switchMode = useCallback((next: ComposerMode) => {
    if (next === 'workflow') return;
    setMode(next);
    setSelectedModel('auto');
    setParams({ count: 1 });
  }, []);

  // Let the page re-price whenever an input that affects the estimate changes.
  useEffect(() => {
    onStateChange?.({
      mode,
      prompt,
      model: selectedModel,
      params,
      ready: hasAnyKey && hasModelForMode && prompt.trim().length > 0 && mode !== 'workflow',
    });
  }, [mode, prompt, selectedModel, params, hasAnyKey, hasModelForMode, onStateChange]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        switchMode(MODES[Number(event.key) - 1] ?? 'image');
        return;
      }
      const editing =
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLInputElement;
      if (!editing && event.key === '/') {
        event.preventDefault();
        textareaRef.current?.focus();
      }
      if (!editing && (event.key === 'm' || event.key === 'M')) {
        event.preventDefault();
        setPickerOpen((prior) => !prior);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [switchMode]);

  const modelChipLabel =
    selectedModel === 'auto'
      ? message('create.picker.auto')
      : (available.find((m) => m.model_id === selectedModel)?.display_name ?? selectedModel);

  function fire(): void {
    if (state.disabled) return;
    onGenerate?.({ mode, prompt, model: selectedModel, params });
  }

  return (
    <section className="composer" aria-label={message('create.title')}>
      <ModeSegment mode={mode} onChange={switchMode} />
      <textarea
        ref={textareaRef}
        className="composer-prompt"
        value={prompt}
        placeholder={message('create.composerPlaceholder')}
        aria-label={message('create.composerPlaceholder')}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            fire();
          }
        }}
      />
      <div className="composer-footer">
        <div className="composer-model">
          <button
            type="button"
            className="model-chip"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((prior) => !prior)}
          >
            {modelChipLabel}
          </button>
          {pickerOpen ? (
            <div className="composer-picker-anchor">
              <ModelPicker
                mode={mode}
                models={models}
                selectedId={selectedModel}
                autoWhy={estimate?.breakdown[0]?.label ?? message('create.picker.auto')}
                now={now}
                onSelect={(id) => {
                  setSelectedModel(id);
                  setPickerOpen(false);
                }}
              />
            </div>
          ) : null}
        </div>
        <ParamChips schema={activeSchema} params={params} onChange={setParams} />
        <span className="composer-spacer" />
        <CostStrip
          estimate={estimate}
          params={{ count: params.count, duration_s: params.duration_s }}
          promptChars={prompt.trim().length}
          budgets={budgets}
          now={now}
        />
        <button
          type="button"
          className={`generate-button${state.disabled ? ' is-disabled' : ''}`}
          disabled={state.disabled}
          title={state.reason ?? undefined}
          onClick={fire}
        >
          {mode === 'workflow' ? message('create.plan') : message('create.generate')}
        </button>
      </div>
    </section>
  );
}

// Until a specific model is chosen, the chips offer a sensible per-mode default
// set; once a model is picked the composer will read that model's own schema.
function buildAutoSchema(mode: ComposerMode): ParamsSchema {
  if (mode === 'video') {
    return {
      properties: {
        aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
        resolution: { type: 'string', enum: ['720p', '1080p'] },
        duration_s: { type: 'number', enum: [4, 6, 8] },
        audio: { type: 'boolean' },
      },
    };
  }
  if (mode === 'audio') {
    return { properties: {} };
  }
  return {
    properties: {
      aspect_ratio: { type: 'string', enum: ['1:1', '4:3', '3:4', '16:9', '9:16'] },
      resolution: { type: 'string', enum: ['1K', '2K'] },
    },
  };
}
