const express = require("express");

const { requireAuth } = require("../middleware/auth");
const {
  ensureOrCreateConversation,
  listConversationsForUser,
  getConversationItem,
  listMessagesForConversation,
  createDirectMessage,
  markConversationAsRead
} = require("../services/chatService");
const { emitDirectMessageCreated, emitConversationRead } = require("../services/chatRealtime");

const router = express.Router();

function getIo(req) {
  return req.app.get("io");
}

function handleChatError(res, error) {
  if (error && error.status && error.code) {
    return res.status(error.status).json({ error: error.code });
  }

  console.error(error);
  return res.status(500).json({ error: "INTERNAL_ERROR" });
}

router.get("/conversations", requireAuth, async (req, res) => {
  try {
    const conversations = await listConversationsForUser(req.userId);
    return res.json(conversations);
  } catch (error) {
    return handleChatError(res, error);
  }
});

router.post("/conversations", requireAuth, async (req, res) => {
  try {
    const conversation = await ensureOrCreateConversation(req.userId, req.body.targetUserId);
    const item = await getConversationItem(conversation._id, req.userId);
    return res.json(item);
  } catch (error) {
    return handleChatError(res, error);
  }
});

router.get("/conversations/:conversationId/messages", requireAuth, async (req, res) => {
  try {
    const messages = await listMessagesForConversation(req.params.conversationId, req.userId, {
      limit: req.query.limit,
      before: req.query.before
    });

    return res.json(messages);
  } catch (error) {
    return handleChatError(res, error);
  }
});

router.post("/messages", requireAuth, async (req, res) => {
  try {
    const result = await createDirectMessage({
      senderId: req.userId,
      targetUserId: req.body.targetUserId,
      conversationId: req.body.conversationId,
      text: req.body.text
    });

    await emitDirectMessageCreated(getIo(req), result.message._id, {
      senderId: result.senderId,
      recipientId: result.recipientId
    });

    const conversation = await getConversationItem(result.conversation._id, req.userId);
    return res.status(201).json({
      conversationId: result.conversation._id,
      messageId: result.message._id,
      conversation
    });
  } catch (error) {
    return handleChatError(res, error);
  }
});

router.post("/conversations/:conversationId/read", requireAuth, async (req, res) => {
  try {
    const result = await markConversationAsRead(req.params.conversationId, req.userId);

    await emitConversationRead(getIo(req), result);

    return res.json({
      ok: true,
      readCount: result.readCount,
      readAt: result.readAt
    });
  } catch (error) {
    return handleChatError(res, error);
  }
});

module.exports = router;
