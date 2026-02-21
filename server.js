import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable("x-powered-by");

const PORT = process.env.PORT || 3000;

/* =============================
   SAFE BULK SETTINGS
============================= */

const HOURLY_LIMIT = 100;        // total per hour
const BATCH_SIZE = 5;            // parallel per batch
const DELAY_BETWEEN_BATCH = 2000; // 2 sec gap
const MAX_PER_REQUEST = 50;      // per API call

/* =============================
   MIDDLEWARE
============================= */

app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* =============================
   HOURLY MEMORY LIMIT
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

const cleanSubject = s =>
  (s || "").trim().slice(0, 150);

const cleanText = t =>
  (t || "").replace(/\r\n/g, "\n").trim().slice(0, 8000);

/* =============================
   BULK SAFE SENDER
============================= */

async function sendBulk(transporter, mails) {
  let sent = 0;

  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const batch = mails.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(mail => transporter.sendMail(mail))
    );

    results.forEach(r => {
      if (r.status === "fulfilled") sent++;
      else console.log("Send failed:", r.reason?.message);
    });

    await sleep(DELAY_BETWEEN_BATCH);
  }

  return sent;
}

/* =============================
   SEND ROUTE
============================= */

app.post("/send", async (req, res) => {
  try {
    const { senderName, gmail, apppass, to, subject, message } = req.body;

    if (!gmail || !apppass || !to || !subject || !message) {
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

    const recipients = to
      .split(/,|\n/)
      .map(e => e.trim())
      .filter(e => emailRegex.test(e));

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        msg: "No valid recipients"
      });
    }

    if (recipients.length > MAX_PER_REQUEST) {
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

    if (recipients.length > remaining) {
      return res.status(429).json({
        success: false,
        msg: "Hourly quota exceeded"
      });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      auth: {
        user: gmail,
        pass: apppass
      }
    });

    await transporter.verify();

    const mails = recipients.map(recipient => ({
      from: `"${(senderName || gmail).trim()}" <${gmail}>`,
      to: recipient,
      subject: cleanSubject(subject),
      text: cleanText(message),
      replyTo: gmail
    }));

    const sent = await sendBulk(transporter, mails);

    stats[gmail].count += sent;

    return res.json({
      success: true,
      sent
    });

  } catch (err) {
    console.error("Server Error:", err.message);
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
  console.log("✅ Clean Bulk Mail Server Running");
});
