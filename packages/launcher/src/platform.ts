// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

export type SupportedPlatform = 'darwin-arm64' | 'darwin-x64' | 'linux-arm64' | 'linux-x64' | 'win32-x64';

export function platformKey(platform = process.platform, arch = process.arch): SupportedPlatform {
  const key = `${platform}-${arch}`;
  if (['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'].includes(key)) {
    return key as SupportedPlatform;
  }
  throw new Error(`Kilnry has no build for ${key}. Use Docker on this platform.`);
}
