// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { Flame } from 'lucide-react';
import { message } from '../lib/messages';

export function PlaceholderPage(): React.ReactNode {
  return (
    <section className="placeholder-page">
      <div className="empty-illustration">
        <Flame size={34} strokeWidth={1.5} />
      </div>
      <h2>{message('placeholder.title')}</h2>
      <p>{message('placeholder.body')}</p>
    </section>
  );
}
