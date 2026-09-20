// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { Suspense } from 'react';
import { CreateCharacter } from '../../../../components/create-character';

export default function NewCharacterPage(): React.ReactNode {
  return (
    <Suspense fallback={null}>
      <CreateCharacter />
    </Suspense>
  );
}
