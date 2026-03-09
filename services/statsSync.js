/**
 * statsSync.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared service for syncing UserStats after a focus session is completed.
 * Extracted from the POST /api/stats/sync route so it can be called internally.
 *
 * Usage:
 *   const { syncStatsForSession } = require("../services/statsSync");
 *   await syncStatsForSession({ userId, date, focusMinutes, tasksCompleted });
 */

const mongoose = require("mongoose");
const UserStats = require("../models/UserStats");

/**
 * Returns a "yyyy-MM-dd" date string for N days ago (UTC).
 * @param {number} n
 * @returns {string}
 */
function dateNDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Computes the current streak for a user given a specific date.
 *
 * Logic:
 *   - Check if there is a UserStats record for the day *before* the given date
 *   - If yes: streak = yesterday's streak + 1
 *   - If no:  streak = 1
 *
 * @param {mongoose.Types.ObjectId} userObjectId
 * @param {string} todayStr - "yyyy-MM-dd"
 * @returns {Promise<number>} the new streak value
 */
async function computeStreak(userObjectId, todayStr) {
  // Parse the "yyyy-MM-dd" string and subtract 1 day
  const dateParts = todayStr.split("-").map(Number);
  // Months are 0-indexed in JS Date: Jan=0, Feb=1, etc.
  const date = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));
  
  date.setUTCDate(date.getUTCDate() - 1);
  const yesterdayStr = date.toISOString().slice(0, 10);

  const yesterdayStat = await UserStats.findOne({
    userId: userObjectId,
    date: yesterdayStr
  }).lean();

  if (yesterdayStat && yesterdayStat.streak > 0) {
    return yesterdayStat.streak + 1;
  }

  return 1;
}

/**
 * Upserts the UserStats record for the given day, incrementing focus stats
 * and setting the recalculated streak.
 *
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.userId
 * @param {string} params.date          - "yyyy-MM-dd"
 * @param {number} params.focusMinutes  - minutes to add to today's total
 * @param {number} params.tasksCompleted - tasks to add to today's total
 * @param {number} [params.sessionsCount=1] - sessions to add (default 1)
 * @returns {Promise<object>} the updated UserStats document
 */
async function syncStatsForSession({
  userId,
  date,
  focusMinutes,
  tasksCompleted,
  completedTaskTitles = [],
  sessionsCount = 1
}) {
  if (!userId || !mongoose.isValidObjectId(userId.toString())) {
    throw new Error("INVALID_USER_ID");
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("INVALID_DATE_FORMAT");
  }

  const userObjectId = new mongoose.Types.ObjectId(userId.toString());

  // 1. Calculate the new streak
  const streak = await computeStreak(userObjectId, date);

  // 2. Upsert UserStats — accumulate numeric fields, overwrite streak, push task titles
  const stat = await UserStats.findOneAndUpdate(
    { userId: userObjectId, date },
    {
      $inc: {
        focusMinutes: Number(focusMinutes) || 0,
        sessionsCount: Number(sessionsCount) || 0,
        tasksCompleted: Number(tasksCompleted) || 0
      },
      $set: {
        streak,
        updatedAt: new Date()
      },
      $push: {
        completedTaskTitles: { $each: completedTaskTitles }
      }
    },
    { upsert: true, new: true, runValidators: true }
  );

  return stat;
}

module.exports = { syncStatsForSession, computeStreak };
