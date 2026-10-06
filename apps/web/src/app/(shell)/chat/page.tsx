// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// The bare /chat route (PRD-11:17 "Route `/chat` (`/chat/:session_id`)"). It
// minted a fresh session id on every visit, so a reload started an empty thread
// and stranded any pending card (F-116). It now sends the browser to the most
// recent session, or to a new one on a first visit.

import { redirect } from 'next/navigation';
import { latestChatSessionId, newChatSessionId } from '../../../server/chat-page';

export default async function ChatPage(): Promise<React.ReactNode> {
  const latest = await latestChatSessionId();
  redirect(`/chat/${encodeURIComponent(latest ?? newChatSessionId())}`);
}
