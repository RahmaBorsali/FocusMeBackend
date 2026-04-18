function toFieldErrors(issues = []) {
  return issues.reduce((acc, issue) => {
    const key = issue.path && issue.path.length ? String(issue.path[0]) : "general";
    if (!acc[key]) acc[key] = [];
    acc[key].push(issue.message);
    return acc;
  }, {});
}

function redactBody(body) {
  if (!body || typeof body !== "object") return undefined;

  const redacted = { ...body };
  for (const key of ["password", "confirmPassword", "token", "accessToken", "refreshToken", "idToken"]) {
    if (key in redacted) redacted[key] = "[REDACTED]";
  }
  return redacted;
}

module.exports = (err, req, res, next) => {
  if (err.name === "ZodError") {
    return res.status(400).json({
      message: "Validation failed",
      errors: toFieldErrors(err.issues)
    });
  }

  if (err && err.statusCode) {
    return res.status(err.statusCode).json(err.body || { message: err.message || "Request failed" });
  }

  if (err && err.code === 11000) {
    if (err.keyPattern && err.keyPattern.email) {
      return res.status(409).json({ message: "Email already in use" });
    }

    if (err.keyPattern && (err.keyPattern.usernameNormalized || err.keyPattern.username)) {
      return res.status(409).json({ message: "Username already in use" });
    }
  }

  console.error("Unhandled API error", {
    method: req.method,
    path: req.originalUrl,
    body: redactBody(req.body),
    message: err && err.message ? err.message : "unknown_error"
  });

  res.status(500).json({ message: "Internal server error" });
};
