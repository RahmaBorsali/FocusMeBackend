require("dotenv").config();
const app = require("./app");
const { connectDB } = require("./config/db");

(async () => {
  await connectDB(process.env.MONGO_URI);
  app.listen(process.env.PORT || 4000, () => {
    console.log(`✅ API running on http://localhost:${process.env.PORT || 4000}`);
  });
})();