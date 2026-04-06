const mongoose = require("mongoose");

const ChallengeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 80 },
    description: { type: String, default: "", maxlength: 280 },
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    visibility: { type: String, enum: ["public", "private", "friends"], default: "private" },
    joinCode: { type: String, default: null, index: true },
    goalMinutes: { type: Number, default: 0, min: 0 },
    goalType: {
      type: String,
      enum: ["focus_minutes", "sessions_count", "tasks_completed"],
      default: "focus_minutes"
    },
    targetValue: { type: Number, default: 0, min: 0 },
    maxParticipants: { type: Number, default: 20, min: 2, max: 200 }
  },
  { timestamps: true }
);

ChallengeSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model("Challenge", ChallengeSchema);

