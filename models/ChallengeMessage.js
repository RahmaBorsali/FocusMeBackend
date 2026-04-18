const mongoose = require("mongoose");

const ChallengeMessageSchema = new mongoose.Schema(
  {
    challengeId: { type: mongoose.Schema.Types.ObjectId, ref: "Challenge", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, trim: true },
    attachment: {
      url: { type: String },
      type: { type: String },
      fileName: { type: String },
      fileSize: { type: Number }
    },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

ChallengeMessageSchema.index({ challengeId: 1, createdAt: -1 });

module.exports = mongoose.model("ChallengeMessage", ChallengeMessageSchema);

