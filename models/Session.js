const mongoose = require("mongoose");

const SessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    // Duration of the focus session in minutes
    durationMinutes: { type: Number, required: true, min: 0 },

    // Optional: tasks linked to this session (any tasks where sessionId == this._id)
    // We store them here for quick access at completion time
    taskIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],

    // "yyyy-MM-dd" string matching UserStats.date
    date: { type: String, required: true }
  },
  { timestamps: true }
);

// Index to efficiently query sessions by user + date
SessionSchema.index({ userId: 1, date: -1 });

module.exports = mongoose.model("Session", SessionSchema);
