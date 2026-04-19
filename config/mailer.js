const nodemailer = require("nodemailer");

async function createTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.error("❌ ERREUR MAILER: GMAIL_USER ou GMAIL_APP_PASSWORD manquant dans le .env");
    throw new Error("Configuration email incomplète dans le .env");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: user,
      pass: pass,
    },
  });
}

module.exports = { createTransport };