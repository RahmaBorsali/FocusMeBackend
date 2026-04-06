require("dotenv").config();
const http = require("http");

const app = require("./app");
const { connectDB } = require("./config/db");
const { createSocketServer } = require("./socket");

(async () => {
  await connectDB(process.env.MONGO_URI);

  const server = http.createServer(app);
  const io = createSocketServer(server);
  app.set("io", io);

  server.listen(process.env.PORT || 4000, () => {
    console.log(`API running on http://localhost:${process.env.PORT || 4000}`);
  });
})();
