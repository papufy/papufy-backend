import { notifyChatMessage, notifyChatUnread } from "../chat/chatRealtime";
import { chatService } from "../services/chat.service";

/** Propaga mensagem nova via WebSocket e atualiza contador do outro participante. */
export async function publishChatMessageToPeers(
  conversationId: string,
  senderId: string,
  message: unknown
): Promise<void> {
  notifyChatMessage(conversationId, message);

  const conversation = await chatService.assertParticipant(
    conversationId,
    senderId
  );
  if (!conversation) return;

  const otherId =
    conversation.contractorId === senderId
      ? conversation.providerId
      : conversation.contractorId;
  await notifyChatUnread(otherId);
}
