const mongoose = require("mongoose");

const DirectConversationSchema = new mongoose.Schema(
  {
    participantIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
      required: true,
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length === 2 && new Set(value.map((item) => item.toString())).size === 2;
        },
        message: "DIRECT_CONVERSATION_REQUIRES_TWO_UNIQUE_PARTICIPANTS"
      }
    },
    participantsKey: { type: String, required: true, unique: true, index: true },
    lastMessageText: { type: String, default: "" },
    lastMessageAt: { type: Date, default: null, index: true },
    lastMessageSenderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

DirectConversationSchema.index({ participantIds: 1 });

module.exports = mongoose.model("DirectConversation", DirectConversationSchema);
