const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isDone: { type: Boolean, default: false },

    // optional references — one of the two is set depending on context
    sessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    dayId:     { type: String, default: null },

    dueDate:   { type: Date, default: null },
    completedAt: { type: Date, default: null },

    postponedCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Task", TaskSchema);
