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
  }).lean();

  for (const challenge of challenges) {
    const updates = {};

    if (!challenge.goalType) {
      updates.goalType = "focus_minutes";
    }

    if (!challenge.maxParticipants) {
      updates.maxParticipants = 20;
    }

    if (typeof challenge.targetValue === "undefined") {
      updates.targetValue = Number(challenge.goalMinutes) || 0;
    }

    if (!challenge.joinCode) {
      updates.joinCode = await generateUniqueJoinCode();
    }

    if (Object.keys(updates).length > 0) {
      await Challenge.updateOne({ _id: challenge._id }, { $set: updates });
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

async function backfillChallengeInviteRequestTypes() {
  const result = await ChallengeInvite.updateMany(
    {
      kind: "join_request",
      $or: [
        { requestType: { $exists: false } },
        { requestType: null },
        { requestType: "" }
      ]
    },
    { $set: { requestType: "join" } }
  );

  return result.modifiedCount || 0;
}

async function runMigrationStep(label, runner) {
  try {
    return await runner();
  } catch (error) {
    console.warn(
      `[challenge-migrations] ${label} skipped: ${error && error.message ? error.message : "unknown_error"}`
    );
    return 0;
  }
}

async function syncModelIndexes(model, label) {
  try {
    await model.syncIndexes();
    return true;
  } catch (error) {
    console.warn(
      `[challenge-migrations] ${label} index sync skipped: ${error && error.message ? error.message : "unknown_error"}`
    );
    return false;
  }
}

async function syncChallengeIndexes() {
  const challengeSynced = await syncModelIndexes(Challenge, "Challenge");
  const inviteSynced = await syncModelIndexes(ChallengeInvite, "ChallengeInvite");
  return { challengeSynced, inviteSynced };
}

async function runChallengeMigrations() {
  const updatedInvites = await runMigrationStep("invite kind backfill", backfillChallengeInviteKinds);
  const updatedRequestTypes = await runMigrationStep("invite requestType backfill", backfillChallengeInviteRequestTypes);
  const updatedChallenges = await runMigrationStep("challenge field backfill", backfillChallengeFields);
  const syncSummary = await syncChallengeIndexes();

  console.log(
    `[challenge-migrations] ready (invites:${updatedInvites}, requestTypes:${updatedRequestTypes}, challenges:${updatedChallenges}, challengeIndexes:${syncSummary.challengeSynced}, inviteIndexes:${syncSummary.inviteSynced})`
  );
}

module.exports = { runChallengeMigrations };
