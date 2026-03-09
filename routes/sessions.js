const express = require("express");
const mongoose = require("mongoose");
const Session = require("../models/Session");
const Task = require("../models/Task");
const { syncStatsForSession } = require("../services/statsSync");

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sessions
//
// Body:
//   {
//     userId:          "ObjectId (string)",
//     durationMinutes: number,        // total focus time for this session
//     taskIds:         ["ObjectId"],  // optional — IDs of tasks linked to session
//     date:            "yyyy-MM-dd"   // optional — defaults to today UTC
//   }
//
// Behaviour:
//   1. Saves the session document
//   2. Auto-syncs UserStats:
//      - focusMinutes  += durationMinutes
//      - sessionsCount += 1
//      - tasksCompleted += count of linked tasks with isDone: true
//   3. Recalculates and saves today's streak:
//      - If UserStats exists for yesterday → streak = yesterday.streak + 1
//      - Otherwise                          → streak = 1
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { userId, durationMinutes, taskIds = [], completedTaskTitles: bodyTitles = [], date } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: "INVALID_USER_ID" });
    }

    const parsedDuration = Number(durationMinutes);
    if (isNaN(parsedDuration) || parsedDuration < 0) {
      return res.status(400).json({ error: "INVALID_DURATION_MINUTES" });
    }
    // Resolve date — use provided date or default to today UTC
    let sessionDate = date;
    if (!sessionDate) {
      sessionDate = new Date().toISOString().slice(0, 10);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
      return res.status(400).json({ error: "INVALID_DATE_FORMAT — expected yyyy-MM-dd" });
    }

    // Validate taskIds if provided
    const validTaskIds = (Array.isArray(taskIds) ? taskIds : [])
      .filter(id => mongoose.isValidObjectId(id))
      .map(id => new mongoose.Types.ObjectId(id));

    // ── 1. Save the session ───────────────────────────────────────────────────
    const session = await Session.create({
      userId: new mongoose.Types.ObjectId(userId),
      durationMinutes: parsedDuration,
      taskIds: validTaskIds,
      date: sessionDate
    });

    // ── 2. Get completed tasks details ────────────────────────────────────────
    let tasksCompletedForSync = 0;
    let completedTaskTitles = [];

    // Use titles from body if available
    if (Array.isArray(bodyTitles) && bodyTitles.length > 0) {
      completedTaskTitles = [...bodyTitles];
    }

    // Also fetch titles from taskIds if provided (merging and removing duplicates)
    if (validTaskIds.length > 0) {
      const completedTasks = await Task.find({
        _id: { $in: validTaskIds },
        isDone: true
      }).select("title");
      
      const dbTitles = completedTasks.map(t => t.title);
      // Merge with body titles (Set to avoid exact duplicates)
      completedTaskTitles = Array.from(new Set([...completedTaskTitles, ...dbTitles]));
    }

    tasksCompletedForSync = completedTaskTitles.length;


    // ── 3. Auto-sync UserStats (fire-and-forget with error logging) ───────────
    let updatedStats = null;
    try {
      updatedStats = await syncStatsForSession({
        userId,
        date: sessionDate,
        focusMinutes: parsedDuration,
        tasksCompleted: tasksCompletedForSync,
        completedTaskTitles,
        sessionsCount: 1
      });
    } catch (statsErr) {
      // Stats sync failure should NOT block the session response
      console.error("[sessions/post] stats sync failed:", statsErr.message);
    }

    return res.status(201).json({
      session,
      stats: updatedStats
    });
  } catch (err) {
    console.error("[sessions/post]", err);
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sessions/user/:userId
// Returns all sessions for a given user, sorted by most recent first.
// Optional query param: ?date=yyyy-MM-dd to filter by a specific day.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { date } = req.query;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: "INVALID_USER_ID" });
    }

    const query = { userId: new mongoose.Types.ObjectId(userId) };
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "INVALID_DATE_FORMAT — expected yyyy-MM-dd" });
      }
      query.date = date;
    }

    const sessions = await Session.find(query).sort({ createdAt: -1 }).lean();
    return res.json(sessions);
  } catch (err) {
    console.error("[sessions/get-user]", err);
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

module.exports = router;
