type MessageBroadcaster = (conversationId: string, message: unknown) => void;
type UnreadBroadcaster = (userId: string) => void | Promise<void>;

let broadcastMessage: MessageBroadcaster | null = null;
let broadcastUnreadForUser: UnreadBroadcaster | null = null;

export function registerChatRealtime(handlers: {
  broadcastMessage: MessageBroadcaster;
  broadcastUnreadForUser: UnreadBroadcaster;
}): void {
  broadcastMessage = handlers.broadcastMessage;
  broadcastUnreadForUser = handlers.broadcastUnreadForUser;
}

export function notifyChatMessage(conversationId: string, message: unknown): void {
  broadcastMessage?.(conversationId, message);
}

export async function notifyChatUnread(userId: string): Promise<void> {
  await broadcastUnreadForUser?.(userId);
}
