const Challenge = require("../models/Challenge");
const ChallengeInvite = require("../models/ChallengeInvite");

function generateJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function generateUniqueJoinCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = generateJoinCode();
    const existing = await Challenge.findOne({ joinCode: code }).select("_id").lean();
    if (!existing) return code;
  }
  throw new Error("JOIN_CODE_BACKFILL_FAILED");
}

async function backfillChallengeFields() {
  let updatedChallenges = 0;
  const challenges = await Challenge.find({
    $or: [
      { goalType: { $exists: false } },
      { maxParticipants: { $exists: false } },
      { targetValue: { $exists: false } },
      { joinCode: { $exists: false } },
      { joinCode: null },
      { joinCode: "" }
    ]
  });

  for (const challenge of challenges) {
    let changed = false;

    if (!challenge.goalType) {
      challenge.goalType = "focus_minutes";
      changed = true;
    }

    if (!challenge.maxParticipants) {
      challenge.maxParticipants = 20;
      changed = true;
    }

    if (typeof challenge.targetValue === "undefined") {
      challenge.targetValue = Number(challenge.goalMinutes) || 0;
      changed = true;
    }

    if (!challenge.joinCode) {
      challenge.joinCode = await generateUniqueJoinCode();
      changed = true;
    }

    if (changed) {
      await challenge.save();
      updatedChallenges += 1;
    }
  }

  return updatedChallenges;
}

async function backfillChallengeInviteKinds() {
  const result = await ChallengeInvite.updateMany(
    { kind: { $exists: false } },
    { $set: { kind: "invite" } }
  );

  return result.modifiedCount || 0;
}

async function syncChallengeIndexes() {
  await Challenge.syncIndexes();
  await ChallengeInvite.syncIndexes();
}

async function runChallengeMigrations() {
  const updatedInvites = await backfillChallengeInviteKinds();
  const updatedChallenges = await backfillChallengeFields();
  await syncChallengeIndexes();

  console.log(
    `[challenge-migrations] ready (invites:${updatedInvites}, challenges:${updatedChallenges})`
  );
}

module.exports = { runChallengeMigrations };
