const mongoose = require("mongoose");

const ChallengeInviteSchema = new mongoose.Schema(
  {
    challengeId: { type: mongoose.Schema.Types.ObjectId, ref: "Challenge", required: true, index: true },
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["invite", "join_request"], default: "invite", index: true },
    status: { type: String, enum: ["pending", "accepted", "rejected", "cancelled"], default: "pending" },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

ChallengeInviteSchema.index(
  { challengeId: 1, fromUserId: 1, toUserId: 1, kind: 1 },
  { unique: true }
);

module.exports = mongoose.model("ChallengeInvite", ChallengeInviteSchema);
