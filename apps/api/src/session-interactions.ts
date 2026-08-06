import type { ContentBlock } from "@cohub/protocol/core";
import type { GatewayInboundEvent } from "@cohub/protocol/gateway";
import { getOrCreateRequestId } from "@cohub/infra/tracing";
import { createProviderMessageRef } from "./channels.js";
import { submitSessionPrompt, type ChannelPromptContext } from "./session-prompts.js";

export type SessionInteractionInboundRef = {
  provider: string;
  spaceChannelId: string;
  externalConversationId: string;
  externalMessageId: string;
  externalAuthorId?: string | null;
  externalAuthorName?: string | null;
  meta?: Record<string, unknown> | null;
};

export type ResolvedInboundInteraction = {
  spaceId: string;
  sessionId: string;
  inputText: string;
  content: ContentBlock[];
  source: string;
  userId: string;
  clientMessageId: string;
  model?: string;
  provider?: string;
  thinkingLevel?: string | null;
  inboundRef?: SessionInteractionInboundRef | null;
};

export const extractInboundText = (event: GatewayInboundEvent) => {
  const textBlock = event.content.find(
    (block): block is { type: "text"; text: string } => block.type === "text",
  );
  return textBlock?.text || "";
};

export const executeSessionInteraction = async (input: ResolvedInboundInteraction) => {
  const context: ChannelPromptContext | null = input.inboundRef
    ? {
        kind: "channel",
        provider: input.inboundRef.provider,
        spaceChannelId: input.inboundRef.spaceChannelId,
        requestId: getOrCreateRequestId(input.inboundRef.externalMessageId),
        externalConversationId: input.inboundRef.externalConversationId,
        externalMessageId: input.inboundRef.externalMessageId,
        providerContext: input.inboundRef.meta ?? null,
      }
    : null;

  return submitSessionPrompt({
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    userId: input.userId,
    clientMessageId: input.clientMessageId,
    content: input.content,
    source: input.source,
    model: input.model ?? null,
    provider: input.provider ?? null,
    thinkingLevel: input.thinkingLevel ?? null,
    context,
  }, {
    beforeEnqueue: async ({ turnId, userMessageId }) => {
      if (!input.inboundRef) return;
      await createProviderMessageRef({
        provider: input.inboundRef.provider,
        spaceId: input.spaceId,
        spaceSessionId: input.sessionId,
        spaceChannelId: input.inboundRef.spaceChannelId,
        sessionMessageId: userMessageId,
        direction: "inbound",
        externalConversationId: input.inboundRef.externalConversationId,
        externalMessageId: input.inboundRef.externalMessageId,
        externalAuthorId: input.inboundRef.externalAuthorId ?? null,
        externalAuthorName: input.inboundRef.externalAuthorName ?? null,
        meta: {
          ...(input.inboundRef.meta ?? {}),
          messageKind: "user",
          anchorUserMessageId: userMessageId,
          turnId,
          clientMessageId: input.clientMessageId,
        },
      });
    },
  });
};
