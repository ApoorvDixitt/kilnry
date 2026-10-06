// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The media fields fal's own input schemas name for the endpoints whose field
// names are not the generic `image_url` / `image_urls[]` (F-09, F-10, F-11,
// F-119). Each row was read from fal's published schema for that endpoint,
// https://fal.ai/models/<endpoint>/llms.txt ("Input Schema"), on 2026-10-06:
//
//   fal-ai/kling-video/v3/{standard,pro}/image-to-video  start_image_url (required), end_image_url
//   fal-ai/kling-video/v3/{standard,pro}/text-to-video   prompt only; no image field
//   alibaba/wan-3.0/image-to-video                       start_image_url (required), end_image_url
//   alibaba/wan-3.0/text-to-video                        prompt (required); no image field
//   alibaba/wan-3.0/reference-to-video                   reference_image_urls[], reference_video_urls[], reference_audio_urls[]
//   fal-ai/kling-video/ai-avatar/v2/pro                  image_url (required), audio_url (required)
//   fal-ai/clarity-upscaler                              image_url (required)
//   fal-ai/aura-sr                                       image_url (required)
//   fal-ai/bria/background/remove                        image_url (required)
//   fal-ai/image-editing/reframe                         image_url (required)
//
// The adapter reads `fields` to name what it sends; the integration mock reads
// `required` to refuse a body that lacks them, as fal does with a 422.

export interface FalMediaFields {
  /** Where a start frame goes (default `image_url`). */
  start_frame?: string;
  /** Where the end frame goes (default `end_image_url`). */
  end_frame?: string;
  /** A lone reference image is the endpoint's one source image, under this name. */
  single_image?: string;
  /** Reference images go into this list (default `image_urls`). */
  reference_images?: string;
  reference_videos?: string;
  reference_audios?: string;
  /**
   * A reference image stands in for the start frame when the request has none
   * (Kling v3 image-to-video has no reference-image list; its only image input
   * is the start frame).
   */
  reference_as_start_frame?: boolean;
}

export interface FalEndpointSchema {
  fields: FalMediaFields;
  /** Fields fal marks required; a body without them is rejected with a 422. */
  required: string[];
  source: string;
}

const READ_ON = '2026-10-06';
const page = (id: string): string => `https://fal.ai/models/${id}/llms.txt (read ${READ_ON})`;

const KLING_V3_I2V: FalMediaFields = {
  start_frame: 'start_image_url',
  end_frame: 'end_image_url',
  reference_as_start_frame: true,
};

const SCHEMAS: Record<string, FalEndpointSchema> = {
  'fal-ai/kling-video/v3/standard/image-to-video': {
    fields: KLING_V3_I2V,
    required: ['start_image_url'],
    source: page('fal-ai/kling-video/v3/standard/image-to-video'),
  },
  'fal-ai/kling-video/v3/pro/image-to-video': {
    fields: KLING_V3_I2V,
    required: ['start_image_url'],
    source: page('fal-ai/kling-video/v3/pro/image-to-video'),
  },
  'alibaba/wan-3.0/image-to-video': {
    fields: { start_frame: 'start_image_url', end_frame: 'end_image_url' },
    required: ['start_image_url'],
    source: page('alibaba/wan-3.0/image-to-video'),
  },
  'alibaba/wan-3.0/text-to-video': {
    fields: {},
    required: ['prompt'],
    source: page('alibaba/wan-3.0/text-to-video'),
  },
  'alibaba/wan-3.0/reference-to-video': {
    fields: {
      reference_images: 'reference_image_urls',
      reference_videos: 'reference_video_urls',
      reference_audios: 'reference_audio_urls',
    },
    required: [],
    source: page('alibaba/wan-3.0/reference-to-video'),
  },
  'fal-ai/kling-video/ai-avatar/v2/pro': {
    fields: { single_image: 'image_url' },
    required: ['image_url', 'audio_url'],
    source: page('fal-ai/kling-video/ai-avatar/v2/pro'),
  },
  'fal-ai/clarity-upscaler': {
    fields: { single_image: 'image_url' },
    required: ['image_url'],
    source: page('fal-ai/clarity-upscaler'),
  },
  'fal-ai/aura-sr': {
    fields: { single_image: 'image_url' },
    required: ['image_url'],
    source: page('fal-ai/aura-sr'),
  },
  'fal-ai/bria/background/remove': {
    fields: { single_image: 'image_url' },
    required: ['image_url'],
    source: page('fal-ai/bria/background/remove'),
  },
  'fal-ai/image-editing/reframe': {
    fields: { single_image: 'image_url' },
    required: ['image_url'],
    source: page('fal-ai/image-editing/reframe'),
  },
};

/** fal's published input schema for an endpoint this table covers, or undefined. */
export function falEndpointSchema(model: string | undefined): FalEndpointSchema | undefined {
  return model === undefined ? undefined : SCHEMAS[model];
}

/** The endpoints whose schema this table records, for tests and the mock. */
export function falSchemaEndpoints(): string[] {
  return Object.keys(SCHEMAS);
}
