const mongoose = require("mongoose");

const ChallengeParticipantSchema = new mongoose.Schema(
  {
    challengeId: { type: mongoose.Schema.Types.ObjectId, ref: "Challenge", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    joinedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ["active", "left"], default: "active" }
  },
  { timestamps: true }
);

ChallengeParticipantSchema.index({ challengeId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("ChallengeParticipant", ChallengeParticipantSchema);

