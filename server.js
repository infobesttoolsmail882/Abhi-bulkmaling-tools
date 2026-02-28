const express = require("express");
const nodemailer = require("nodemailer");
const rateLimit = require("express-rate-limit");

const app = express();
app.use(express.json());

/* ===============================
   SAFE CONFIG
================================ */

const BATCH_SIZE = 5;
const BATCH_DELAY = 300; // 300ms
const HOURLY_LIMIT = 27;

let sentThisHour = 0;
let hourStart = Date.now();

/* ===============================
   HELPER
================================ */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resetHourlyLimit() {
  const now = Date.now();
  if (now - hourStart >= 60 * 60 * 1000) {
    sentThisHour = 0;
    hourStart = now;
  }
}

/* ===============================
   SAFE SEND FUNCTION
================================ */

async function sendBatch(transporter, mails) {
  let success = 0;

  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const chunk = mails.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      chunk.map(mail => transporter.sendMail(mail))
    );

    results.forEach(r => {
      if (r.status === "fulfilled") success++;
    });

    const jitter = Math.floor(Math.random() * 120);
    await delay(BATCH_DELAY + jitter);
  }

  return success;
}

/* ===============================
   ROUTE
================================ */

app.post("/send", async (req, res) => {
  try {
    resetHourlyLimit();

    const { email, password, subject, message, recipients } = req.body;

    if (!email || !password || !subject || !message || !recipients?.length) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (sentThisHour >= HOURLY_LIMIT) {
      return res.status(429).json({
        error: "Hourly limit reached. Try after 1 hour."
      });
    }

    const allowedToSend = Math.min(
      HOURLY_LIMIT - sentThisHour,
      recipients.length
    );

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 5,
      maxMessages: 50,
      auth: {
        user: email,
        pass: password
      }
    });

    const mailList = recipients.slice(0, allowedToSend).map(to => ({
      from: `"${email}" <${email}>`,
      to,
      subject,
      text: message,
      headers: {
        "X-Mailer": "NodeMailer",
      }
    }));

    const successCount = await sendBatch(transporter, mailList);

    sentThisHour += successCount;

    return res.json({
      message: `Send ${successCount}`
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Sending failed" });
  }
});

/* ===============================
   SERVER
================================ */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
