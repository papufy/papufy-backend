import type { Server } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { env } from "../config/env";
import { chatService } from "../services/chat.service";
import { verifyToken } from "../utils/jwt";
import { AppError } from "../utils/errors";

interface AuthedSocket extends WebSocket {
  userId?: string;
  isAlive?: boolean;
}

const conversationRooms = new Map<string, Set<AuthedSocket>>();
const userSockets = new Map<string, Set<AuthedSocket>>();

function addToRoom(conversationId: string, socket: AuthedSocket) {
  if (!conversationRooms.has(conversationId)) {
    conversationRooms.set(conversationId, new Set());
  }
  conversationRooms.get(conversationId)!.add(socket);
}

function removeSocket(socket: AuthedSocket) {
  if (socket.userId) {
    const set = userSockets.get(socket.userId);
    if (set) {
      set.delete(socket);
      if (set.size === 0) userSockets.delete(socket.userId);
    }
  }
  for (const room of conversationRooms.values()) {
    room.delete(socket);
  }
}

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

async function broadcastUnread(userId: string) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const count = await chatService.getUnreadCount(userId);
  for (const s of sockets) {
    send(s, { type: "unread", count });
  }
}

function broadcastToConversation(
  conversationId: string,
  payload: unknown,
  except?: AuthedSocket
) {
  const room = conversationRooms.get(conversationId);
  if (!room) return;
  for (const client of room) {
    if (client !== except && client.readyState === client.OPEN) {
      send(client, payload);
    }
  }
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (rawSocket, req) => {
    const socket = rawSocket as AuthedSocket;
    socket.isAlive = true;

    const url = new URL(req.url ?? "/ws", "https://placeholder.invalid");
    const token =
      url.searchParams.get("token") ||
      req.headers["sec-websocket-protocol"]?.toString();

    if (!token) {
      send(socket, { type: "error", message: "Token ausente." });
      socket.close();
      return;
    }

    try {
      const payload = verifyToken(token);
      socket.userId = payload.sub;

      if (!userSockets.has(payload.sub)) {
        userSockets.set(payload.sub, new Set());
      }
      userSockets.get(payload.sub)!.add(socket);

      send(socket, { type: "connected", userId: payload.sub });
      void broadcastUnread(payload.sub);
    } catch {
      send(socket, { type: "error", message: "Token inválido." });
      socket.close();
      return;
    }

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", async (raw) => {
      if (!socket.userId) return;

      try {
        const data = JSON.parse(raw.toString()) as {
          type: string;
          conversationId?: string;
          content?: string;
        };

        if (data.type === "join" && data.conversationId) {
          const allowed = await chatService.assertParticipant(
            data.conversationId,
            socket.userId
          );
          if (!allowed) {
            send(socket, { type: "error", message: "Conversa inválida." });
            return;
          }
          addToRoom(data.conversationId, socket);
          send(socket, { type: "joined", conversationId: data.conversationId });
          return;
        }

        if (
          data.type === "send" &&
          data.conversationId &&
          data.content
        ) {
          const message = await chatService.sendMessage(
            data.conversationId,
            socket.userId,
            data.content
          );

          broadcastToConversation(data.conversationId, {
            type: "message",
            message,
          });

          const conversation = await chatService.assertParticipant(
            data.conversationId,
            socket.userId
          );
          if (conversation) {
            const otherId =
              conversation.contractorId === socket.userId
                ? conversation.providerId
                : conversation.contractorId;
            await broadcastUnread(otherId);
          }

          send(socket, {
            type: "message",
            message: { ...message, isMine: true },
          });
          return;
        }
      } catch (err) {
        const message =
          err instanceof AppError
            ? err.message
            : env.isProduction
              ? "Não foi possível processar a mensagem."
              : err instanceof Error
                ? err.message
                : "Erro no chat.";
        send(socket, { type: "error", message });
      }
    });

    socket.on("close", () => {
      removeSocket(socket);
    });
  });

  const interval = setInterval(() => {
    for (const client of wss.clients) {
      const s = client as AuthedSocket;
      if (!s.isAlive) {
        s.terminate();
        continue;
      }
      s.isAlive = false;
      s.ping();
    }
  }, 30000);

  wss.on("close", () => clearInterval(interval));

  return wss;
}
