const jwt = require("jsonwebtoken");
const User = require("../models/user");

function extractBearerToken(header = "") {
  const [type, token] = String(header).split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, {
    issuer: process.env.JWT_ISSUER || undefined,
    audience: process.env.JWT_AUDIENCE || undefined
  });
}

async function requireAuth(req, res, next) {
  const token = extractBearerToken(req.headers.authorization || "");

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub)
      .select("_id tokenVersion deletedAt")
      .lean();

    if (!user || user.deletedAt) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if ((payload.ver || 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({ message: "Session expired" });
    }

    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ message: "Authentication required" });
  }
}

module.exports = {
  extractBearerToken,
  verifyAccessToken,
  requireAuth
};
