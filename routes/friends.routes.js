const express = require("express");
const mongoose = require("mongoose");
const { requireAuth } = require("../middleware/auth");
const User = require("../models/user");
const FriendRequest = require("../models/FriendRequest");
const Friendship = require("../models/Friendship");

const router = express.Router();

function normalizePair(a, b) {
  return a.toString() < b.toString() ? [a, b] : [b, a];
}

// 1) send request
router.post("/request", requireAuth, async (req, res, next) => {
  try {
    const toUserId = String(req.body.toUserId || "");
    if (!mongoose.isValidObjectId(toUserId)) return res.status(400).json({ error: "INVALID_USER" });
    if (toUserId === req.userId) return res.status(400).json({ error: "CANNOT_ADD_SELF" });

    const target = await User.findById(toUserId).select("_id");
    if (!target) return res.status(404).json({ error: "USER_NOT_FOUND" });

    const [u1, u2] = normalizePair(req.userId, toUserId);
    const alreadyFriends = await Friendship.findOne({ user1Id: u1, user2Id: u2 });
    if (alreadyFriends) return res.status(409).json({ error: "ALREADY_FRIENDS" });

    const existingPending = await FriendRequest.findOne({
      fromUserId: req.userId,
      toUserId,
      status: "pending"
    });
    if (existingPending) return res.status(409).json({ error: "REQUEST_ALREADY_SENT" });

    // If there is incoming pending from other side, you can auto-accept (optional)
    const incoming = await FriendRequest.findOne({
      fromUserId: toUserId,
      toUserId: req.userId,
      status: "pending"
    });
    if (incoming) return res.status(409).json({ error: "YOU_HAVE_INCOMING_REQUEST" });

    const fr = await FriendRequest.create({ fromUserId: req.userId, toUserId, status: "pending" });
    return res.status(201).json({ id: fr._id, status: fr.status });
  } catch (e) { next(e); }
});

// 2) incoming requests
router.get("/requests/incoming", requireAuth, async (req, res, next) => {
  try {
    const reqs = await FriendRequest.find({ toUserId: req.userId, status: "pending" })
      .sort({ createdAt: -1 });

    // enrich with sender
    const fromIds = reqs.map(r => r.fromUserId);
    const users = await User.find({ _id: { $in: fromIds } })
      .select("_id username email avatarType avatarInitials avatarUrl");
    const map = new Map(users.map(u => [u._id.toString(), u]));

    res.json(reqs.map(r => {
      const u = map.get(r.fromUserId.toString());
      return {
        requestId: r._id,
        fromUser: u ? {
          id: u._id,
          username: u.username,
          email: u.email,
          avatarType: u.avatarType,
          avatarInitials: u.avatarInitials,
          avatarUrl: u.avatarUrl
        } : null,
        createdAt: r.createdAt
      };
    }));
  } catch (e) { next(e); }
});

// 3) outgoing requests
router.get("/requests/outgoing", requireAuth, async (req, res, next) => {
  try {
    const reqs = await FriendRequest.find({ fromUserId: req.userId, status: "pending" })
      .sort({ createdAt: -1 });

    const toIds = reqs.map(r => r.toUserId);
    const users = await User.find({ _id: { $in: toIds } })
      .select("_id username email avatarType avatarInitials avatarUrl");
    const map = new Map(users.map(u => [u._id.toString(), u]));

    res.json(reqs.map(r => {
      const u = map.get(r.toUserId.toString());
      return {
        requestId: r._id,
        toUser: u ? {
          id: u._id,
          username: u.username,
          email: u.email,
          avatarType: u.avatarType,
          avatarInitials: u.avatarInitials,
          avatarUrl: u.avatarUrl
        } : null,
        createdAt: r.createdAt
      };
    }));
  } catch (e) { next(e); }
});

// 4) accept
router.post("/requests/:id/accept", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const fr = await FriendRequest.findById(id);
    if (!fr) return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
    if (fr.toUserId.toString() !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
    if (fr.status !== "pending") return res.status(409).json({ error: "REQUEST_NOT_PENDING" });

    fr.status = "accepted";
    await fr.save();

    const [u1, u2] = normalizePair(fr.fromUserId, fr.toUserId);
    await Friendship.create({ user1Id: u1, user2Id: u2 }).catch(() => { /* ignore dup */ });

    return res.json({ ok: true });
  } catch (e) { next(e); }
});

// 5) reject
router.post("/requests/:id/reject", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const fr = await FriendRequest.findById(id);
    if (!fr) return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
    if (fr.toUserId.toString() !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
    if (fr.status !== "pending") return res.status(409).json({ error: "REQUEST_NOT_PENDING" });

    fr.status = "rejected";
    await fr.save();
    return res.json({ ok: true });
  } catch (e) { next(e); }
});

// 6) list friends
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const friendships = await Friendship.find({
      $or: [{ user1Id: req.userId }, { user2Id: req.userId }]
    });

    const friendIds = friendships.map(f =>
      f.user1Id.toString() === req.userId ? f.user2Id : f.user1Id
    );

    const friends = await User.find({ _id: { $in: friendIds } })
      .select("_id username email avatarType avatarInitials avatarUrl");

    res.json(friends.map(u => ({
      id: u._id,
      username: u.username,
      email: u.email,
      avatarType: u.avatarType,
      avatarInitials: u.avatarInitials,
      avatarUrl: u.avatarUrl
    })));
  } catch (e) { next(e); }
});

// 7) delete friend
router.delete("/:friendUserId", requireAuth, async (req, res, next) => {
  try {
    const friendUserId = String(req.params.friendUserId);
    if (!mongoose.isValidObjectId(friendUserId)) return res.status(400).json({ error: "INVALID_USER" });

    const [u1, u2] = normalizePair(req.userId, friendUserId);
    await Friendship.deleteOne({ user1Id: u1, user2Id: u2 });

    return res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;