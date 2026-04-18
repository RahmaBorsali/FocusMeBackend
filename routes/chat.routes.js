const express = require("express");

const { requireAuth } = require("../middleware/auth");
const {
  createDirectMessage,
  markConversationAsRead,
  ensureOrCreateConversation,
  listMessagesForConversation,
  getConversationItem,
  listConversationsForUser
} = require("../services/chatService");
const { chatUpload } = require("../middleware/upload");
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

router.post("/upload", requireAuth, chatUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "NO_FILE_UPLOADED" });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const fileUrl = `${baseUrl}/uploads/chat/${req.file.filename}`;

    return res.json({
      url: fileUrl,
      type: req.file.mimetype,
      fileName: req.file.originalname,
      fileSize: req.file.size
    });
  } catch (error) {
    return handleChatError(res, error);
  }
});

router.post("/messages", requireAuth, async (req, res) => {
  try {
    const { messageId, senderId, recipientId } = await createDirectMessage({
      senderId: req.userId,
      targetUserId: req.body.targetUserId,
      conversationId: req.body.conversationId,
      text: req.body.text,
      attachment: req.body.attachment
    });

    const io = getIo(req);
    await emitDirectMessageCreated(io, messageId, { senderId, recipientId });

    return res.status(201).json({ ok: true });
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
