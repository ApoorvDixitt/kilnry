// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Several media tests shell out to a real ffmpeg/ffprobe to transcode,
    // concat, mux and burn captions. On a loaded CI runner one real transcode
    // outlasts vitest's 5 s default, so the mux_audio and caption tests timed
    // out there while passing on a faster machine. Give the whole suite a
    // generous ceiling; the non-ffmpeg tests still finish in milliseconds.
    testTimeout: 30_000,
    exclude: ['dist/**', '**/node_modules/**'],
  },
});
