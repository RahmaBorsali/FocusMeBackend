const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, minlength: 2 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },

    emailVerified: { type: Boolean, default: false },

    avatarType: { type: String, enum: ["initials", "image"], default: "initials" },
    avatarInitials: { type: String, default: "" },
    avatarUrl: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);