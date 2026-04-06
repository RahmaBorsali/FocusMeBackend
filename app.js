const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes    = require("./routes/auth.routes");
const errorMiddleware = require("./middleware/error");
const usersRoutes   = require("./routes/users.routes");
const friendsRoutes = require("./routes/friends.routes");
const tasksRoutes    = require("./routes/tasks");
const statsRoutes    = require("./routes/stats");
const feedRoutes     = require("./routes/feed");
const sessionsRoutes = require("./routes/sessions");
const challengesRoutes = require("./routes/challenges");
const chatRoutes = require("./routes/chat.routes");

const app = express();

app.use(helmet());
app.use(cors({ origin: "*", credentials: false }));
app.use(express.json());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use("/auth", authLimiter, authRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/users",      usersRoutes);
app.use("/friends",    friendsRoutes);
app.use("/api/tasks",    tasksRoutes);
app.use("/api/stats",    statsRoutes);
app.use("/api/feed",     feedRoutes);
app.use("/api/sessions", sessionsRoutes);
app.use("/api/challenges", challengesRoutes);
app.use("/api/chat", chatRoutes);

app.use(errorMiddleware);

module.exports = app;
