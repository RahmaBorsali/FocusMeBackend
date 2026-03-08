const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { z } = require("zod");

const User = require("../models/user");
const EmailToken = require("../models/EmailToken");
const { validatePassword } = require("../services/passwordPolicy");
const { isPwnedPassword } = require("../services/pwnedPassword");
const { makeInitials } = require("../utils/initials");
const { createTransport } = require("../config/mailer");

const router = express.Router();

const PasswordResetToken = require("../models/PasswordResetToken");

const signupSchema = z.object({
  username: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(6),
  confirmPassword: z.string().min(6)
}).refine(d => d.password === d.confirmPassword, {
  message: "Les mots de passe ne correspondent pas",
  path: ["confirmPassword"]
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(6),
  confirmPassword: z.string().min(6)
}).refine(d => d.password === d.confirmPassword, {
  message: "Les mots de passe ne correspondent pas",
  path: ["confirmPassword"]
});

function signAccessToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "15m" });
}

router.post("/signup", async (req, res, next) => {
  try {
    const data = signupSchema.parse(req.body);

    // 1) Policy (maj/min/chiffre/special/len)
    const policy = validatePassword(data.password);
    if (!policy.ok) return res.status(400).json({ error: "PASSWORD_POLICY", details: policy.reasons });

    // 2) Anti breached passwords (HIBP)
    const pwned = await isPwnedPassword(data.password);
    if (pwned) return res.status(400).json({ error: "PASSWORD_PWNED", details: ["Mot de passe compromis (déjà apparu dans des fuites). Choisis-en un autre."] });

    // 3) Uniqueness
    const existing = await User.findOne({ email: data.email.toLowerCase() });
    if (existing) return res.status(409).json({ error: "EMAIL_EXISTS" });

    // 4) Create user
    const passwordHash = await bcrypt.hash(data.password, 12);
    const avatarInitials = makeInitials(data.username);

    const user = await User.create({
      username: data.username,
      email: data.email.toLowerCase(),
      passwordHash,
      emailVerified: false,
      avatarType: "initials",
      avatarInitials
    });

    // 5) Create verification token (store hash)
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await EmailToken.create({
      userId: user._id,
      tokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
    });

    // 6) Send email
    const verifyUrl = `${process.env.APP_BASE_URL}/auth/verify-email?token=${rawToken}`;
    const transport = await createTransport();
    await transport.sendMail({
      from: process.env.MAIL_FROM,
      to: user.email,
      subject: "Vérifie ton email - FocusMe",
      html: `
        <p>Bienvenue sur FocusMe 👋</p>
        <p>Clique pour vérifier ton email :</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p>Ce lien expire dans 24h.</p>
      `
    });

    return res.status(201).json({
      message: "Compte créé. Vérifie ta boîte mail pour activer ton compte.",
      user: { id: user._id, username: user.username, email: user.email, avatarType: user.avatarType, avatarInitials: user.avatarInitials, emailVerified: user.emailVerified }
    });
  } catch (e) { next(e); }
});

router.get("/verify-email", async (req, res, next) => {
  try {
    const rawToken = String(req.query.token || "");
    if (!rawToken) return res.status(400).send("Token manquant");

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const record = await EmailToken.findOne({ tokenHash });
    if (!record) return res.status(400).send("Token invalide ou expiré");

    await User.updateOne({ _id: record.userId }, { $set: { emailVerified: true } });
    await EmailToken.deleteMany({ userId: record.userId }); // invalider anciens tokens

    // Pour Sprint 3: simple message. Plus tard -> deep link vers app
    return res.status(200).send("✅ Email vérifié. Tu peux retourner à l’application et te connecter.");
  } catch (e) { next(e); }
});

router.post("/login", async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);

    const user = await User.findOne({ email: data.email.toLowerCase() });
    if (!user) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

    const ok = await bcrypt.compare(data.password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

    if (!user.emailVerified) {
      return res.status(403).json({ error: "EMAIL_NOT_VERIFIED", message: "Vérifie ton email avant de te connecter." });
    }

    const accessToken = signAccessToken(user._id.toString());

    return res.json({
      accessToken,
      user: { id: user._id, username: user.username, email: user.email, avatarType: user.avatarType, avatarInitials: user.avatarInitials }
    });
  } catch (e) { next(e); }
});

router.post("/forgot-password", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    // Toujours répondre pareil (anti-enum)
    const genericResponse = { message: "Si cet email existe, un lien de réinitialisation a été envoyé." };

    if (!email) return res.status(200).json(genericResponse);

    const user = await User.findOne({ email });
    if (!user) return res.status(200).json(genericResponse);

    // Créer token reset (hashé)
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await PasswordResetToken.create({
      userId: user._id,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    });

    const resetUrl = `${process.env.APP_BASE_URL}/auth/reset-password?token=${rawToken}`;

    const transport = await createTransport();
    await transport.sendMail({
      from: process.env.MAIL_FROM,
      to: user.email,
      subject: "Réinitialisation du mot de passe - FocusMe",
      html: `
        <p>Tu as demandé une réinitialisation de mot de passe.</p>
        <p>Clique ici :</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>Ce lien expire dans 30 minutes. Si ce n’est pas toi, ignore cet email.</p>
      `
    });

    return res.status(200).json(genericResponse);
  } catch (e) { next(e); }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const data = resetSchema.parse(req.body);

    // Policy
    const policy = validatePassword(data.password);
    if (!policy.ok) return res.status(400).json({ error: "PASSWORD_POLICY", details: policy.reasons });

    // HIBP
    const pwned = await isPwnedPassword(data.password);
    if (pwned) return res.status(400).json({ error: "PASSWORD_PWNED" });

    const tokenHash = crypto.createHash("sha256").update(data.token).digest("hex");
    const record = await PasswordResetToken.findOne({ tokenHash });
    if (!record) return res.status(400).json({ error: "INVALID_OR_EXPIRED_TOKEN" });

    // (TTL supprime après expiry mais on vérifie aussi)
    if (record.expiresAt.getTime() < Date.now()) {
      await PasswordResetToken.deleteOne({ _id: record._id });
      return res.status(400).json({ error: "INVALID_OR_EXPIRED_TOKEN" });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    await User.updateOne({ _id: record.userId }, { $set: { passwordHash } });

    // invalider tous tokens reset de ce user
    await PasswordResetToken.deleteMany({ userId: record.userId });

    return res.json({ message: "Mot de passe mis à jour. Tu peux te connecter." });
  } catch (e) { next(e); }
});

module.exports = router;