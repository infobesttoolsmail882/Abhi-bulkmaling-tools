import express from "express";
import nodemailer from "nodemailer";

const app = express();
app.disable("x-powered-by");

/* ===============================
   CONFIGURATION
================================= */

const PORT = process.env.PORT || 3000;
const HOURLY_LIMIT = 25; // safe hourly limit
const MIN_DELAY = 150;   // ms
const MAX_DELAY = 250;   // ms
const MAX_RECIPIENTS_PER_REQUEST = 20;

/* ===============================
   MIDDLEWARE
================================= */

app.use(express.json({ limit: "100kb" }));

/* ===============================
   MEMORY RATE LIMIT
================================= */

let stats = {};

setInterval(() => {
  stats = {};
}, 60 * 60 * 1000);

/* ===============================
   HELPERS
================================= */

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const randomDelay = () =>
  Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;

const sanitizeSubject = subject =>
  (subject || "").trim().slice(0, 150);

const sanitizeText = text =>
  (text || "").replace(/\r\n/g, "\n").trim().slice(0, 5000);

/* ===============================
   SEND EMAIL ROUTE
================================= */

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

    if (!gmail || !apppass || !recipients || !subject || !message)
      return res.status(400).json({ success: false, msg: "Missing required fields" });

    if (!emailRegex.test(gmail))
      return res.status(400).json({ success: false, msg: "Invalid sender email" });

    const list = recipients
      .split(/,|\n/)
      .map(e => e.trim())
      .filter(e => emailRegex.test(e));

    if (list.length === 0)
      return res.status(400).json({ success: false, msg: "No valid recipients" });

    if (list.length > MAX_RECIPIENTS_PER_REQUEST)
      return res.status(400).json({ success: false, msg: "Too many recipients in one request" });

    if (!stats[gmail]) stats[gmail] = { count: 0 };

    if (stats[gmail].count >= HOURLY_LIMIT)
      return res.status(429).json({ success: false, msg: "Hourly sending limit reached" });

    const remaining = HOURLY_LIMIT - stats[gmail].count;

    if (list.length > remaining)
      return res.status(429).json({ success: false, msg: "Hourly quota exceeded" });

    /* -------- Transporter -------- */

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

    let sentCount = 0;

    for (const recipient of list) {

      await transporter.sendMail({
        from: `"${(senderName || gmail).trim()}" <${gmail}>`,
        to: recipient,
        subject: sanitizeSubject(subject),
        text: sanitizeText(message),
        replyTo: gmail
      });

      sentCount++;
      stats[gmail].count++;

      await sleep(randomDelay());
    }

    return res.json({
      success: true,
      sent: sentCount
    });

  } catch (error) {
    console.error("Error:", error.message);
    return res.status(500).json({
      success: false,
      msg: "Internal server error"
    });
  }
});

/* ===============================
   START SERVER
================================= */

app.listen(PORT, () => {
  console.log(`✅ Clean Mail Server running on port ${PORT}`);
});
