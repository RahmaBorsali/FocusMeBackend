const mongoose = require("mongoose");

const DirectMessageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "DirectConversation", required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, trim: true, maxlength: 1000 },
    attachment: {
      url: { type: String },
      type: { type: String },
      fileName: { type: String },
      fileSize: { type: Number }
    },
    readAt: { type: Date, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

DirectMessageSchema.index({ conversationId: 1, createdAt: -1 });
DirectMessageSchema.index({ recipientId: 1, readAt: 1, conversationId: 1 });

module.exports = mongoose.model("DirectMessage", DirectMessageSchema);
