const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/Task");
const { syncStatsForSession } = require("../services/statsSync");

const router = express.Router();

// POST /api/tasks — Créer une tâche
router.post('/', async (req, res) => {
  try {
    const { title, userId, isDone, dueDate, sessionId, dayId } = req.body;
    const task = await Task.create({
      title,
      userId,
      isDone: isDone || false,
      dueDate,
      sessionId,
      dayId
    });
    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// US-T1 : Marquer une tâche comme terminée
// PATCH /api/tasks/:taskId/complete
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/:taskId/complete", async (req, res) => {
  try {
    const { taskId } = req.params;

    if (!mongoose.isValidObjectId(taskId)) {
      return res.status(400).json({ error: "INVALID_TASK_ID" });
    }

    const task = await Task.findByIdAndUpdate(
      taskId,
      { isDone: true, completedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!task) {
      return res.status(404).json({ error: "TASK_NOT_FOUND" });
    }

    // sync to UserStats if userId exists
    if (task.userId) {
      const today = new Date().toISOString().slice(0, 10);
      syncStatsForSession({
        userId: task.userId,
        date: today,
        focusMinutes: 0,
        tasksCompleted: 1,
        completedTaskTitles: [task.title],
        sessionsCount: 0
      }).catch(err => console.error("[tasks/complete] stats sync failed:", err));
    }

    return res.json(task);
  } catch (err) {
    console.error("[tasks/complete]", err);
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// US-T2 : Reporter une tâche non terminée
// PATCH /api/tasks/:taskId/postpone
// Body : { newDate: "2025-01-20" }
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/:taskId/postpone", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { newDate } = req.body;

    // Validate taskId
    if (!mongoose.isValidObjectId(taskId)) {
      return res.status(400).json({ error: "INVALID_TASK_ID" });
    }

    // Validate newDate presence
    if (!newDate) {
      return res.status(400).json({ error: "MISSING_NEW_DATE" });
    }

    // Parse and validate date format
    const parsed = new Date(newDate);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ error: "INVALID_DATE_FORMAT" });
    }

    // Must not be in the past (compare against today at midnight UTC)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (parsed < today) {
      return res.status(400).json({ error: "DATE_IN_THE_PAST" });
    }

    // Find task first to make sure it exists
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: "TASK_NOT_FOUND" });
    }

    task.isDone = false;
    task.dueDate = parsed;
    task.postponedCount = (task.postponedCount || 0) + 1;
    await task.save();

    return res.json(task);
  } catch (err) {
    console.error("[tasks/postpone]", err);
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

module.exports = router;
