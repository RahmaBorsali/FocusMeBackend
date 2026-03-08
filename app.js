const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth.routes");
const errorMiddleware = require("./middleware/error");
const usersRoutes = require("./routes/users.routes");
const friendsRoutes = require("./routes/friends.routes");
const app = express();

app.use(helmet());
app.use(cors({ origin: "*", credentials: false }));
app.use(express.json());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use("/auth", authLimiter, authRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(errorMiddleware);
app.use("/users", usersRoutes);

app.use("/friends", friendsRoutes);

module.exports = app;