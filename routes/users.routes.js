const express = require("express");
const User = require("../models/user");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/search", requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json([]);

    const users = await User.find({
      $or: [{ username: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }]
    })
      .limit(20)
      .select("_id username email avatarType avatarInitials avatarUrl");

    res.json(
      users
        .filter(u => u._id.toString() !== req.userId)
        .map(u => ({
          id: u._id,
          username: u.username,
          email: u.email,
          avatarType: u.avatarType,
          avatarInitials: u.avatarInitials,
          avatarUrl: u.avatarUrl
        }))
    );
  } catch (e) { next(e); }
});

router.get("/suggestions", requireAuth, async (req, res, next) => {
  try {
    const me = req.userId;

    const users = await User.find({ _id: { $ne: me } })
      .sort({ createdAt: -1 })
      .limit(20)
      .select("_id username email avatarType avatarInitials avatarUrl");

    res.json(users.map(u => ({
      id: u._id,
      username: u.username,
      email: u.email,
      avatarType: u.avatarType,
      avatarInitials: u.avatarInitials,
      avatarUrl: u.avatarUrl
    })));
  } catch (e) { next(e); }
});

module.exports = router;