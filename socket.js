const { Server } = require("socket.io");

const { extractBearerToken, verifyAccessToken } = require("./middleware/auth");
const {
  ensureConversationAccess,
  createDirectMessage,
  markConversationAsRead
} = require("./services/chatService");
const {
  userRoom,
  conversationRoom,
  emitDirectMessageCreated,
  emitConversationRead
} = require("./services/chatRealtime");

function normalizeSocketToken(value) {
  const token = String(value || "").trim();
  if (!token) return null;
  return token.replace(/^Bearer\s+/i, "");
}

function getSocketToken(handshake) {
  const authToken = normalizeSocketToken(handshake.auth && handshake.auth.token);
  if (authToken) return authToken;

  const headerToken = extractBearerToken(handshake.headers.authorization || "");
  if (headerToken) return headerToken;

  const queryToken = normalizeSocketToken(handshake.query && handshake.query.token);
  return queryToken || null;
}

function safeAck(ack, payload) {
  if (typeof ack === "function") {
    ack(payload);
  }
}

function toSocketErrorPayload(error) {
  if (error && error.code) {
    return { ok: false, error: error.code };
  }

  console.error(error);
  return { ok: false, error: "INTERNAL_ERROR" };
}

function createSocketServer(server) {
  const io = new Server(server, {
    cors: { origin: "*", credentials: false }
  });

  io.use((socket, next) => {
    try {
      const token = getSocketToken(socket.handshake);
      if (!token) return next(new Error("UNAUTHORIZED"));

      const payload = verifyAccessToken(token);
      socket.userId = payload.sub;
      return next();
    } catch {
      return next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(userRoom(socket.userId));
    socket.emit("chat:connected", { userId: socket.userId });

    socket.on("chat:conversation:join", async (payload = {}, ack) => {
      try {
        const conversation = await ensureConversationAccess(payload.conversationId, socket.userId);
        await socket.join(conversationRoom(conversation._id));
        return safeAck(ack, { ok: true, conversationId: conversation._id });
      } catch (error) {
        return safeAck(ack, toSocketErrorPayload(error));
      }
    });

    socket.on("chat:conversation:leave", async (payload = {}, ack) => {
      try {
        if (payload.conversationId) {
          await socket.leave(conversationRoom(payload.conversationId));
        }

        return safeAck(ack, { ok: true, conversationId: payload.conversationId || null });
      } catch (error) {
        return safeAck(ack, toSocketErrorPayload(error));
      }
    });

    socket.on("chat:typing", async (payload = {}, ack) => {
      try {
        const conversation = await ensureConversationAccess(payload.conversationId, socket.userId);
        socket.to(conversationRoom(conversation._id)).emit("chat:typing", {
          conversationId: conversation._id,
          userId: socket.userId,
          isTyping: Boolean(payload.isTyping)
        });

        return safeAck(ack, { ok: true });
      } catch (error) {
        return safeAck(ack, toSocketErrorPayload(error));
      }
    });

    socket.on("chat:message:send", async (payload = {}, ack) => {
      try {
        const result = await createDirectMessage({
          senderId: socket.userId,
          targetUserId: payload.targetUserId,
          conversationId: payload.conversationId,
          text: payload.text
        });

        await emitDirectMessageCreated(io, result.message._id, {
          senderId: result.senderId,
          recipientId: result.recipientId
        });

        return safeAck(ack, {
          ok: true,
          conversationId: result.conversation._id,
          messageId: result.message._id
        });
      } catch (error) {
        return safeAck(ack, toSocketErrorPayload(error));
      }
    });

    socket.on("chat:messages:read", async (payload = {}, ack) => {
      try {
        const result = await markConversationAsRead(payload.conversationId, socket.userId);
        await emitConversationRead(io, result);

        return safeAck(ack, {
          ok: true,
          conversationId: result.conversation._id,
          readAt: result.readAt,
          readCount: result.readCount
        });
      } catch (error) {
        return safeAck(ack, toSocketErrorPayload(error));
      }
    });
  });

  return io;
}

module.exports = { createSocketServer };
