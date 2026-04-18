const express = require("express");
const { z } = require("zod");

const User = require("../models/user");
const EmailToken = require("../models/EmailToken");
const PasswordResetToken = require("../models/PasswordResetToken");
const FriendRequest = require("../models/FriendRequest");
const Friendship = require("../models/Friendship");
const Task = require("../models/Task");
const Session = require("../models/Session");
const UserStats = require("../models/UserStats");
const DirectConversation = require("../models/DirectConversation");
const DirectMessage = require("../models/DirectMessage");
const Challenge = require("../models/Challenge");
const ChallengeInvite = require("../models/ChallengeInvite");
const ChallengeMessage = require("../models/ChallengeMessage");
const ChallengeParticipant = require("../models/ChallengeParticipant");
const { requireAuth } = require("../middleware/auth");
const { ApiError, pickUserDto } = require("../utils/api");
const { makeInitials } = require("../utils/initials");

const router = express.Router();

const profileUpdateSchema = z.object({
  username: z.string().trim().min(2, "Username must be at least 2 characters").max(50, "Username must be at most 50 characters").optional(),
  displayName: z.string().trim().min(2, "Display name must be at least 2 characters").max(80, "Display name must be at most 80 characters").optional(),
  studyGoal: z.string().trim().max(280, "Study goal must be at most 280 characters").optional(),
  avatarType: z.enum(["initials", "image"]).optional(),
  avatarUrl: z.string().trim().url("Avatar URL must be valid").or(z.literal("")).optional(),
  avatarInitials: z.string().trim().max(4, "Avatar initials must be at most 4 characters").optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided"
});

const avatarSchema = z.object({
  avatarType: z.enum(["initials", "image"]),
  avatarUrl: z.string().trim().url("Avatar URL must be valid").or(z.literal("")).optional(),
  avatarInitials: z.string().trim().max(4, "Avatar initials must be at most 4 characters").optional()
});

async function ensureUsernameAvailable(username, excludeUserId) {
  if (!username) return;

  const existing = await User.findOne({
    _id: { $ne: excludeUserId },
    usernameNormalized: username.trim().toLowerCase()
  })
    .select("_id")
    .lean();

  if (existing) {
    throw new ApiError(409, { message: "Username already in use" });
  }
}

async function getCurrentUser(userId) {
  const user = await User.findById(userId);
  if (!user || user.deletedAt) {
    throw new ApiError(404, { message: "Profile not found" });
  }
  return user;
}

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await getCurrentUser(req.userId);
    return res.json(pickUserDto(user));
  } catch (e) {
    next(e);
  }
});

router.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const data = profileUpdateSchema.parse(req.body);
    const user = await getCurrentUser(req.userId);

    if (data.username && data.username.trim().toLowerCase() !== user.usernameNormalized) {
      await ensureUsernameAvailable(data.username, user._id);
      user.username = data.username.trim();
    }

    if (typeof data.displayName === "string") {
      user.displayName = data.displayName.trim();
    }

    if (typeof data.studyGoal === "string") {
      user.studyGoal = data.studyGoal.trim();
    }

    if (data.avatarType) {
      user.avatarType = data.avatarType;
    }

    if (typeof data.avatarUrl === "string") {
      user.avatarUrl = data.avatarUrl;
    }

    if (typeof data.avatarInitials === "string") {
      user.avatarInitials = data.avatarInitials.toUpperCase();
    } else if (data.username || data.displayName) {
      user.avatarInitials = makeInitials(user.displayName || user.username);
    }

    await user.save();
    return res.json({
      message: "Profile updated successfully",
      user: pickUserDto(user)
    });
  } catch (e) {
    next(e);
  }
});

router.post("/avatar", requireAuth, async (req, res, next) => {
  try {
    const data = avatarSchema.parse(req.body);
    const user = await getCurrentUser(req.userId);

    user.avatarType = data.avatarType;
    user.avatarUrl = data.avatarType === "image" ? data.avatarUrl || "" : "";
    user.avatarInitials = data.avatarInitials
      ? data.avatarInitials.toUpperCase()
      : makeInitials(user.displayName || user.username);

    await user.save();
    return res.status(200).json({
      message: "Avatar updated successfully",
      user: pickUserDto(user)
    });
  } catch (e) {
    next(e);
  }
});

router.delete("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await getCurrentUser(req.userId);
    const createdChallengeIds = (await Challenge.find({ creatorId: user._id }).select("_id").lean()).map((item) => item._id);
    const conversationIds = (await DirectConversation.find({ participantIds: user._id }).select("_id").lean()).map((item) => item._id);

    await Promise.all([
      EmailToken.deleteMany({ userId: user._id }),
      PasswordResetToken.deleteMany({ userId: user._id }),
      FriendRequest.deleteMany({ $or: [{ fromUserId: user._id }, { toUserId: user._id }] }),
      Friendship.deleteMany({ $or: [{ user1Id: user._id }, { user2Id: user._id }] }),
      Task.deleteMany({ userId: user._id }),
      Session.deleteMany({ userId: user._id }),
      UserStats.deleteMany({ userId: user._id }),
      ChallengeInvite.deleteMany({ $or: [{ fromUserId: user._id }, { toUserId: user._id }, { challengeId: { $in: createdChallengeIds } }] }),
      ChallengeMessage.deleteMany({ $or: [{ userId: user._id }, { challengeId: { $in: createdChallengeIds } }] }),
      ChallengeParticipant.deleteMany({ $or: [{ userId: user._id }, { challengeId: { $in: createdChallengeIds } }] }),
      Challenge.deleteMany({ $or: [{ creatorId: user._id }, { _id: { $in: createdChallengeIds } }] }),
      DirectMessage.deleteMany({ $or: [{ senderId: user._id }, { recipientId: user._id }, { conversationId: { $in: conversationIds } }] }),
      DirectConversation.deleteMany({ participantIds: user._id }),
      User.deleteOne({ _id: user._id })
    ]);

    return res.status(200).json({ message: "Account deleted successfully" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
