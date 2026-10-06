// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { CreateComposer } from '../../../components/create-composer';

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string | string[]; prefill?: string | string[]; mode?: string | string[] }>;
}): Promise<React.ReactNode> {
  const params = await searchParams;
  const one = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;
  const edit = one(params.edit);
  // Onboarding's "Open Kilnry" lands here with the PRD's example prompt for the
  // connected provider, in the matching mode, so the first Generate is one click
  // (PRD-04:200, F-50, UX-02).
  const prefill = one(params.prefill);
  const mode = one(params.mode);
  return (
    <CreateComposer
      editAssetId={edit ?? null}
      {...(prefill === undefined ? {} : { prefillPrompt: prefill })}
      {...(mode === 'video' || mode === 'image' ? { prefillMode: mode } : {})}
    />
  );
}
