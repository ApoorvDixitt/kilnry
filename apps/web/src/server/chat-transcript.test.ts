// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// Chat transcript export (F-CHT-12, TRD-11 §12). The transcript renders text as
// prose, a tool call as a blockquote line with its job id and cost, an approval
// as its decision, and excludes system rows; the front matter names the session.

import { describe, expect, it } from 'vitest';
import { firstMessageText, renderTranscript } from './chat-transcript';

describe('chat transcript (F-CHT-12)', () => {
  it('takes a session title from the first user text', () => {
    expect(
      firstMessageText({
        parts: [
          { type: 'file', url: 'x' },
          { type: 'text', text: 'Make a reel' },
        ],
      }),
    ).toBe('Make a reel');
  });

  it('renders front matter, prose, tool lines and the decision', () => {
    const markdown = renderTranscript(
      { id: 'sess-1', title: 'Chai reel', llm_model: 'anthropic/claude-sonnet-5', spent_usd: 2.41 },
      [
        { role: 'system', parts: [{ type: 'text', text: 'loaded skill' }] },
        { role: 'user', parts: [{ type: 'text', text: 'Make a 5 s reel.' }] },
        {
          role: 'assistant',
          parts: [
            { type: 'text', text: 'One clip on Kling.' },
            {
              type: 'tool-kilnry_generate',
              state: 'output-available',
              output: {
                _summary: 'One clip.',
                job_id: 'job-1',
                paths: ['Client_A/clip.mp4'],
                actual_usd: 0.84,
              },
            },
          ],
        },
      ],
    );
    expect(markdown).toContain('session: sess-1');
    expect(markdown).toContain('model: anthropic/claude-sonnet-5');
    expect(markdown).toContain('## User');
    expect(markdown).toContain('Make a 5 s reel.');
    expect(markdown).toContain('> tool kilnry_generate — One clip.');
    expect(markdown).toContain('job job-1');
    expect(markdown).toContain('Client_A/clip.mp4');
    expect(markdown).toContain('$0.84');
    // System rows (loaded skills) are excluded from the transcript.
    expect(markdown).not.toContain('loaded skill');
  });

  it('renders an approval request and a denial as their decision', () => {
    const markdown = renderTranscript({ id: 's' }, [
      {
        role: 'assistant',
        parts: [
          { type: 'tool-kilnry_generate', state: 'approval-requested' },
          { type: 'tool-kilnry_voices', state: 'denied' },
        ],
      },
    ]);
    expect(markdown).toContain('> approval requested for kilnry_generate');
    expect(markdown).toContain('> denied kilnry_voices');
  });
});
