const mongoose = require("mongoose");
const { runChallengeMigrations } = require("../services/challengeMigrations");

async function connectDB(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  try {
    await runChallengeMigrations();
  } catch (error) {
    console.warn(
      `[challenge-migrations] startup warning: ${error && error.message ? error.message : "unknown_error"}`
    );
  }
  console.log("MongoDB connected");
}

module.exports = { connectDB };
