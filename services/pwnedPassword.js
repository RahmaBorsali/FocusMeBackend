const crypto = require("crypto");
const fetch = require("node-fetch");

async function isPwnedPassword(password) {
  const sha1 = crypto.createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  if (!res.ok) throw new Error("HIBP request failed");

  const text = await res.text();
  for (const line of text.split("\n")) {
    const [hashSuffix] = line.trim().split(":");
    if (hashSuffix === suffix) return true;
  }
  return false;
}

module.exports = { isPwnedPassword };