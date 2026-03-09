const mongoose = require("mongoose");
const { syncStatsForSession } = require("../services/statsSync");
const User = require("../models/user");
const UserStats = require("../models/UserStats");
const Session = require("../models/Session");

const MONGO_URI = "mongodb://localhost:27017/focusme";

async function runTest() {
  try {
    console.log("Connecting to DB...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected.");

    // 1. Create a test user
    const testUser = await User.create({
      username: "testuser_" + Date.now(),
      email: "test_" + Date.now() + "@example.com",
      passwordHash: "dummy"
    });
    const userId = testUser._id;
    console.log("Created test user:", userId);

    const today = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10);

    const d1 = new Date(today); d1.setUTCDate(d1.getUTCDate() - 2); // 2 days ago
    const d2 = new Date(today); d2.setUTCDate(d2.getUTCDate() - 1); // yesterday
    const d3 = new Date(today);                                     // today
    const d5 = new Date(today); d5.setUTCDate(d5.getUTCDate() + 2); // gap of 2 days

    const dates = [fmt(d1), fmt(d2), fmt(d3), fmt(d5)];
    console.log("Testing with dates:", dates);

    // Test Day 1: Streak should be 1
    console.log("\n--- Day 1 (2 days ago) ---");
    const s1 = await syncStatsForSession({ 
      userId, 
      date: dates[0], 
      focusMinutes: 30, 
      tasksCompleted: 2,
      completedTaskTitles: ["Maths", "Physics"]
    });
    console.log("Stats Day 1:", { date: s1.date, focus: s1.focusMinutes, streak: s1.streak, tasks: s1.completedTaskTitles });
    if (s1.streak !== 1) throw new Error("Day 1 streak should be 1");
    if (s1.completedTaskTitles.length !== 2) throw new Error("Should have 2 tasks");
    if (!s1.completedTaskTitles.includes("Maths")) throw new Error("Missing Maths task");

    // Test Day 2: Streak should be 2
    console.log("\n--- Day 2 (yesterday) ---");
    const s2 = await syncStatsForSession({ userId, date: dates[1], focusMinutes: 45, tasksCompleted: 1 });
    console.log("Stats Day 2:", { date: s2.date, focus: s2.focusMinutes, streak: s2.streak });
    if (s2.streak !== 2) throw new Error("Day 2 streak should be 2");

    // Test Day 3: Streak should be 3
    console.log("\n--- Day 3 (today) ---");
    const s3 = await syncStatsForSession({ userId, date: dates[2], focusMinutes: 60, tasksCompleted: 3 });
    console.log("Stats Day 3:", { date: s3.date, focus: s3.focusMinutes, streak: s3.streak });
    if (s3.streak !== 3) throw new Error("Day 3 streak should be 3");

    // Test Day 5: Streak should reset to 1 (gap of 1 full day)
    console.log("\n--- Day 5 (gap) ---");
    const s5 = await syncStatsForSession({ userId, date: dates[3], focusMinutes: 20, tasksCompleted: 0 });
    console.log("Stats Day 5:", { date: s5.date, focus: s5.focusMinutes, streak: s5.streak });
    if (s5.streak !== 1) throw new Error("Day 5 streak should be 1 due to gap");

    console.log("\n✅ ALL TESTS PASSED!");

    // Cleanup
    await User.deleteOne({ _id: userId });
    await UserStats.deleteMany({ userId });
    await Session.deleteMany({ userId });
    console.log("Cleanup done.");

  } catch (err) {
    console.error("❌ TEST FAILED:", err);
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
}

runTest();
