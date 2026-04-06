const jwt = require("jsonwebtoken");

function extractBearerToken(header = "") {
  const [type, token] = String(header).split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function requireAuth(req, res, next) {
  const token = extractBearerToken(req.headers.authorization || "");

  if (!token) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
}

module.exports = {
  extractBearerToken,
  verifyAccessToken,
  requireAuth
};
