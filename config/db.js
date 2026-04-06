const mongoose = require("mongoose");
const { runChallengeMigrations } = require("../services/challengeMigrations");

async function connectDB(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  await runChallengeMigrations();
  console.log("MongoDB connected");
}

module.exports = { connectDB };
