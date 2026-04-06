const {
  buildRealtimeMessagePayload,
  buildReadReceiptPayload
} = require("./chatService");

function userRoom(userId) {
  return `user:${userId}`;
}

function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

async function emitDirectMessageCreated(io, messageId, { senderId, recipientId }) {
  if (!io) return;

  const [senderPayload, recipientPayload] = await Promise.all([
    buildRealtimeMessagePayload(messageId, senderId),
    buildRealtimeMessagePayload(messageId, recipientId)
  ]);

  io.to(userRoom(senderId)).emit("chat:message:new", senderPayload);
  io.to(userRoom(recipientId)).emit("chat:message:new", recipientPayload);
}

async function emitConversationRead(io, readResult) {
  if (!io || !readResult || !readResult.readCount) return;

  const payload = buildReadReceiptPayload(readResult);

  io.to(userRoom(readResult.readerId)).emit("chat:messages:read", payload);
  io.to(userRoom(readResult.peerId)).emit("chat:messages:read", payload);
}

module.exports = {
  userRoom,
  conversationRoom,
  emitDirectMessageCreated,
  emitConversationRead
};
