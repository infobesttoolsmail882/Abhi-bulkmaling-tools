import express from "express";
import nodemailer from "nodemailer";

const app = express();
app.disable("x-powered-by");

const PORT = process.env.PORT || 3000;

/* =============================
   SAFE LIMIT SETTINGS
============================= */

const HOURLY_LIMIT = 25;
const MIN_DELAY = 150;
const MAX_DELAY = 250;
const MAX_RECIPIENTS = 20;

/* =============================
   MIDDLEWARE
============================= */

app.use(express.json({ limit: "100kb" }));

/* =============================
   HOURLY MEMORY LIMIT RESET
============================= */

let stats = {};

setInterval(() => {
  stats = {};
}, 60 * 60 * 1000);

/* =============================
   HELPERS
============================= */

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const randomDelay = () =>
  Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;

const cleanSubject = s =>
  (s || "").trim().slice(0, 150);

const cleanText = t =>
  (t || "").replace(/\r\n/g, "\n").trim().slice(0, 5000);

/* =============================
   SEND ROUTE
============================= */

app.post("/send", async (req, res) => {
  try {
    const {
      senderName,
      gmail,
      apppass,
      recipients,
      subject,
      message
    } = req.body;

    /* -------- Validation -------- */

    if (!gmail || !apppass || !recipients || !subject || !message) {
      return res.status(400).json({
        success: false,
        msg: "Missing required fields"
      });
    }

    if (!emailRegex.test(gmail)) {
      return res.status(400).json({
        success: false,
        msg: "Invalid sender email"
      });
    }

    const list = recipients
      .split(/,|\n/)
      .map(e => e.trim())
      .filter(e => emailRegex.test(e));

    if (list.length === 0) {
      return res.status(400).json({
        success: false,
        msg: "No valid recipients"
      });
    }

    if (list.length > MAX_RECIPIENTS) {
      return res.status(400).json({
        success: false,
        msg: "Too many recipients in one request"
      });
    }

    if (!stats[gmail]) stats[gmail] = { count: 0 };

    if (stats[gmail].count >= HOURLY_LIMIT) {
      return res.status(429).json({
        success: false,
        msg: "Hourly sending limit reached"
      });
    }

    const remaining = HOURLY_LIMIT - stats[gmail].count;

    if (list.length > remaining) {
      return res.status(429).json({
        success: false,
        msg: "Hourly quota exceeded"
      });
    }

    /* -------- Transport -------- */

    const transporter = nodemailer.createTransport({
      service: "gmail",
      secure: true,
      pool: true,
      maxConnections: 2,
      maxMessages: 50,
      auth: {
        user: gmail,
        pass: apppass
      }
    });

    await transporter.verify();

    /* -------- Sending -------- */

    let sent = 0;

    for (const recipient of list) {
      await transporter.sendMail({
        from: `"${(senderName || gmail).trim()}" <${gmail}>`,
        to: recipient,
        subject: cleanSubject(subject),
        text: cleanText(message),
        replyTo: gmail
      });

      sent++;
      stats[gmail].count++;

      await sleep(randomDelay());
    }

    return res.json({
      success: true,
      sent
    });

  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({
      success: false,
      msg: "Server error"
    });
  }
});

/* =============================
   START SERVER
============================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
