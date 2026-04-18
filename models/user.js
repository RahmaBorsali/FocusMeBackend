const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, minlength: 2 },
    usernameNormalized: { type: String, required: true, unique: true, trim: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null },

    emailVerified: { type: Boolean, default: false },
    displayName: { type: String, trim: true, default: "" },
    studyGoal: { type: String, trim: true, default: "" },
    tokenVersion: { type: Number, default: 0 },
    authProviders: {
      emailPassword: { type: Boolean, default: false },
      google: { type: Boolean, default: false }
    },
    googleSub: { type: String, default: null, index: true },
    deletedAt: { type: Date, default: null },

    avatarType: { type: String, enum: ["initials", "image"], default: "initials" },
    avatarInitials: { type: String, default: "" },
    avatarUrl: { type: String, default: "" }
  },
  { timestamps: true }
);

UserSchema.pre("validate", function normalizeIdentity() {
  if (this.username) {
    this.username = this.username.trim();
    this.usernameNormalized = this.username.toLowerCase();
  }

  if (this.email) {
    this.email = this.email.trim().toLowerCase();
  }

  if (!this.displayName) {
    this.displayName = this.username || "";
  } else {
    this.displayName = this.displayName.trim();
  }
});

module.exports = mongoose.model("User", UserSchema);
