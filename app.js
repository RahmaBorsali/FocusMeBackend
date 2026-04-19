const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes    = require("./routes/auth.routes");
const errorMiddleware = require("./middleware/error");
const usersRoutes   = require("./routes/users.routes");
const profileRoutes = require("./routes/profile.routes");
const friendsRoutes = require("./routes/friends.routes");
const tasksRoutes    = require("./routes/tasks");
const statsRoutes    = require("./routes/stats");
const feedRoutes     = require("./routes/feed");
const sessionsRoutes = require("./routes/sessions");
const challengesRoutes = require("./routes/challenges");
const chatRoutes = require("./routes/chat.routes");
const musicRoutes = require("./routes/music.routes");

const app = express();
app.set("trust proxy", 1);

const isProduction = process.env.NODE_ENV === "production";
const corsOrigins = String(process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);


app.use(helmet({
  hsts: isProduction
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.includes("*") || corsOrigins.includes(origin)) {
      return callback(null, true);
    }
    const err = new Error("CORS origin denied");
    err.statusCode = 403;
    err.body = { message: "CORS origin denied" };
    return callback(err);
  },
  credentials: process.env.CORS_CREDENTIALS === "true"
}));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

if (process.env.ENFORCE_HTTPS === "true") {
  app.use((req, res, next) => {
    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
      return next();
    }
    return res.status(400).json({ message: "HTTPS is required" });
  });
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many authentication requests, please try again later." }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Too many login attempts, please try again later." }
});
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.SIGNUP_RATE_LIMIT_MAX || 8),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many signup attempts, please try again later." }
});

app.use("/auth", authLimiter);
app.use("/auth/login", loginLimiter);
app.use("/auth/google", loginLimiter);
app.use("/auth/signup", signupLimiter);
app.use("/auth", authRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/profile",    profileRoutes);
app.use("/users",      usersRoutes);
app.use("/friends",    friendsRoutes);
app.use("/api/tasks",    tasksRoutes);
app.use("/api/stats",    statsRoutes);
app.use("/api/feed",     feedRoutes);
app.use("/api/sessions", sessionsRoutes);
app.use("/api/challenges", challengesRoutes);
app.use("/api/chat", chatRoutes);
app.use("/music", musicRoutes);

app.use(errorMiddleware);

module.exports = app;
