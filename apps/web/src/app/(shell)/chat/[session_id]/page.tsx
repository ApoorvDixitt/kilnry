// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

// /chat/:session_id — one addressable thread (PRD-11:17). The screen is handed
// the messages already stored for the session, so a reload shows the same
// conversation and the same cards in their final states (PRD-11:155, F-116).

import { ChatScreen } from '../../../../components/chat-screen';
import { chatScreenProps } from '../../../../server/chat-page';

export default async function ChatSessionPage({
  params,
}: {
  params: Promise<{ session_id: string }>;
}): Promise<React.ReactNode> {
  const { session_id: sessionId } = await params;
  return <ChatScreen {...await chatScreenProps(sessionId)} />;
}
