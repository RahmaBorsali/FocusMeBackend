const mongoose = require("mongoose");

const User = require("../models/user");
const Friendship = require("../models/Friendship");
const DirectConversation = require("../models/DirectConversation");
const DirectMessage = require("../models/DirectMessage");

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const MAX_MESSAGE_LENGTH = 1000;

function normalizeObjectId(value) {
  return value && value.toString ? value.toString() : String(value || "");
}

function normalizePair(a, b) {
  return normalizeObjectId(a) < normalizeObjectId(b) ? [a, b] : [b, a];
}

function buildParticipantsKey(a, b) {
  const [u1, u2] = normalizePair(a, b);
  return `${normalizeObjectId(u1)}:${normalizeObjectId(u2)}`;
}

function clampMessageText(value) {
  return String(value || "").trim().slice(0, MAX_MESSAGE_LENGTH);
}

function createChatError(status, code) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  return error;
}

function toObjectId(value, code = "INVALID_ID") {
  if (!mongoose.isValidObjectId(value)) {
    throw createChatError(400, code);
  }

  return new mongoose.Types.ObjectId(value);
}

function getConversationPeerId(conversation, userId) {
  const me = normalizeObjectId(userId);
  const peerId = (conversation.participantIds || []).find((item) => normalizeObjectId(item) !== me);
  return normalizeObjectId(peerId);
}

function serializeUser(user) {
  if (!user) return null;

  return {
    id: user._id,
    username: user.username,
    email: user.email,
    avatarType: user.avatarType,
    avatarInitials: user.avatarInitials,
    avatarUrl: user.avatarUrl
  };
}

function serializeMessage(message, userMap) {
  const sender = userMap.get(normalizeObjectId(message.senderId)) || null;
  const recipient = userMap.get(normalizeObjectId(message.recipientId)) || null;

  return {
    id: message._id,
    conversationId: message.conversationId,
    sender: serializeUser(sender),
    recipient: serializeUser(recipient),
    text: message.text,
    createdAt: message.createdAt,
    readAt: message.readAt
  };
}

async function findUsersByIds(userIds) {
  const ids = [...new Set(userIds.map(normalizeObjectId).filter(Boolean))];
  if (ids.length === 0) return [];

  return User.find({ _id: { $in: ids } })
    .select("_id username email avatarType avatarInitials avatarUrl")
    .lean();
}

async function areFriends(userA, userB) {
  const [u1, u2] = normalizePair(userA, userB);
  const friendship = await Friendship.findOne({ user1Id: u1, user2Id: u2 }).select("_id").lean();
  return Boolean(friendship);
}

async function assertTargetUserCanChat(senderId, targetUserId) {
  const normalizedTargetId = normalizeObjectId(targetUserId);
  if (!mongoose.isValidObjectId(normalizedTargetId)) throw createChatError(400, "INVALID_TARGET_USER");
  if (normalizedTargetId === normalizeObjectId(senderId)) throw createChatError(400, "CANNOT_CHAT_WITH_SELF");

  const user = await User.findById(normalizedTargetId).select("_id").lean();
  if (!user) throw createChatError(404, "USER_NOT_FOUND");

  const friendshipOk = await areFriends(senderId, normalizedTargetId);
  if (!friendshipOk) throw createChatError(403, "CHAT_ONLY_AVAILABLE_WITH_FRIENDS");

  return normalizedTargetId;
}

async function ensureConversationAccess(conversationId, userId) {
  if (!mongoose.isValidObjectId(conversationId)) throw createChatError(400, "INVALID_CONVERSATION");

  const conversation = await DirectConversation.findById(conversationId);
  if (!conversation) throw createChatError(404, "CONVERSATION_NOT_FOUND");

  const allowed = (conversation.participantIds || []).some((item) => normalizeObjectId(item) === normalizeObjectId(userId));
  if (!allowed) throw createChatError(403, "FORBIDDEN");

  return conversation;
}

async function ensureOrCreateConversation(userId, targetUserId) {
  const normalizedTargetId = await assertTargetUserCanChat(userId, targetUserId);
  const [u1, u2] = normalizePair(userId, normalizedTargetId);
  const participantsKey = buildParticipantsKey(u1, u2);

  let conversation = await DirectConversation.findOneAndUpdate(
    { participantsKey },
    {
      $setOnInsert: {
        participantIds: [u1, u2],
        participantsKey
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );

  if (!conversation) {
    conversation = await DirectConversation.findOne({ participantsKey });
  }

  return conversation;
}

async function buildConversationItems(conversations, viewerUserId) {
  if (!conversations.length) return [];

  const viewerId = normalizeObjectId(viewerUserId);
  const conversationIds = conversations.map((item) => item._id);
  const participantIds = conversations.flatMap((item) => item.participantIds || []);

  const [users, unreadRows] = await Promise.all([
    findUsersByIds(participantIds),
    DirectMessage.aggregate([
      {
        $match: {
          conversationId: { $in: conversationIds.map((id) => toObjectId(id, "INVALID_CONVERSATION")) },
          recipientId: toObjectId(viewerId, "INVALID_USER"),
          readAt: null
        }
      },
      { $group: { _id: "$conversationId", count: { $sum: 1 } } }
    ])
  ]);

  const userMap = new Map(users.map((user) => [normalizeObjectId(user._id), user]));
  const unreadMap = new Map(unreadRows.map((row) => [normalizeObjectId(row._id), row.count]));

  return conversations.map((conversation) => {
    const peerId = getConversationPeerId(conversation, viewerId);
    return {
      id: conversation._id,
      peer: serializeUser(userMap.get(peerId) || null),
      unreadCount: unreadMap.get(normalizeObjectId(conversation._id)) || 0,
      lastMessage: conversation.lastMessageAt ? {
        text: conversation.lastMessageText,
        senderId: conversation.lastMessageSenderId,
        createdAt: conversation.lastMessageAt
      } : null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    };
  });
}

async function getConversationItem(conversationId, viewerUserId) {
  const conversation = await ensureConversationAccess(conversationId, viewerUserId);
  const items = await buildConversationItems([conversation], viewerUserId);
  return items[0] || null;
}

async function listConversationsForUser(userId) {
  const conversations = await DirectConversation.find({ participantIds: userId })
    .sort({ lastMessageAt: -1, updatedAt: -1, createdAt: -1 });

  return buildConversationItems(conversations, userId);
}

async function listMessagesForConversation(conversationId, userId, { limit, before } = {}) {
  await ensureConversationAccess(conversationId, userId);

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_MESSAGE_LIMIT, 1), MAX_MESSAGE_LIMIT);
  const query = { conversationId };

  if (before) {
    const beforeDate = new Date(before);
    if (!Number.isNaN(beforeDate.getTime())) {
      query.createdAt = { $lt: beforeDate };
    }
  }

  const messages = await DirectMessage.find(query).sort({ createdAt: -1 }).limit(safeLimit).lean();
  const users = await findUsersByIds(messages.flatMap((message) => [message.senderId, message.recipientId]));
  const userMap = new Map(users.map((user) => [normalizeObjectId(user._id), user]));

  return messages.reverse().map((message) => serializeMessage(message, userMap));
}

async function createDirectMessage({ senderId, targetUserId, conversationId, text }) {
  const trimmedText = clampMessageText(text);
  if (!trimmedText) throw createChatError(400, "EMPTY_MESSAGE");

  let conversation = null;
  let resolvedTargetUserId = normalizeObjectId(targetUserId);

  if (conversationId) {
    conversation = await ensureConversationAccess(conversationId, senderId);
    resolvedTargetUserId = getConversationPeerId(conversation, senderId);
    const friendshipOk = await areFriends(senderId, resolvedTargetUserId);
    if (!friendshipOk) throw createChatError(403, "CHAT_ONLY_AVAILABLE_WITH_FRIENDS");
  } else {
    conversation = await ensureOrCreateConversation(senderId, targetUserId);
    resolvedTargetUserId = getConversationPeerId(conversation, senderId);
  }

  const message = await DirectMessage.create({
    conversationId: conversation._id,
    senderId,
    recipientId: resolvedTargetUserId,
    text: trimmedText
  });

  conversation.lastMessageText = trimmedText;
  conversation.lastMessageAt = message.createdAt;
  conversation.lastMessageSenderId = senderId;
  await conversation.save();

  return {
    conversation,
    message,
    senderId: normalizeObjectId(senderId),
    recipientId: normalizeObjectId(resolvedTargetUserId)
  };
}

async function getMessagePayload(messageId) {
  if (!mongoose.isValidObjectId(messageId)) throw createChatError(400, "INVALID_MESSAGE");

  const message = await DirectMessage.findById(messageId).lean();
  if (!message) throw createChatError(404, "MESSAGE_NOT_FOUND");

  const users = await findUsersByIds([message.senderId, message.recipientId]);
  const userMap = new Map(users.map((user) => [normalizeObjectId(user._id), user]));
  return serializeMessage(message, userMap);
}

async function markConversationAsRead(conversationId, userId) {
  const conversation = await ensureConversationAccess(conversationId, userId);
  const readAt = new Date();
  const result = await DirectMessage.updateMany(
    {
      conversationId: conversation._id,
      recipientId: userId,
      readAt: null
    },
    { $set: { readAt } }
  );

  return {
    conversation,
    readAt,
    readCount: result.modifiedCount || 0,
    readerId: normalizeObjectId(userId),
    peerId: getConversationPeerId(conversation, userId)
  };
}

async function buildRealtimeMessagePayload(messageId, viewerUserId) {
  const message = await getMessagePayload(messageId);
  const conversation = await getConversationItem(message.conversationId, viewerUserId);

  return {
    conversation,
    message
  };
}

function buildReadReceiptPayload({ conversation, readAt, readCount, readerId }) {
  return {
    conversationId: conversation._id,
    readerId,
    readAt,
    readCount
  };
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  DEFAULT_MESSAGE_LIMIT,
  MAX_MESSAGE_LIMIT,
  normalizeObjectId,
  createChatError,
  ensureConversationAccess,
  ensureOrCreateConversation,
  listConversationsForUser,
  listMessagesForConversation,
  createDirectMessage,
  markConversationAsRead,
  getConversationItem,
  buildRealtimeMessagePayload,
  buildReadReceiptPayload
};
