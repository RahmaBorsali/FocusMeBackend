const mongoose = require("mongoose");

const FriendshipSchema = new mongoose.Schema(
  {
    user1Id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    user2Id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }
  },
  { timestamps: true }
);

// unique pair
FriendshipSchema.index({ user1Id: 1, user2Id: 1 }, { unique: true });

module.exports = mongoose.model("Friendship", FriendshipSchema);