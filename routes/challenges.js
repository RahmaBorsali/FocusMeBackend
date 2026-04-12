const express = require("express");
const mongoose = require("mongoose");
const { requireAuth } = require("../middleware/auth");
const Challenge = require("../models/Challenge");
const ChallengeParticipant = require("../models/ChallengeParticipant");
const UserStats = require("../models/UserStats");
const User = require("../models/user");
const Friendship = require("../models/Friendship");
const ChallengeMessage = require("../models/ChallengeMessage");
const ChallengeInvite = require("../models/ChallengeInvite");

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const JOIN_CODE_RE = /^[A-Z2-9]{6,12}$/;
const GOAL_TYPES = ["focus_minutes", "sessions_count", "tasks_completed"];
const VISIBILITIES = ["public", "private", "friends"];

function isDateStr(value) {
  return typeof value === "string" && DATE_RE.test(value);
}

function normalizeObjectId(value) {
  return value && value.toString ? value.toString() : String(value || "");
}

function normalizePair(a, b) {
  return normalizeObjectId(a) < normalizeObjectId(b) ? [a, b] : [b, a];
}

function normalizeJoinCode(code) {
  return String(code || "").trim().toUpperCase();
}

function isTruthyFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "oui", "on"].includes(normalized);
}

function generateJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function getChallengeStatus(challenge, today = getToday()) {
  if (today < challenge.startDate) return "upcoming";
  if (today > challenge.endDate) return "finished";
  return "ongoing";
}

function getGoalType(challenge) {
  return GOAL_TYPES.includes(challenge.goalType) ? challenge.goalType : "focus_minutes";
}

function getTargetValue(challenge) {
  const targetValue = Number(challenge.targetValue);
  if (targetValue > 0) return targetValue;
  const legacyGoal = Number(challenge.goalMinutes);
  return legacyGoal > 0 ? legacyGoal : 0;
}

function getGoalLabel(goalType) {
  if (goalType === "sessions_count") return "sessions";
  if (goalType === "tasks_completed") return "tasks";
  return "minutes";
}

function getMembershipStatus({ isOwner = false, isJoined = false, myJoinRequest = null } = {}) {
  if (isOwner) return "owner";
  if (isJoined) return "joined";
  if (myJoinRequest && myJoinRequest.status === "pending") return "pending_request";
  return "not_joined";
}

function getLeaderboardValue(row, goalType) {
  if (goalType === "sessions_count") return row.sessionsCount || 0;
  if (goalType === "tasks_completed") return row.tasksCompleted || 0;
  return row.focusMinutes || 0;
}

function clampText(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

function isNil(value) {
  return typeof value === "undefined" || value === null;
}

function isBlank(value) {
  return isNil(value) || String(value).trim() === "";
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.round(num);
}

function normalizeIntegerInput(value, { partial = false, defaultValue, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (isBlank(value)) {
    return partial ? { omitted: true } : { value: defaultValue };
  }

  const normalized = toPositiveInt(value, -1);
  if (normalized < min || normalized > max) {
    return { error: true };
  }

  return { value: normalized };
}

function mapChallengeValidationError(errorCode) {
  if (["INVALID_START_DATE", "INVALID_END_DATE", "INVALID_DATE_RANGE"].includes(errorCode)) {
    return "INVALID_DATES";
  }
  if (["INVALID_TARGET_VALUE", "INVALID_GOAL_MINUTES"].includes(errorCode)) {
    return "INVALID_TARGET";
  }
  if (errorCode === "INVALID_MAX_PARTICIPANTS") {
    return "INVALID_MAX_PARTICIPANTS";
  }
  return errorCode;
}

async function generateUniqueJoinCode() {
  for (let i = 0; i < 10; i += 1) {
    const code = generateJoinCode();
    const existing = await Challenge.findOne({ joinCode: code }).select("_id").lean();
    if (!existing) return code;
  }
  throw new Error("JOIN_CODE_GENERATION_FAILED");
}

async function areFriends(a, b) {
  const found = await Friendship.findOne({
    $or: [
      { user1Id: a, user2Id: b },
      { user1Id: b, user2Id: a }
    ]
  }).lean();
  return !!found;
}


async function ensureChallengeExists(id) {
  if (!mongoose.isValidObjectId(id)) {
    return { error: { status: 400, body: { error: "INVALID_ID" } } };
  }
  const challenge = await Challenge.findById(id);
  if (!challenge) {
    return { error: { status: 404, body: { error: "NOT_FOUND" } } };
  }
  return { challenge };
}

async function getChallengeAccess(challenge, userId) {
  const isOwner = normalizeObjectId(challenge.creatorId) === userId;
  const participant = await ChallengeParticipant.findOne({
    challengeId: challenge._id,
    userId,
    status: "active"
  }).lean();
  const isParticipant = !!participant;

  if (challenge.visibility === "public" || isOwner || isParticipant) {
    return { allowed: true, isOwner, isParticipant };
  }

  if (challenge.visibility === "friends") {
    const friend = await areFriends(challenge.creatorId, userId);
    return { allowed: friend, isOwner, isParticipant };
  }

  return { allowed: false, isOwner, isParticipant };
}

async function getParticipantDocs(challengeId) {
  return ChallengeParticipant.find({ challengeId, status: "active" }).lean();
}

async function getParticipantCount(challengeId) {
  return ChallengeParticipant.countDocuments({ challengeId, status: "active" });
}

async function getParticipantCountMap(challengeIds) {
  if (challengeIds.length === 0) return new Map();
  const counts = await ChallengeParticipant.aggregate([
    { $match: { challengeId: { $in: challengeIds }, status: "active" } },
    { $group: { _id: "$challengeId", count: { $sum: 1 } } }
  ]);
  return new Map(counts.map((item) => [normalizeObjectId(item._id), item.count]));
}

async function getPendingJoinRequest(challengeId, userId, ownerId) {
  if (!challengeId || !userId || !ownerId || userId === normalizeObjectId(ownerId)) return null;

  return ChallengeInvite.findOne({
    challengeId,
    fromUserId: userId,
    toUserId: ownerId,
    kind: "join_request",
    status: "pending"
  })
    .select("_id status requestType")
    .lean();
}

async function getPendingJoinRequestMap(challengeIds, userId) {
  if (!challengeIds.length) return new Map();

  const requests = await ChallengeInvite.find({
    challengeId: { $in: challengeIds },
    fromUserId: userId,
    kind: "join_request",
    status: "pending"
  })
    .select("_id challengeId status requestType")
    .lean();

  return new Map(requests.map((request) => [normalizeObjectId(request.challengeId), request]));
}

function getJoinRequestType(request) {
  return request && request.requestType === "request_access" ? "request_access" : "join";
}

async function createOrRefreshJoinRequest({
  challengeId,
  fromUserId,
  toUserId,
  requestType = "join"
}) {
  return ChallengeInvite.findOneAndUpdate(
    {
      challengeId,
      fromUserId,
      toUserId,
      kind: "join_request"
    },
    {
      $set: {
        status: "pending",
        requestType,
        createdAt: new Date(),
        decisionAt: null
      }
    },
    { upsert: true, new: true }
  );
}

async function resolveChallengeInvites(filter, status) {
  return ChallengeInvite.updateMany(
    {
      ...filter,
      status: "pending"
    },
    {
      $set: {
        status,
        decisionAt: new Date()
      }
    }
  );
}

function serializeChallenge(challenge, options = {}) {
  const today = options.today || getToday();
  const participantsCount = options.participantsCount || 0;
  const goalType = getGoalType(challenge);
  const targetValue = getTargetValue(challenge);
  const isOwner = options.viewerUserId && normalizeObjectId(challenge.creatorId) === options.viewerUserId;
  const myJoinRequest = options.myJoinRequest || null;
  const isJoined = Boolean(options.isJoined || isOwner);

  return {
    id: challenge._id,
    title: challenge.title,
    description: challenge.description || "",
    creatorId: challenge.creatorId,
    startDate: challenge.startDate,
    endDate: challenge.endDate,
    visibility: challenge.visibility,
    status: getChallengeStatus(challenge, today),
    participantsCount,
    maxParticipants: Number(challenge.maxParticipants) || 20,
    goal: {
      type: goalType,
      targetValue,
      unit: getGoalLabel(goalType)
    },
    goalMinutes: Number(challenge.goalMinutes) || 0,
    joinCode: isOwner ? challenge.joinCode : null,
    joined: isJoined,
    membershipStatus: getMembershipStatus({ isOwner, isJoined, myJoinRequest }),
    myJoinRequestStatus: myJoinRequest ? myJoinRequest.status : null,
    myJoinRequestId: myJoinRequest ? myJoinRequest._id : null,
    myJoinRequestType: myJoinRequest ? getJoinRequestType(myJoinRequest) : null,
    createdAt: challenge.createdAt,
    updatedAt: challenge.updatedAt
  };
}

function validateChallengePayload(body, { partial = false } = {}) {
  const errors = [];
  const updates = {};

  if (!partial || Object.prototype.hasOwnProperty.call(body, "title")) {
    const title = clampText(body.title, 80);
    if (!title || title.length < 3) errors.push("INVALID_TITLE");
    else updates.title = title;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "description")) {
    updates.description = clampText(body.description, 280);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "startDate")) {
    if (!isDateStr(body.startDate)) errors.push("INVALID_START_DATE");
    else updates.startDate = body.startDate;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "endDate")) {
    if (!isDateStr(body.endDate)) errors.push("INVALID_END_DATE");
    else updates.endDate = body.endDate;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "visibility")) {
    const visibility = typeof body.visibility === "undefined"
      ? (partial ? undefined : "private")
      : (VISIBILITIES.includes(body.visibility) ? body.visibility : null);
    if (!visibility) errors.push("INVALID_VISIBILITY");
    else if (typeof visibility !== "undefined") updates.visibility = visibility;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "goalType")) {
    const goalType = typeof body.goalType === "undefined"
      ? (partial ? undefined : "focus_minutes")
      : (GOAL_TYPES.includes(body.goalType) ? body.goalType : null);
    if (!goalType) errors.push("INVALID_GOAL_TYPE");
    else if (typeof goalType !== "undefined") updates.goalType = goalType;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "targetValue")) {
    const targetValueResult = normalizeIntegerInput(body.targetValue, {
      partial,
      defaultValue: 0,
      min: 0
    });
    if (targetValueResult.error) errors.push("INVALID_TARGET_VALUE");
    else if (!targetValueResult.omitted) updates.targetValue = targetValueResult.value;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "goalMinutes")) {
    const goalMinutesResult = normalizeIntegerInput(body.goalMinutes, {
      partial,
      defaultValue: 0,
      min: 0
    });
    if (goalMinutesResult.error) errors.push("INVALID_GOAL_MINUTES");
    else if (!goalMinutesResult.omitted) updates.goalMinutes = goalMinutesResult.value;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "maxParticipants")) {
    const maxParticipantsResult = normalizeIntegerInput(body.maxParticipants, {
      partial,
      defaultValue: 20,
      min: 2,
      max: 200
    });
    if (maxParticipantsResult.error) errors.push("INVALID_MAX_PARTICIPANTS");
    else if (!maxParticipantsResult.omitted) updates.maxParticipants = maxParticipantsResult.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "joinCode")) {
    const joinCode = normalizeJoinCode(body.joinCode);
    if (joinCode && !JOIN_CODE_RE.test(joinCode)) errors.push("INVALID_JOIN_CODE");
    else updates.joinCode = joinCode || null;
  }

  if (updates.startDate && updates.endDate && new Date(updates.endDate) < new Date(updates.startDate)) {
    errors.push("INVALID_DATE_RANGE");
  }

  return { errors, updates };
}

async function buildLeaderboard(challenge) {
  const participants = await getParticipantDocs(challenge._id);
  if (participants.length === 0) return [];

  const userIds = participants.map((part) => part.userId);
  const goalType = getGoalType(challenge);
  const targetValue = getTargetValue(challenge);
  const statsRows = await UserStats.aggregate([
    {
      $match: {
        userId: { $in: userIds },
        date: { $gte: challenge.startDate, $lte: challenge.endDate }
      }
    },
    {
      $group: {
        _id: "$userId",
        focusMinutes: { $sum: "$focusMinutes" },
        sessionsCount: { $sum: "$sessionsCount" },
        tasksCompleted: { $sum: "$tasksCompleted" },
        streak: { $max: "$streak" }
      }
    }
  ]);

  const statsMap = new Map(statsRows.map((row) => [normalizeObjectId(row._id), row]));
  const users = await User.find({ _id: { $in: userIds } }).select("_id username avatarUrl").lean();
  const usersMap = new Map(users.map((user) => [normalizeObjectId(user._id), user]));

  return participants
    .map((part) => {
      const userId = normalizeObjectId(part.userId);
      const stats = statsMap.get(userId) || {};
      const user = usersMap.get(userId);
      const score = getLeaderboardValue(stats, goalType);

      return {
        userId: part.userId,
        username: user ? user.username : "",
        avatarUrl: user ? user.avatarUrl || "" : "",
        joinedAt: part.joinedAt,
        focusMinutes: stats.focusMinutes || 0,
        sessionsCount: stats.sessionsCount || 0,
        tasksCompleted: stats.tasksCompleted || 0,
        streak: stats.streak || 0,
        score,
        progress: targetValue > 0 ? Math.min(100, Math.round((score / targetValue) * 100)) : null
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.focusMinutes !== a.focusMinutes) return b.focusMinutes - a.focusMinutes;
      return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

async function createChallengeWithJoinCode(challengeData, { hasCustomJoinCode = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await Challenge.create(challengeData);
    } catch (err) {
      const isJoinCodeConflict = err && err.code === 11000 && err.keyPattern && err.keyPattern.joinCode;
      if (!isJoinCodeConflict) throw err;
      if (hasCustomJoinCode) {
        const customCodeError = new Error("JOIN_CODE_ALREADY_EXISTS");
        customCodeError.statusCode = 409;
        throw customCodeError;
      }
      challengeData.joinCode = await generateUniqueJoinCode();
    }
  }

  throw new Error("JOIN_CODE_GENERATION_FAILED");
}

router.post("/", requireAuth, async (req, res) => {
  try {
    const { errors, updates } = validateChallengePayload(req.body || {});
    if (errors.length) {
      return res.status(400).json({ error: mapChallengeValidationError(errors[0]) });
    }

    const challengeData = {
      ...updates,
      creatorId: req.userId
    };
    const hasCustomJoinCode = Boolean(challengeData.joinCode);

    if (challengeData.targetValue === 0 && challengeData.goalMinutes > 0) {
      challengeData.targetValue = challengeData.goalMinutes;
    }
    if (challengeData.goalMinutes === 0 && challengeData.goalType === "focus_minutes") {
      challengeData.goalMinutes = challengeData.targetValue;
    }

    challengeData.joinCode = challengeData.joinCode || await generateUniqueJoinCode();

    const challenge = await createChallengeWithJoinCode(challengeData, { hasCustomJoinCode });
    await ChallengeParticipant.updateOne(
      { challengeId: challenge._id, userId: req.userId },
      { $set: { status: "active", joinedAt: new Date() } },
      { upsert: true }
    );

    return res.status(201).json({
      ...serializeChallenge(challenge.toObject(), {
        today: getToday(),
        participantsCount: 1,
        viewerUserId: req.userId,
        isJoined: true
      }),
      myRole: "owner"
    });
  } catch (err) {
    if (err && err.name === "ValidationError") {
      const firstField = Object.keys(err.errors || {})[0] || "";
      const fieldMap = {
        title: "INVALID_TITLE",
        startDate: "INVALID_DATES",
        endDate: "INVALID_DATES",
        goalType: "INVALID_GOAL_TYPE",
        targetValue: "INVALID_TARGET",
        goalMinutes: "INVALID_TARGET",
        visibility: "INVALID_VISIBILITY",
        maxParticipants: "INVALID_MAX_PARTICIPANTS",
        joinCode: "INVALID_JOIN_CODE"
      };
      return res.status(400).json({ error: fieldMap[firstField] || "INVALID_CHALLENGE_PAYLOAD" });
    }
    if (err && err.message === "JOIN_CODE_ALREADY_EXISTS") {
      return res.status(409).json({ error: "JOIN_CODE_ALREADY_EXISTS" });
    }
    if (err && err.message === "JOIN_CODE_GENERATION_FAILED") {
      return res.status(500).json({ error: "JOIN_CODE_GENERATION_FAILED" });
    }
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/discover", requireAuth, async (req, res) => {
  try {
    const today = getToday();
    const list = await Challenge.find({
      visibility: "public",
      endDate: { $gte: today }
    }).sort({ startDate: 1, createdAt: -1 }).lean();

    const countMap = await getParticipantCountMap(list.map((item) => item._id));
    return res.json(
      list.map((challenge) =>
        serializeChallenge(challenge, {
          today,
          participantsCount: countMap.get(normalizeObjectId(challenge._id)) || 0,
          viewerUserId: req.userId
        })
      )
    );
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const today = getToday();
    const parts = await ChallengeParticipant.find({ userId: req.userId, status: "active" }).lean();
    const challengeIds = parts.map((part) => part.challengeId);
    if (challengeIds.length === 0) return res.json([]);

    const [challenges, countMap] = await Promise.all([
      Challenge.find({ _id: { $in: challengeIds } }).sort({ createdAt: -1 }).lean(),
      getParticipantCountMap(challengeIds)
    ]);

    return res.json(
      challenges.map((challenge) =>
        serializeChallenge(challenge, {
          today,
          participantsCount: countMap.get(normalizeObjectId(challenge._id)) || 0,
          viewerUserId: req.userId,
          isJoined: true
        })
      )
    );
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/friends", requireAuth, async (req, res) => {
  try {
    const me = new mongoose.Types.ObjectId(req.userId);
    const friendships = await Friendship.find({
      $or: [{ user1Id: me }, { user2Id: me }]
    }).lean();
    const friendIds = friendships.map((item) =>
      normalizeObjectId(item.user1Id) === req.userId ? item.user2Id : item.user1Id
    );
    if (friendIds.length === 0) return res.json([]);

    const today = getToday();
    const list = await Challenge.find({
      creatorId: { $in: friendIds },
      visibility: { $in: ["public", "friends"] },
      endDate: { $gte: today }
    }).sort({ startDate: 1, createdAt: -1 }).lean();

    const [countMap, myParticipants, pendingRequestMap] = await Promise.all([
      getParticipantCountMap(list.map((item) => item._id)),
      ChallengeParticipant.find({
        userId: req.userId,
        challengeId: { $in: list.map((item) => item._id) },
        status: "active"
      }).lean(),
      getPendingJoinRequestMap(list.map((item) => item._id), req.userId)
    ]);

    const joinedSet = new Set(myParticipants.map((item) => normalizeObjectId(item.challengeId)));
    return res.json(
      list.map((challenge) => ({
        ...serializeChallenge(challenge, {
          today,
          participantsCount: countMap.get(normalizeObjectId(challenge._id)) || 0,
          viewerUserId: req.userId,
          myJoinRequest: pendingRequestMap.get(normalizeObjectId(challenge._id)) || null,
          isJoined: joinedSet.has(normalizeObjectId(challenge._id))
        }),
        joined: joinedSet.has(normalizeObjectId(challenge._id))
      }))
    );
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/invitations/incoming", requireAuth, async (req, res) => {
  try {
    const invites = await ChallengeInvite.find({
      toUserId: req.userId,
      kind: "invite",
      status: "pending"
    }).sort({ createdAt: -1 }).lean();
    if (invites.length === 0) return res.json([]);

    const challengeIds = invites.map((invite) => invite.challengeId);
    const fromUserIds = invites.map((invite) => invite.fromUserId);
    const [challenges, users, counts] = await Promise.all([
      Challenge.find({ _id: { $in: challengeIds } }).lean(),
      User.find({ _id: { $in: fromUserIds } }).select("_id username avatarUrl").lean(),
      getParticipantCountMap(challengeIds)
    ]);

    const challengeMap = new Map(challenges.map((item) => [normalizeObjectId(item._id), item]));
    const userMap = new Map(users.map((item) => [normalizeObjectId(item._id), item]));
    const today = getToday();

    return res.json(
      invites.map((invite) => {
        const challenge = challengeMap.get(normalizeObjectId(invite.challengeId));
        const fromUser = userMap.get(normalizeObjectId(invite.fromUserId));
        if (!challenge) return null;

        return {
          id: invite._id,
          challengeId: invite.challengeId,
          kind: invite.kind,
          status: invite.status,
          createdAt: invite.createdAt,
          decisionAt: invite.decisionAt || null,
          fromUser: fromUser ? { id: fromUser._id, username: fromUser.username, avatarUrl: fromUser.avatarUrl || "" } : null,
          challenge: serializeChallenge(challenge, {
            today,
            participantsCount: counts.get(normalizeObjectId(challenge._id)) || 0,
            viewerUserId: req.userId
          })
        };
      }).filter(Boolean)
    );
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/invitations/outgoing", requireAuth, async (req, res) => {
  try {
    const invites = await ChallengeInvite.find({
      fromUserId: req.userId,
      kind: "invite",
      status: "pending"
    }).sort({ createdAt: -1 }).lean();
    if (invites.length === 0) return res.json([]);

    const challengeIds = invites.map((invite) => invite.challengeId);
    const toUserIds = invites.map((invite) => invite.toUserId);
    const [challenges, users, counts] = await Promise.all([
      Challenge.find({ _id: { $in: challengeIds } }).lean(),
      User.find({ _id: { $in: toUserIds } }).select("_id username avatarUrl").lean(),
      getParticipantCountMap(challengeIds)
    ]);

    const challengeMap = new Map(challenges.map((item) => [normalizeObjectId(item._id), item]));
    const userMap = new Map(users.map((item) => [normalizeObjectId(item._id), item]));
    const today = getToday();

    return res.json(
      invites.map((invite) => {
        const challenge = challengeMap.get(normalizeObjectId(invite.challengeId));
        const toUser = userMap.get(normalizeObjectId(invite.toUserId));
        if (!challenge) return null;

        return {
          id: invite._id,
          challengeId: invite.challengeId,
          kind: invite.kind,
          status: invite.status,
          createdAt: invite.createdAt,
          decisionAt: invite.decisionAt || null,
          toUser: toUser ? { id: toUser._id, username: toUser.username, avatarUrl: toUser.avatarUrl || "" } : null,
          challenge: serializeChallenge(challenge, {
            today,
            participantsCount: counts.get(normalizeObjectId(challenge._id)) || 0,
            viewerUserId: req.userId
          })
        };
      }).filter(Boolean)
    );
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/code/:code", requireAuth, async (req, res) => {
  try {
    const code = normalizeJoinCode(req.params.code);
    if (!JOIN_CODE_RE.test(code)) return res.status(400).json({ error: "INVALID_CODE" });

    const challenge = await Challenge.findOne({ joinCode: code }).lean();
    if (!challenge) return res.status(404).json({ error: "NOT_FOUND" });
    const [participantsCount, myJoinRequest, activePart] = await Promise.all([
      getParticipantCount(challenge._id),
      getPendingJoinRequest(challenge._id, req.userId, challenge.creatorId),
      ChallengeParticipant.findOne({
        challengeId: challenge._id,
        userId: req.userId,
        status: "active"
      }).lean()
    ]);
    return res.json(
      serializeChallenge(challenge, {
        today: getToday(),
        participantsCount,
        viewerUserId: req.userId,
        myJoinRequest,
        isJoined: Boolean(activePart) || normalizeObjectId(challenge.creatorId) === req.userId
      })
    );
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/requests/incoming", requireAuth, async (req, res) => {
  try {
    const requests = await ChallengeInvite.find({
      toUserId: req.userId,
      kind: "join_request",
      status: "pending"
    }).sort({ createdAt: -1 }).lean();
    if (requests.length === 0) return res.json([]);

    const challengeIds = requests.map((item) => item.challengeId);
    const fromUserIds = requests.map((item) => item.fromUserId);
    const [challenges, users, counts] = await Promise.all([
      Challenge.find({ _id: { $in: challengeIds } }).lean(),
      User.find({ _id: { $in: fromUserIds } }).select("_id username avatarUrl").lean(),
      getParticipantCountMap(challengeIds)
    ]);

    const challengeMap = new Map(challenges.map((item) => [normalizeObjectId(item._id), item]));
    const userMap = new Map(users.map((item) => [normalizeObjectId(item._id), item]));
    const today = getToday();

    return res.json(
      requests.map((request) => {
        const challenge = challengeMap.get(normalizeObjectId(request.challengeId));
        const fromUser = userMap.get(normalizeObjectId(request.fromUserId));
        if (!challenge) return null;

        return {
          id: request._id,
          challengeId: request.challengeId,
          kind: request.kind,
          requestType: getJoinRequestType(request),
          status: request.status,
          createdAt: request.createdAt,
          decisionAt: request.decisionAt || null,
          fromUser: fromUser ? { id: fromUser._id, username: fromUser.username, avatarUrl: fromUser.avatarUrl || "" } : null,
          challenge: serializeChallenge(challenge, {
            today,
            participantsCount: counts.get(normalizeObjectId(challenge._id)) || 0,
            viewerUserId: req.userId
          })
        };
      }).filter(Boolean)
    );
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/requests/outgoing", requireAuth, async (req, res) => {
  try {
    const requests = await ChallengeInvite.find({
      fromUserId: req.userId,
      kind: "join_request",
      status: "pending"
    }).sort({ createdAt: -1 }).lean();
    if (requests.length === 0) return res.json([]);

    const challengeIds = requests.map((item) => item.challengeId);
    const toUserIds = requests.map((item) => item.toUserId);
    const [challenges, users, counts] = await Promise.all([
      Challenge.find({ _id: { $in: challengeIds } }).lean(),
      User.find({ _id: { $in: toUserIds } }).select("_id username avatarUrl").lean(),
      getParticipantCountMap(challengeIds)
    ]);

    const challengeMap = new Map(challenges.map((item) => [normalizeObjectId(item._id), item]));
    const userMap = new Map(users.map((item) => [normalizeObjectId(item._id), item]));
    const today = getToday();

    return res.json(
      requests.map((request) => {
        const challenge = challengeMap.get(normalizeObjectId(request.challengeId));
        const owner = userMap.get(normalizeObjectId(request.toUserId));
        if (!challenge) return null;

        return {
          id: request._id,
          challengeId: request.challengeId,
          kind: request.kind,
          requestType: getJoinRequestType(request),
          status: request.status,
          createdAt: request.createdAt,
          decisionAt: request.decisionAt || null,
          owner: owner ? { id: owner._id, username: owner.username, avatarUrl: owner.avatarUrl || "" } : null,
          challenge: serializeChallenge(challenge, {
            today,
            participantsCount: counts.get(normalizeObjectId(challenge._id)) || 0,
            viewerUserId: req.userId
          })
        };
      }).filter(Boolean)
    );
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    const access = await getChallengeAccess(challenge, req.userId);
    if (!access.allowed) return res.status(403).json({ error: "FORBIDDEN" });

    const [participantsCount, myJoinRequest] = await Promise.all([
      getParticipantCount(challenge._id),
      getPendingJoinRequest(challenge._id, req.userId, challenge.creatorId)
    ]);
    return res.json({
      ...serializeChallenge(challenge.toObject(), {
        today: getToday(),
        participantsCount,
        viewerUserId: req.userId,
        myJoinRequest,
        isJoined: access.isOwner || access.isParticipant
      }),
      myRole: access.isOwner ? "owner" : access.isParticipant ? "participant" : "viewer"
    });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/:id/overview", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    const access = await getChallengeAccess(challenge, req.userId);
    if (!access.allowed) return res.status(403).json({ error: "FORBIDDEN" });

    const [participantsCount, leaderboard, messages, pendingJoinRequestsCount, pendingInvitationsCount, myJoinRequest] = await Promise.all([
      getParticipantCount(challenge._id),
      buildLeaderboard(challenge),
      ChallengeMessage.find({ challengeId: challenge._id }).sort({ createdAt: -1 }).limit(5).lean(),
      access.isOwner
        ? ChallengeInvite.countDocuments({ challengeId: challenge._id, status: "pending", kind: "join_request" })
        : Promise.resolve(0),
      access.isOwner
        ? ChallengeInvite.countDocuments({ challengeId: challenge._id, status: "pending", kind: "invite" })
        : Promise.resolve(0),
      getPendingJoinRequest(challenge._id, req.userId, challenge.creatorId)
    ]);

    const recentUserIds = [...new Set(messages.map((item) => normalizeObjectId(item.userId)))];
    const recentUsers = recentUserIds.length
      ? await User.find({ _id: { $in: recentUserIds } }).select("_id username avatarUrl").lean()
      : [];
    const recentUserMap = new Map(recentUsers.map((user) => [normalizeObjectId(user._id), user]));
    const myEntry = leaderboard.find((item) => normalizeObjectId(item.userId) === req.userId) || null;

    return res.json({
      challenge: serializeChallenge(challenge.toObject(), {
        today: getToday(),
        participantsCount,
        viewerUserId: req.userId,
        myJoinRequest,
        isJoined: access.isOwner || access.isParticipant
      }),
      myRole: access.isOwner ? "owner" : access.isParticipant ? "participant" : "viewer",
      myEntry,
      leaderboardPreview: leaderboard.slice(0, 5),
      recentMessages: messages.map((message) => {
        const author = recentUserMap.get(normalizeObjectId(message.userId));
        return {
          id: message._id,
          text: message.text,
          createdAt: message.createdAt,
          user: author ? { id: author._id, username: author.username, avatarUrl: author.avatarUrl || "" } : null
        };
      }),
      pendingJoinRequestsCount,
      pendingInvitationsCount
    });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.post("/:id/join", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    if (getToday() > challenge.endDate) return res.status(400).json({ error: "CHALLENGE_ENDED" });

    const participantsCount = await getParticipantCount(challenge._id);
    const existingParticipant = await ChallengeParticipant.findOne({
      challengeId: challenge._id,
      userId: req.userId
    }).lean();
    if (existingParticipant && existingParticipant.status === "active") {
      await Promise.all([
        resolveChallengeInvites(
          {
            challengeId: challenge._id,
            fromUserId: req.userId,
            toUserId: challenge.creatorId,
            kind: "join_request"
          },
          "accepted"
        ),
        resolveChallengeInvites(
          {
            challengeId: challenge._id,
            fromUserId: challenge.creatorId,
            toUserId: req.userId,
            kind: "invite"
          },
          "accepted"
        )
      ]);
      return res.json({
        ok: true,
        joined: true,
        membershipStatus: "joined"
      });
    }

    if (participantsCount >= (Number(challenge.maxParticipants) || 20)) {
      return res.status(409).json({ error: "CHALLENGE_FULL" });
    }

    const providedCode = normalizeJoinCode(req.body.joinCode);
    const wantsAccessRequest = isTruthyFlag(req.body.requestAccess) || isTruthyFlag(req.body.askAccess);
    const hasValidJoinCode = JOIN_CODE_RE.test(providedCode) && providedCode === challenge.joinCode;
    const shouldCreateApprovalRequest = wantsAccessRequest || (challenge.visibility !== "public" && !hasValidJoinCode);

    if (shouldCreateApprovalRequest) {
      const allowed = challenge.visibility !== "friends"
        || normalizeObjectId(challenge.creatorId) === req.userId
        || await areFriends(challenge.creatorId, req.userId);
      if (!allowed) return res.status(403).json({ error: "NOT_FRIEND" });

      const joinRequest = await createOrRefreshJoinRequest({
        challengeId: challenge._id,
        fromUserId: req.userId,
        toUserId: challenge.creatorId,
        requestType: wantsAccessRequest ? "request_access" : "join"
      });

      return res.status(202).json({
        ok: true,
        joined: false,
        status: "pending_approval",
        membershipStatus: "pending_request",
        requestId: joinRequest._id,
        requestType: getJoinRequestType(joinRequest)
      });
    }

    await ChallengeParticipant.updateOne(
      { challengeId: challenge._id, userId: req.userId },
      { $set: { status: "active", joinedAt: new Date() } },
      { upsert: true }
    );
    await Promise.all([
      resolveChallengeInvites(
        {
          challengeId: challenge._id,
          fromUserId: req.userId,
          toUserId: challenge.creatorId,
          kind: "join_request"
        },
        "accepted"
      ),
      resolveChallengeInvites(
        {
          challengeId: challenge._id,
          fromUserId: challenge.creatorId,
          toUserId: req.userId,
          kind: "invite"
        },
        "accepted"
      )
    ]);

    return res.json({
      ok: true,
      joined: true,
      membershipStatus: "joined"
    });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.post("/:id/request-access", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    if (normalizeObjectId(challenge.creatorId) === req.userId) {
      return res.status(400).json({ error: "OWNER_CANNOT_REQUEST_ACCESS" });
    }
    if (getToday() > challenge.endDate) return res.status(400).json({ error: "CHALLENGE_ENDED" });

    const [participantsCount, existingParticipant, allowed] = await Promise.all([
      getParticipantCount(challenge._id),
      ChallengeParticipant.findOne({
        challengeId: challenge._id,
        userId: req.userId,
        status: "active"
      }).lean(),
      challenge.visibility === "friends"
        ? areFriends(challenge.creatorId, req.userId)
        : Promise.resolve(true)
    ]);

    if (!allowed) return res.status(403).json({ error: "NOT_FRIEND" });
    if (existingParticipant) {
      return res.json({
        ok: true,
        joined: true,
        membershipStatus: "joined"
      });
    }
    if (participantsCount >= (Number(challenge.maxParticipants) || 20)) {
      return res.status(409).json({ error: "CHALLENGE_FULL" });
    }

    const joinRequest = await createOrRefreshJoinRequest({
      challengeId: challenge._id,
      fromUserId: req.userId,
      toUserId: challenge.creatorId,
      requestType: "request_access"
    });

    return res.status(202).json({
      ok: true,
      joined: false,
      status: "pending_approval",
      membershipStatus: "pending_request",
      requestId: joinRequest._id,
      requestType: getJoinRequestType(joinRequest)
    });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.post("/:id/leave", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    if (normalizeObjectId(challenge.creatorId) === req.userId) {
      return res.status(400).json({ error: "OWNER_CANNOT_LEAVE" });
    }

    const activeParticipant = await ChallengeParticipant.findOne({
      challengeId: challenge._id,
      userId: req.userId,
      status: "active"
    }).lean();

    if (activeParticipant) {
      await ChallengeParticipant.updateOne(
        { challengeId: challenge._id, userId: req.userId },
        { $set: { status: "left" } }
      );
      return res.json({
        ok: true,
        left: true,
        joined: false,
        membershipStatus: "not_joined"
      });
    }

    const pendingRequest = await ChallengeInvite.findOne({
      challengeId: challenge._id,
      fromUserId: req.userId,
      toUserId: challenge.creatorId,
      kind: "join_request",
      status: "pending"
    });

    if (pendingRequest) {
      pendingRequest.status = "cancelled";
      await pendingRequest.save();
      return res.json({
        ok: true,
        cancelledRequest: true,
        joined: false,
        membershipStatus: "not_joined"
      });
    }

    return res.json({
      ok: true,
      joined: false,
      membershipStatus: "not_joined"
    });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/:id/leaderboard", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    const access = await getChallengeAccess(challenge, req.userId);
    if (!access.allowed) return res.status(403).json({ error: "FORBIDDEN" });

    const leaderboard = await buildLeaderboard(challenge);
    return res.json(leaderboard);
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/:id/messages", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    const access = await getChallengeAccess(challenge, req.userId);
    if (!access.isOwner && !access.isParticipant) return res.status(403).json({ error: "FORBIDDEN" });

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const before = req.query.before ? new Date(req.query.before) : null;
    const query = { challengeId: challenge._id };
    if (before && !Number.isNaN(before.getTime())) query.createdAt = { $lt: before };

    const messages = await ChallengeMessage.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    if (messages.length === 0) return res.json([]);

    const userIds = [...new Set(messages.map((message) => normalizeObjectId(message.userId)))];
    const users = await User.find({ _id: { $in: userIds } }).select("_id username avatarUrl").lean();
    const userMap = new Map(users.map((user) => [normalizeObjectId(user._id), user]));

    return res.json(
      messages.map((message) => {
        const user = userMap.get(normalizeObjectId(message.userId));
        return {
          id: message._id,
          userId: message.userId,
          username: user ? user.username : "",
          avatarUrl: user ? user.avatarUrl || "" : "",
          text: message.text,
          createdAt: message.createdAt
        };
      })
    );
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.post("/:id/messages", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    const access = await getChallengeAccess(challenge, req.userId);
    if (!access.isOwner && !access.isParticipant) return res.status(403).json({ error: "FORBIDDEN" });

    const text = clampText(req.body.text, 280);
    if (!text) return res.status(400).json({ error: "EMPTY_MESSAGE" });

    const message = await ChallengeMessage.create({
      challengeId: challenge._id,
      userId: req.userId,
      text
    });

    return res.status(201).json({ id: message._id });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/:id/participants", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    const access = await getChallengeAccess(challenge, req.userId);
    if (!access.allowed) return res.status(403).json({ error: "FORBIDDEN" });

    const participants = await getParticipantDocs(challenge._id);
    const userIds = participants.map((part) => part.userId);
    const users = await User.find({ _id: { $in: userIds } }).select("_id username avatarUrl").lean();
    const userMap = new Map(users.map((user) => [normalizeObjectId(user._id), user]));

    return res.json(
      participants.map((part) => {
        const user = userMap.get(normalizeObjectId(part.userId));
        return {
          userId: part.userId,
          username: user ? user.username : "",
          avatarUrl: user ? user.avatarUrl || "" : "",
          isOwner: normalizeObjectId(challenge.creatorId) === normalizeObjectId(part.userId),
          joinedAt: part.joinedAt
        };
      })
    );
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.delete("/:id/participants/:userId", requireAuth, async (req, res) => {
  try {
    const { id, userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ error: "INVALID_ID" });

    const lookup = await ensureChallengeExists(id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    if (normalizeObjectId(challenge.creatorId) !== req.userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    if (normalizeObjectId(challenge.creatorId) === userId) {
      return res.status(400).json({ error: "CANNOT_KICK_OWNER" });
    }

    await ChallengeParticipant.updateOne(
      { challengeId: challenge._id, userId },
      { $set: { status: "left" } }
    );

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    if (normalizeObjectId(challenge.creatorId) !== req.userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const { errors, updates } = validateChallengePayload(req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors[0] });

    const nextStartDate = updates.startDate || challenge.startDate;
    const nextEndDate = updates.endDate || challenge.endDate;
    if (new Date(nextEndDate) < new Date(nextStartDate)) {
      return res.status(400).json({ error: "INVALID_DATE_RANGE" });
    }

    if (Object.prototype.hasOwnProperty.call(updates, "targetValue")) {
      if ((updates.goalType || challenge.goalType || "focus_minutes") === "focus_minutes") {
        updates.goalMinutes = updates.targetValue;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "goalMinutes")) {
      updates.targetValue = updates.goalMinutes;
      if (!updates.goalType && !challenge.goalType) updates.goalType = "focus_minutes";
    }

    if (Object.prototype.hasOwnProperty.call(updates, "joinCode")) {
      updates.joinCode = updates.joinCode || challenge.joinCode || await generateUniqueJoinCode();
    } else if (!challenge.joinCode) {
      updates.joinCode = await generateUniqueJoinCode();
    }

    Object.assign(challenge, updates);
    await challenge.save();

    const participantsCount = await getParticipantCount(challenge._id);
    return res.json(
      serializeChallenge(challenge.toObject(), {
        today: getToday(),
        participantsCount,
        viewerUserId: req.userId
      })
    );
  } catch (err) {
    if (err && err.message === "JOIN_CODE_GENERATION_FAILED") {
      return res.status(500).json({ error: "JOIN_CODE_GENERATION_FAILED" });
    }
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    if (normalizeObjectId(challenge.creatorId) !== req.userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    await ChallengeParticipant.deleteMany({ challengeId: challenge._id });
    await ChallengeMessage.deleteMany({ challengeId: challenge._id });
    await ChallengeInvite.deleteMany({ challengeId: challenge._id });
    await Challenge.deleteOne({ _id: challenge._id });

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.post("/:id/invite", requireAuth, async (req, res) => {
  try {
    const toUserId = String(req.body.toUserId || "");
    if (!mongoose.isValidObjectId(toUserId)) return res.status(400).json({ error: "INVALID_ID" });
    if (toUserId === req.userId) return res.status(400).json({ error: "CANNOT_INVITE_SELF" });

    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    if (normalizeObjectId(challenge.creatorId) !== req.userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const [friendOk, targetUser, participantCount, participant] = await Promise.all([
      areFriends(req.userId, toUserId),
      User.findById(toUserId).select("_id").lean(),
      getParticipantCount(challenge._id),
      ChallengeParticipant.findOne({ challengeId: challenge._id, userId: toUserId, status: "active" }).lean()
    ]);

    if (!targetUser) return res.status(404).json({ error: "USER_NOT_FOUND" });
    if (!friendOk) return res.status(403).json({ error: "NOT_FRIEND" });
    if (participant) return res.status(409).json({ error: "ALREADY_PARTICIPANT" });
    if (participantCount >= (Number(challenge.maxParticipants) || 20)) {
      return res.status(409).json({ error: "CHALLENGE_FULL" });
    }

    const invite = await ChallengeInvite.findOneAndUpdate(
      { challengeId: challenge._id, fromUserId: req.userId, toUserId, kind: "invite" },
      { $set: { status: "pending", createdAt: new Date(), decisionAt: null } },
      { upsert: true, new: true }
    );

    return res.status(201).json({ id: invite._id, status: invite.status });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/:id/invitations", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    if (normalizeObjectId(challenge.creatorId) !== req.userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const invites = await ChallengeInvite.find({
      challengeId: challenge._id,
      kind: "invite",
      status: "pending"
    }).sort({ createdAt: -1 }).lean();
    if (invites.length === 0) return res.json([]);

    const users = await User.find({ _id: { $in: invites.map((invite) => invite.toUserId) } })
      .select("_id username avatarUrl")
      .lean();
    const userMap = new Map(users.map((user) => [normalizeObjectId(user._id), user]));

    return res.json(
      invites.map((invite) => {
        const user = userMap.get(normalizeObjectId(invite.toUserId));
        return {
          id: invite._id,
          challengeId: invite.challengeId,
          kind: invite.kind,
          toUserId: invite.toUserId,
          decisionAt: invite.decisionAt || null,
          username: user ? user.username : "",
          avatarUrl: user ? user.avatarUrl || "" : "",
          createdAt: invite.createdAt
        };
      })
    );
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.get("/:id/requests", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    if (normalizeObjectId(challenge.creatorId) !== req.userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const requests = await ChallengeInvite.find({
      challengeId: challenge._id,
      kind: "join_request",
      status: "pending"
    }).sort({ createdAt: -1 }).lean();
    if (requests.length === 0) return res.json([]);

    const users = await User.find({ _id: { $in: requests.map((request) => request.fromUserId) } })
      .select("_id username avatarUrl")
      .lean();
    const userMap = new Map(users.map((user) => [normalizeObjectId(user._id), user]));

    return res.json(
      requests.map((request) => {
        const user = userMap.get(normalizeObjectId(request.fromUserId));
        return {
          id: request._id,
          challengeId: request.challengeId,
          kind: request.kind,
          requestType: getJoinRequestType(request),
          fromUserId: request.fromUserId,
          decisionAt: request.decisionAt || null,
          username: user ? user.username : "",
          avatarUrl: user ? user.avatarUrl || "" : "",
          createdAt: request.createdAt
        };
      })
    );
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.delete("/:id/my-request", requireAuth, async (req, res) => {
  try {
    const lookup = await ensureChallengeExists(req.params.id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    const request = await ChallengeInvite.findOne({
      challengeId: challenge._id,
      fromUserId: req.userId,
      toUserId: challenge.creatorId,
      kind: "join_request",
      status: "pending"
    });

    if (!request) return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
    request.status = "cancelled";
    request.decisionAt = new Date();
    await request.save();

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.post("/:id/invitations/:invId/accept", requireAuth, async (req, res) => {
  try {
    const { id, invId } = req.params;
    if (!mongoose.isValidObjectId(invId)) return res.status(400).json({ error: "INVALID_ID" });

    const lookup = await ensureChallengeExists(id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    const invite = await ChallengeInvite.findById(invId);
    if (!invite) return res.status(404).json({ error: "INVITE_NOT_FOUND" });
    if (invite.kind !== "invite") return res.status(400).json({ error: "INVALID_INVITE_TYPE" });
    if (normalizeObjectId(invite.challengeId) !== normalizeObjectId(challenge._id)) {
      return res.status(400).json({ error: "INVITE_CHALLENGE_MISMATCH" });
    }
    if (normalizeObjectId(invite.toUserId) !== req.userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    if (invite.status !== "pending") {
      return res.status(409).json({ error: "INVITE_NOT_PENDING" });
    }
    if (getToday() > challenge.endDate) {
      return res.status(400).json({ error: "CHALLENGE_ENDED" });
    }

    const participantCount = await getParticipantCount(challenge._id);
    if (participantCount >= (Number(challenge.maxParticipants) || 20)) {
      return res.status(409).json({ error: "CHALLENGE_FULL" });
    }

    invite.status = "accepted";
    invite.decisionAt = new Date();
    await invite.save();
    await ChallengeParticipant.updateOne(
      { challengeId: challenge._id, userId: req.userId },
      { $set: { status: "active", joinedAt: new Date() } },
      { upsert: true }
    );
    await resolveChallengeInvites(
      {
        challengeId: challenge._id,
        fromUserId: req.userId,
        toUserId: challenge.creatorId,
        kind: "join_request"
      },
      "accepted"
    );

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.post("/:id/invitations/:invId/reject", requireAuth, async (req, res) => {
  try {
    const { id, invId } = req.params;
    if (!mongoose.isValidObjectId(invId)) return res.status(400).json({ error: "INVALID_ID" });

    const lookup = await ensureChallengeExists(id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    const invite = await ChallengeInvite.findById(invId);
    if (!invite) return res.status(404).json({ error: "INVITE_NOT_FOUND" });
    if (invite.kind !== "invite") return res.status(400).json({ error: "INVALID_INVITE_TYPE" });
    if (normalizeObjectId(invite.challengeId) !== normalizeObjectId(challenge._id)) {
      return res.status(400).json({ error: "INVITE_CHALLENGE_MISMATCH" });
    }
    if (normalizeObjectId(invite.toUserId) !== req.userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    if (invite.status !== "pending") {
      return res.status(409).json({ error: "INVITE_NOT_PENDING" });
    }

    invite.status = "rejected";
    invite.decisionAt = new Date();
    await invite.save();
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.post("/:id/requests/:requestId/accept", requireAuth, async (req, res) => {
  try {
    const { id, requestId } = req.params;
    if (!mongoose.isValidObjectId(requestId)) return res.status(400).json({ error: "INVALID_ID" });

    const lookup = await ensureChallengeExists(id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    if (normalizeObjectId(challenge.creatorId) !== req.userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const request = await ChallengeInvite.findById(requestId);
    if (!request) return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
    if (request.kind !== "join_request") return res.status(400).json({ error: "INVALID_REQUEST_TYPE" });
    if (normalizeObjectId(request.challengeId) !== normalizeObjectId(challenge._id)) {
      return res.status(400).json({ error: "REQUEST_CHALLENGE_MISMATCH" });
    }
    if (normalizeObjectId(request.toUserId) !== req.userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    if (request.status !== "pending") {
      return res.status(409).json({ error: "REQUEST_NOT_PENDING" });
    }
    if (getToday() > challenge.endDate) {
      return res.status(400).json({ error: "CHALLENGE_ENDED" });
    }

    const participantCount = await getParticipantCount(challenge._id);
    if (participantCount >= (Number(challenge.maxParticipants) || 20)) {
      return res.status(409).json({ error: "CHALLENGE_FULL" });
    }

    request.status = "accepted";
    request.decisionAt = new Date();
    await request.save();
    await ChallengeParticipant.updateOne(
      { challengeId: challenge._id, userId: request.fromUserId },
      { $set: { status: "active", joinedAt: new Date() } },
      { upsert: true }
    );
    await resolveChallengeInvites(
      {
        challengeId: challenge._id,
        fromUserId: challenge.creatorId,
        toUserId: request.fromUserId,
        kind: "invite"
      },
      "accepted"
    );

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

router.post("/:id/requests/:requestId/reject", requireAuth, async (req, res) => {
  try {
    const { id, requestId } = req.params;
    if (!mongoose.isValidObjectId(requestId)) return res.status(400).json({ error: "INVALID_ID" });

    const lookup = await ensureChallengeExists(id);
    if (lookup.error) return res.status(lookup.error.status).json(lookup.error.body);

    const { challenge } = lookup;
    if (normalizeObjectId(challenge.creatorId) !== req.userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const request = await ChallengeInvite.findById(requestId);
    if (!request) return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
    if (request.kind !== "join_request") return res.status(400).json({ error: "INVALID_REQUEST_TYPE" });
    if (normalizeObjectId(request.challengeId) !== normalizeObjectId(challenge._id)) {
      return res.status(400).json({ error: "REQUEST_CHALLENGE_MISMATCH" });
    }
    if (normalizeObjectId(request.toUserId) !== req.userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    if (request.status !== "pending") {
      return res.status(409).json({ error: "REQUEST_NOT_PENDING" });
    }

    request.status = "rejected";
    request.decisionAt = new Date();
    await request.save();
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

module.exports = router;
