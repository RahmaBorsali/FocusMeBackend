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
// GET /api/feed/:userId?limit=20
// Returns a social feed of friend activity from the last 7 days.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100); // cap at 100

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: "INVALID_USER_ID" });
    }

    const uid = new mongoose.Types.ObjectId(userId);

    // 1 — Get friend IDs from Friendship collection
    const friendships = await Friendship.find({
      $or: [{ user1Id: uid }, { user2Id: uid }]
    }).lean();

    const friendIds = friendships.map(f =>
      f.user1Id.toString() === userId
        ? f.user2Id.toString()
        : f.user1Id.toString()
    );

    if (friendIds.length === 0) return res.json([]);

    // 2 — Fetch UserStats for those friends over the last 7 days
    //     Only keep meaningful stats (at least 30 min focus, 1 task, or 3-day streak)
    const sevenDaysAgo = dateNDaysAgo(7);

    const stats = await UserStats.find({
      userId: { $in: friendIds.map(id => new mongoose.Types.ObjectId(id.toString())) },
      date: { $gte: sevenDaysAgo },
      $or: [
        { focusMinutes: { $gte: 1 } },
        { tasksCompleted: { $gte: 1 } },
        { streak: { $gte: 2 } }
      ]
    })
      .sort({ updatedAt: -1 })
      .lean();

    if (stats.length === 0) return res.json([]);

    // 3 — Enrich with user info
    const uniqueUserIds = [...new Set(stats.map(s => s.userId.toString()))];
    const users = await User.find({ _id: { $in: uniqueUserIds } })
      .select("_id username avatarUrl")
      .lean();
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    // 4 — Generate FeedItems  (one stat record can produce multiple items)
    const feedItems = [];

    for (const stat of stats) {
      const user = userMap.get(stat.userId.toString());
      if (!user) continue;

      const friendName = user.username;
      const avatarUrl = user.avatarUrl || "";
      const base = {
        friendId: stat.userId,
        friendName,
        avatarUrl,
        timestamp: stat.updatedAt
      };

      if (stat.focusMinutes >= 1) {
        feedItems.push({
          ...base,
          actionType: "SESSION",
          value: stat.focusMinutes,
          message: `${friendName} a étudié ${stat.focusMinutes} min 📚`
        });
      }

      if (stat.tasksCompleted >= 1) {
        feedItems.push({
          ...base,
          actionType: "TASKS",
          value: stat.tasksCompleted,
          message: `${friendName} a complété ${stat.tasksCompleted} tâches ✅`
        });
      }

      if (stat.completedTaskTitles && stat.completedTaskTitles.length > 0) {
        stat.completedTaskTitles.forEach(title => {
          feedItems.push({
            ...base,
            actionType: "TASKS",
            value: 1,
            message: `${friendName} a complété ${title} ✅`
          });
        });
      }

      if (stat.streak >= 2) {
        feedItems.push({
          ...base,
          actionType: "STREAK",
          value: stat.streak,
          message: `${friendName} est en streak de ${stat.streak} jours 🔥`
        });
      }
    }

    // 5 — Sort by timestamp descending and apply limit
    feedItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const paginated = feedItems.slice(0, limit);

    return res.json(paginated);
  } catch (err) {
    console.error("[feed]", err);
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

module.exports = router;
