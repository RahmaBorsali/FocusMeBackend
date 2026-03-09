const express = require("express");
const mongoose = require("mongoose");
const UserStats = require("../models/UserStats");
const Friendship = require("../models/Friendship");
const User = require("../models/user");

const router = express.Router();

// Helper — returns "yyyy-MM-dd" string N days ago (UTC)
function dateNDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/stats/sync
// Body: { userId, date, focusMinutes, sessionsCount, tasksCompleted, streak }
// Upserts the daily UserStats record, accumulating values with $inc.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/sync", async (req, res) => {
  try {
    const { userId, date, focusMinutes, sessionsCount, tasksCompleted, streak } = req.body;

    // Validate required fields
    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: "INVALID_USER_ID" });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "INVALID_DATE_FORMAT — expected yyyy-MM-dd" });
    }

    // Accumulate numeric fields; streak is always overwritten with the latest value
    const stat = await UserStats.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId), date },
      {
        $inc: {
          focusMinutes: Number(focusMinutes) || 0,
          sessionsCount: Number(sessionsCount) || 0,
          tasksCompleted: Number(tasksCompleted) || 0
        },
        $set: {
          streak: Number(streak) || 0,
          updatedAt: new Date()
        }
      },
      { upsert: true, new: true, runValidators: true }
    );

    return res.json(stat);
  } catch (err) {
    console.error("[stats/sync]", err);
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stats/friends/:userId
// Returns a weekly leaderboard of the user's friends.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/friends/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: "INVALID_USER_ID" });
    }

    const uid = new mongoose.Types.ObjectId(userId);

    // 1 — Retrieve friend IDs from the Friendship collection
    const friendships = await Friendship.find({
      $or: [{ user1Id: uid }, { user2Id: uid }]
    }).lean();

    const friendIds = friendships.map(f =>
      f.user1Id.toString() === userId
        ? f.user2Id.toString()
        : f.user1Id.toString()
    );

    // 2 — Aggregate statistics for the last 7 days
    const sevenDaysAgo = dateNDaysAgo(7);

    // 2a — Friends aggregation
    let friendsResult = [];
    if (friendIds.length > 0) {
      const friendsAgg = await UserStats.aggregate([
        {
          $match: {
            userId: { $in: friendIds.map(id => new mongoose.Types.ObjectId(id.toString())) },
            date: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: "$userId",
            weeklyFocusMin: { $sum: "$focusMinutes" },
            tasksThisWeek: { $sum: "$tasksCompleted" },
            streak: { $max: "$streak" }
          }
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user"
          }
        },
        { $unwind: "$user" }
      ]);

      friendsResult = friendsAgg.map(item => ({
        userId: item._id,
        name: item.user.username,
        avatarUrl: item.user.avatarUrl || "",
        weeklyFocusMin: item.weeklyFocusMin,
        tasksThisWeek: item.tasksThisWeek,
        streak: item.streak,
        isCurrentUser: false
      }));
    }

    // 2b — Self aggregation
    const selfAgg = await UserStats.aggregate([
      {
        $match: {
          userId: uid,
          date: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: "$userId",
          weeklyFocusMin: { $sum: "$focusMinutes" },
          tasksThisWeek: { $sum: "$tasksCompleted" },
          streak: { $max: "$streak" }
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user"
        }
      },
      { $unwind: "$user" }
    ]);

    const selfResult = selfAgg.map(item => ({
      userId: item._id,
      name: item.user.username,
      avatarUrl: item.user.avatarUrl || "",
      weeklyFocusMin: item.weeklyFocusMin,
      tasksThisWeek: item.tasksThisWeek,
      streak: item.streak,
      isCurrentUser: true
    }));

    // 3 — Merge, sort, and rank
    const merged = [...friendsResult, ...selfResult]
      .sort((a, b) => b.weeklyFocusMin - a.weeklyFocusMin)
      .map((item, index) => ({
        ...item,
        rank: index + 1
      }));

    return res.json(merged);
  } catch (err) {
    console.error("[stats/friends]", err);
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

module.exports = router;