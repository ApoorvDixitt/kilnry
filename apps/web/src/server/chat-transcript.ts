// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Chat sessions and transcript export (F-CHT-12, TRD-11 §12). A session is a
// row with its messages; the transcript renders those messages to Markdown so a
// thread can be saved into the Project folder and read anywhere: text parts as
// prose, tool calls as blockquote lines with the job id and cost, approvals as
// the decision, and attachments and outputs as their Library paths. It is pure
// text — no bytes — so it stays small and legible.

interface MessageLike {
  role: string;
  parts: unknown[];
}

/** The first text a message carries, for titling a session. */
export function firstMessageText(message: { parts?: unknown[] }): string {
  for (const part of message.parts ?? []) {
    const record = part as { type?: string; text?: string };
    if (record.type === 'text' && typeof record.text === 'string' && record.text.trim() !== '') {
      return record.text.trim();
    }
  }
  return '';
}

function money(usd: unknown): string {
  return typeof usd === 'number' ? `$${usd.toFixed(2)}` : '';
}

// One tool part rendered as a blockquote line: the tool, a one-line summary of
// what it did, and any job id, output paths and cost it reported.
function renderToolPart(type: string, part: Record<string, unknown>): string {
  const name = type.slice(5);
  const output = (part.output ?? {}) as Record<string, unknown>;
  const summary =
    typeof output._summary === 'string' ? output._summary : ((part.state as string) ?? 'called');
  const bits: string[] = [`> tool ${name} — ${summary}`];
  if (typeof output.job_id === 'string') bits.push(`job ${output.job_id}`);
  if (Array.isArray(output.paths) && output.paths.length > 0) bits.push(String(output.paths.join(', ')));
  const cost = output.actual_usd ?? output.cost_usd ?? output.estimate_usd;
  if (typeof cost === 'number') bits.push(money(cost));
  return bits.join(' · ');
}

/**
 * Render a session's messages to a Markdown transcript with front matter
 * (TRD-11 §12). Tool calls become blockquote lines, an approval its decision,
 * and text parts prose; asset paths are written as they are so they resolve
 * relative to the Project folder.
 */
export function renderTranscript(
  session: {
    id: string;
    title?: string | null;
    llm_model?: string | null;
    autonomy?: string | null;
    spent_usd?: number;
  },
  messages: MessageLike[],
): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`session: ${session.id}`);
  if (session.title) lines.push(`title: ${JSON.stringify(session.title)}`);
  if (session.llm_model) lines.push(`model: ${session.llm_model}`);
  if (session.autonomy) lines.push(`autonomy: ${session.autonomy}`);
  if (typeof session.spent_usd === 'number') lines.push(`spent_usd: ${session.spent_usd.toFixed(6)}`);
  lines.push('---');
  lines.push('');

  for (const message of messages) {
    const speaker = message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : null;
    if (!speaker) continue; // system rows (loaded skills) are excluded from the transcript
    lines.push(`## ${speaker}`);
    for (const rawPart of message.parts) {
      const part = rawPart as Record<string, unknown>;
      const type = typeof part.type === 'string' ? part.type : '';
      if (type === 'text' && typeof part.text === 'string') {
        lines.push(part.text);
      } else if (type === 'reasoning' && typeof part.text === 'string') {
        lines.push(`> thinking · ${part.text}`);
      } else if (type === 'file' && typeof part.url === 'string') {
        lines.push(`> attachment · ${part.url}`);
      } else if (type.startsWith('tool-')) {
        if (part.state === 'approval-requested') {
          lines.push(`> approval requested for ${type.slice(5)}`);
        } else if (part.state === 'denied') {
          lines.push(`> denied ${type.slice(5)}`);
        } else {
          lines.push(renderToolPart(type, part));
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
