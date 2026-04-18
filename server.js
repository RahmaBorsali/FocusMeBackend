require("dotenv").config();
const http = require("http");
const https = require("https");
const fs = require("fs");

const app = require("./app");
const { connectDB } = require("./config/db");
const { createSocketServer } = require("./socket");

(async () => {
  await connectDB(process.env.MONGO_URI);

  const useHttps = process.env.HTTPS_ENABLED === "true" && process.env.HTTPS_KEY_PATH && process.env.HTTPS_CERT_PATH;
  const server = useHttps
    ? https.createServer(
      {
        key: fs.readFileSync(process.env.HTTPS_KEY_PATH),
        cert: fs.readFileSync(process.env.HTTPS_CERT_PATH)
      },
      app
    )
    : http.createServer(app);
  const io = createSocketServer(server);
  app.set("io", io);

  server.listen(process.env.PORT || 4000, () => {
    console.log(`API running on ${useHttps ? "https" : "http"}://192.168.1.6:${process.env.PORT || 4000}`);
  });
})();
