const mongoose = require("mongoose");

const UserStatsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    // stored as "yyyy-MM-dd" string for easy daily grouping
    date: { type: String, required: true },

    focusMinutes:    { type: Number, default: 0 },
    sessionsCount:   { type: Number, default: 0 },
    tasksCompleted:  { type: Number, default: 0 },
    completedTaskTitles: { type: [String], default: [] },
    streak:          { type: Number, default: 0 },

    updatedAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

// Efficient per-user-per-day lookups and range queries
UserStatsSchema.index({ userId: 1, date: -1 });

module.exports = mongoose.model("UserStats", UserStatsSchema);
