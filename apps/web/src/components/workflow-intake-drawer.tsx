// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

'use client';

// The workflow intake drawer (F-WFL-02). It opens from the catalogue's Run
// button, shows the workflow's name and description, and is where the intake
// fields and the priced Plan preview live. This first cut opens the drawer and
// closes it; the plan preview and per-field inputs are filled in next.

import { message } from '../lib/messages';

export function WorkflowIntakeDrawer({
  workflowId,
  name,
  onClose,
}: {
  workflowId: string;
  name: string;
  onClose: () => void;
}): React.ReactNode {
  return (
    <aside className="workflow-drawer" role="dialog" aria-label={name} data-workflow-id={workflowId}>
      <header className="workflow-drawer-head">
        <h2 className="workflow-drawer-title">{name}</h2>
        <button
          type="button"
          className="workflow-drawer-close"
          onClick={onClose}
          aria-label={message('shell.close')}
        >
          ×
        </button>
      </header>
      <p className="workflow-drawer-hint">{message('workflows.costUnknown')}</p>
    </aside>
  );
}
