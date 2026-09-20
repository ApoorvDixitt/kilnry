// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { CreateComposer } from '../../../components/create-composer';

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string | string[] }>;
}): Promise<React.ReactNode> {
  const params = await searchParams;
  const edit = Array.isArray(params.edit) ? params.edit[0] : params.edit;
  return <CreateComposer editAssetId={edit ?? null} />;
}
