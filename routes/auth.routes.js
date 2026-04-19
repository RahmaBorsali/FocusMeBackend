const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { z } = require("zod");

const User = require("../models/user");
const EmailToken = require("../models/EmailToken");
const PasswordResetToken = require("../models/PasswordResetToken");
const { validatePassword } = require("../services/passwordPolicy");
const { isPwnedPassword } = require("../services/pwnedPassword");
const { makeInitials } = require("../utils/initials");
const { createTransport } = require("../config/mailer");
const { ApiError, pickUserDto, validationError } = require("../utils/api");

const router = express.Router();
const googleClient = new OAuth2Client();

const signupSchema = z.object({
  username: z.string().trim().min(2, "Username must be at least 2 characters").max(50, "Username must be at most 50 characters"),
  email: z.string().trim().email("Email must be valid"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(8, "Confirm password must be at least 8 characters")
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"]
});

const loginSchema = z.object({
  email: z.string().trim().email("Email must be valid"),
  password: z.string().min(1, "Password is required")
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Email must be valid")
});

const resetSchema = z.object({
  token: z.string().min(10, "Token is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(8, "Confirm password must be at least 8 characters")
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"]
});

const googleSchema = z.object({
  idToken: z.string().min(1, "Google idToken is required"),
  mode: z.enum(["login", "signup"]).default("login")
});

function getJwtOptions() {
  const options = {
    expiresIn: process.env.JWT_EXPIRES_IN || "15m"
  };

  if (process.env.JWT_ISSUER) {
    options.issuer = process.env.JWT_ISSUER;
  }
  if (process.env.JWT_AUDIENCE) {
    options.audience = process.env.JWT_AUDIENCE;
  }

  return options;
}

function signAccessToken(user) {
  return jwt.sign({ sub: user._id.toString(), ver: user.tokenVersion || 0 }, process.env.JWT_SECRET, getJwtOptions());
}

function getGoogleAudiences() {
  return [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID
  ].filter(Boolean);
}

function buildPasswordFieldErrors(password) {
  const policy = validatePassword(password);
  if (!policy.ok) {
    return validationError({ password: policy.reasons });
  }
  return null;
}

async function ensurePasswordSafe(password) {
  const passwordError = buildPasswordFieldErrors(password);
  if (passwordError) throw passwordError;

  const pwned = await isPwnedPassword(password);
  if (pwned) {
    throw validationError({
      password: ["This password has appeared in known breaches. Choose a different one."]
    });
  }
}

async function ensureUniqueIdentity({ email, username, excludeUserId = null }) {
  const queryBase = excludeUserId ? { _id: { $ne: excludeUserId } } : {};

  const [existingEmail, existingUsername] = await Promise.all([
    User.findOne({ ...queryBase, email: email.toLowerCase() }).select("_id").lean(),
    User.findOne({ ...queryBase, usernameNormalized: username.trim().toLowerCase() }).select("_id").lean()
  ]);

  if (existingEmail) {
    throw new ApiError(409, { message: "Email already in use" });
  }

  if (existingUsername) {
    throw new ApiError(409, { message: "Username already in use" });
  }
}

async function sendVerificationEmail(user) {
  // Générer un code à 6 chiffres
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const tokenHash = crypto.createHash("sha256").update(code).digest("hex");

  // Supprimer les anciens tokens de vérification pour cet utilisateur
  await EmailToken.deleteMany({ userId: user._id });

  await EmailToken.create({
    userId: user._id,
    tokenHash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 heures
  });

  const transport = await createTransport();

  await transport.sendMail({
    from: process.env.MAIL_FROM,
    to: user.email,
    subject: "Verify your FocusMe email",
    html: `
      <div style="font-family: sans-serif; text-align: center; padding: 20px;">
        <h2>Welcome to FocusMe!</h2>
        <p>Your verification code is:</p>
        <h1 style="color: #FF5E89; letter-spacing: 5px;">${code}</h1>
        <p>Enter this code in the app to activate your account.</p>
        <p>This code expires in 24 hours.</p>
      </div>
    `
  });
}

function normalizeUsernameCandidate(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

async function generateUniqueUsername(seedValue) {
  const seed = normalizeUsernameCandidate(seedValue) || `focusme_${crypto.randomBytes(3).toString("hex")}`;

  for (let i = 0; i < 20; i += 1) {
    const suffix = i === 0 ? "" : `_${i + 1}`;
    const username = `${seed}${suffix}`.slice(0, 50);
    const exists = await User.findOne({ usernameNormalized: username.toLowerCase() }).select("_id").lean();
    if (!exists) return username;
  }

  return `focusme_${crypto.randomBytes(4).toString("hex")}`;
}

async function verifyGoogleToken(idToken) {
  const audiences = getGoogleAudiences();
  if (!audiences.length) {
    throw new ApiError(500, { message: "Google sign-in is not configured" });
  }

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken,
      audience: audiences
    });
  } catch {
    throw new ApiError(401, { message: "Invalid Google token" });
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email || !payload.email_verified) {
    throw new ApiError(401, { message: "Invalid Google token" });
  }

  return payload;
}

router.post("/signup", async (req, res, next) => {
  try {
    const data = signupSchema.parse(req.body);
    await ensurePasswordSafe(data.password);
    await ensureUniqueIdentity({ email: data.email, username: data.username });

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await User.create({
      username: data.username.trim(),
      email: data.email.toLowerCase(),
      passwordHash,
      emailVerified: false,
      displayName: data.username.trim(),
      avatarType: "initials",
      avatarInitials: makeInitials(data.username),
      authProviders: {
        emailPassword: true,
        google: false
      }
    });

    await sendVerificationEmail(user);

    return res.status(201).json({
      message: "Account created. Please verify your email before logging in.",
      user: pickUserDto(user)
    });
  } catch (e) {
    next(e);
  }
});

router.post("/verify-email", async (req, res, next) => {
  try {
    const { email, token } = req.body; // 'token' est ici le code à 6 chiffres
    
    if (!email || !token) {
      return res.status(400).json({ message: "Email and code are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const record = await EmailToken.findOne({ userId: user._id, tokenHash });
    
    if (!record || record.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    await User.updateOne({ _id: user._id }, { $set: { emailVerified: true } });
    await EmailToken.deleteMany({ userId: user._id });

    return res.json({ message: "Email verified successfully" });
  } catch (e) {
    next(e);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await User.findOne({ email: data.email.toLowerCase() });

    if (!user || !user.passwordHash || user.deletedAt) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const ok = await bcrypt.compare(data.password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!user.emailVerified) {
      return res.status(403).json({ message: "Email not verified" });
    }

    const accessToken = signAccessToken(user);
    return res.json({
      accessToken,
      user: pickUserDto(user)
    });
  } catch (e) {
    next(e);
  }
});

router.post("/google", async (req, res, next) => {
  try {
    const { idToken, mode } = googleSchema.parse(req.body);
    const payload = await verifyGoogleToken(idToken);
    const { sub, email, name, picture } = payload;
    const emailNormalized = String(email).toLowerCase();

    // 1. Chercher si l'utilisateur existe déjà
    let user = await User.findOne({ 
      $or: [
        { googleSub: sub },
        { email: emailNormalized }
      ]
    });

    if (mode === "login") {
      // SCÉNARIO LOGIN
      if (!user) {
        // Point 1: Si le compte n'existe pas déjà, erreur 444
        return res.status(444).json({
          error: "USER_NOT_FOUND",
          message: "Aucun compte trouvé. Veuillez d'abord vous inscrire."
        });
      }

      // Point 2: Si le compte existe, on connecte (et on lie Google si pas fait)
      if (!user.googleSub) {
        user.googleSub = sub;
        user.authProviders.google = true;
        await user.save();
      }
      
      const accessToken = signAccessToken(user);
      return res.status(200).json({ accessToken, user: pickUserDto(user) });
    } else {
      // SCÉNARIO SIGNUP
      if (user) {
        // Point 3: Si l'email ou le compte existe déjà, erreur 409
        return res.status(409).json({
          error: "EMAIL_EXISTS",
          message: "Cet email est déjà lié à un compte existant."
        });
      }

      // Point 4: Si le compte n'existe pas, on le crée automatiquement
      const username = await generateUniqueUsername(name || email.split("@")[0]);
      user = await User.create({
        username,
        email: emailNormalized,
        passwordHash: null,
        emailVerified: true,
        displayName: name ? String(name).trim() : username,
        avatarType: picture ? "image" : "initials",
        avatarInitials: makeInitials(name || username),
        avatarUrl: picture || "",
        authProviders: {
          emailPassword: false,
          google: true
        },
        googleSub: sub
      });

      const accessToken = signAccessToken(user);
      return res.status(200).json({ accessToken, user: pickUserDto(user) });
    }

  } catch (error) {
    console.error("[Auth] Google Login/Signup error:", error);
    return res.status(error.status || 500).json({
      error: error.message || "Internal Server Error"
    });
  }
});

router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const genericResponse = { message: "If this email exists, a verification code has been sent." };
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user || !user.passwordHash) {
      return res.status(200).json(genericResponse);
    }

    // Générer un code à 6 chiffres
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const tokenHash = crypto.createHash("sha256").update(code).digest("hex");

    // Supprimer les anciens tokens pour cet utilisateur
    await PasswordResetToken.deleteMany({ userId: user._id });

    await PasswordResetToken.create({
      userId: user._id,
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    });

    const transport = await createTransport();
    await transport.sendMail({
      from: process.env.MAIL_FROM,
      to: user.email,
      subject: "Your FocusMe Reset Code",
      html: `
        <div style="font-family: sans-serif; text-align: center; padding: 20px;">
          <h2>Reset password</h2>
          <p>Use the following code to reset your password:</p>
          <h1 style="color: #FF5E89; letter-spacing: 5px;">${code}</h1>
          <p>This code expires in 15 minutes.</p>
        </div>
      `
    });

    return res.status(200).json(genericResponse);
  } catch (e) {
    next(e);
  }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const { email, token, password, confirmPassword } = req.body; // 'token' est ici le code à 6 chiffres
    
    if (!email || !token || !password || !confirmPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    await ensurePasswordSafe(password);

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const record = await PasswordResetToken.findOne({ userId: user._id, tokenHash });
    
    if (!record || record.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash,
          "authProviders.emailPassword": true
        },
        $inc: { tokenVersion: 1 }
      }
    );

    await PasswordResetToken.deleteMany({ userId: user._id });

    return res.json({ message: "Password updated successfully" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
