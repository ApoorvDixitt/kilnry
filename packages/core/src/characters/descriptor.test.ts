// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { describe, expect, it, vi } from 'vitest';
import { DESCRIPTOR_MODEL, DESCRIPTOR_PROMPT, generateDescriptor, validateDescriptor } from './descriptor.js';

// A 64-word descriptor (within the 60–120 range).
const DESCRIPTOR =
  'A woman in her early thirties with medium-brown skin and a dark chin-length bob cut with a blunt fringe. She has a small scar on the left side of her chin and wears slim gold hoop earrings. Her build is slight and her posture relaxed. She wears a navy linen kurta with quarter sleeves and a plain round neckline, softly lit against a neutral studio background here today.';

function mockVlm(payload: unknown): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

const good = {
  descriptor: DESCRIPTOR,
  anchors: ['blunt fringe bob', 'chin scar', 'gold hoops', 'navy kurta'],
  negative_traits: ['glasses', 'beard'],
  palette_hex: ['#6b4a3a', '#1a1a1a', '#1f2a44'],
  gendered_noun: 'woman',
};

describe('generateDescriptor', () => {
  it('returns a validated descriptor from the mocked vision-language route', async () => {
    const fetchMock = mockVlm(good);
    const result = await generateDescriptor({
      imageUrls: ['https://v3b.fal.media/files/kilnry/anchor.png'],
      apiKey: 'sk-or-v1-test',
      fetch: fetchMock,
    });
    expect(result.anchors).toEqual(['blunt fringe bob', 'chin scar', 'gold hoops', 'navy kurta']);
    expect(result.gendered_noun).toBe('woman');
    expect(result.negative_traits).toEqual(['glasses', 'beard']);

    // The request carries the verbatim prompt, the image, and the cheapest model.
    const call = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const sent = JSON.parse((call[1] as RequestInit).body as string) as {
      model: string;
      messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
    };
    expect(sent.model).toBe(DESCRIPTOR_MODEL);
    expect(sent.messages[0]!.content[0]).toEqual({ type: 'text', text: DESCRIPTOR_PROMPT });
    expect(sent.messages[0]!.content[1]).toMatchObject({ type: 'image_url' });
  });

  it('extracts JSON when the model wraps it in a code fence', async () => {
    const fenced = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '```json\n' + JSON.stringify(good) + '\n```' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;
    const result = await generateDescriptor({
      imageUrls: ['https://example.com/a.png'],
      apiKey: 'k',
      fetch: fenced,
    });
    expect(result.descriptor).toBe(DESCRIPTOR);
  });

  it('rejects a descriptor that is too short (fewer than 60 words)', async () => {
    const fetchMock = mockVlm({ ...good, descriptor: 'A woman with a bob.' });
    await expect(
      generateDescriptor({ imageUrls: ['https://example.com/a.png'], apiKey: 'k', fetch: fetchMock }),
    ).rejects.toThrow(/expected shape/);
  });

  it('rejects when there are no images', async () => {
    await expect(generateDescriptor({ imageUrls: [], apiKey: 'k' })).rejects.toThrow(/at least one image/i);
  });

  it('surfaces a provider failure as a retryable error', async () => {
    const failing = vi.fn(async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
    await expect(
      generateDescriptor({ imageUrls: ['https://example.com/a.png'], apiKey: 'k', fetch: failing }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });
});

describe('validateDescriptor (editable)', () => {
  it('accepts an edited descriptor that still fits the schema', () => {
    const edited = validateDescriptor({ ...good, anchors: ['blunt fringe bob', 'chin scar', 'gold hoops'] });
    expect(edited.anchors).toHaveLength(3);
  });

  it('rejects too many anchors', () => {
    expect(() => validateDescriptor({ ...good, anchors: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow(
      /not valid/,
    );
  });

  it('rejects a malformed palette colour', () => {
    expect(() => validateDescriptor({ ...good, palette_hex: ['not-a-hex'] })).toThrow(/not valid/);
  });
});
