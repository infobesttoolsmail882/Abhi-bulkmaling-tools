import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ===== INBOX-SAFE LIMITS (VERY CONSERVATIVE) ===== */
const HOURLY_LIMIT = 20;     // safer than 25
const DAILY_LIMIT  = 60;     // safer than 80
const PARALLEL = 3;          // SAME SPEED RANGE
const BASE_DELAY_MS = 120;   // SAME SPEED RANGE

let hourly = {};
let daily = {};
let failStreak = {};

/* Resets */
setInterval(() => {
  hourly = {};
  failStreak = {};
}, 60 * 60 * 1000);

setInterval(() => {
  daily = {};
}, 24 * 60 * 60 * 1000);

/* ===== HELPERS ===== */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function delayWithJitter() {
  const jitter = Math.floor(Math.random() * 41) - 20; // ±20ms
  return new Promise(r => setTimeout(r, BASE_DELAY_MS + jitter));
}

/* ===== CONTROLLED SENDER ===== */
async function sendSafely(transporter, mails, gmail) {
  let sent = 0;

  for (let i = 0; i < mails.length; i += PARALLEL) {
    const batch = mails.slice(i, i + PARALLEL);

    const results = await Promise.allSettled(
      batch.map(m => transporter.sendMail(m))
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        sent++;
        failStreak[gmail] = 0;
      } else {
        failStreak[gmail] = (failStreak[gmail] || 0) + 1;
        console.log("Send error:", r.reason?.message);
      }
    }

    await delayWithJitter();

    // Inbox protection: stop early if repeated failures
    if ((failStreak[gmail] || 0) >= 4) break;
  }

  return sent;
}

/* ===== SEND API ===== */
app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message)
    return res.json({ success: false, msg: "Missing fields" });

  if (!emailRegex.test(gmail))
    return res.json({ success: false, msg: "Invalid Gmail" });

  // One-by-one recipients (NO content change)
  let recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  recipients = [...new Set(recipients)];
  if (recipients.length === 0)
    return res.json({ success: false, msg: "No valid recipients" });

  // Init counters
  if (!hourly[gmail]) hourly[gmail] = 0;
  if (!daily[gmail])  daily[gmail]  = 0;

  // Limits
  if (hourly[gmail] >= HOURLY_LIMIT)
    return res.json({ success: false, msg: "Hourly limit reached" });

  if (daily[gmail] >= DAILY_LIMIT)
    return res.json({ success: false, msg: "Daily limit reached" });

  const allowedNow = Math.min(
    HOURLY_LIMIT - hourly[gmail],
    DAILY_LIMIT  - daily[gmail]
  );

  if (recipients.length > allowedNow)
    return res.json({
      success: false,
      msg: `Limit reached. Allowed now: ${allowedNow}`
    });

  // Gmail SMTP (trusted)
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmail, pass: apppass }
  });

  try {
    await transporter.verify();
  } catch {
    return res.json({ success: false, msg: "Gmail login failed" });
  }

  // IMPORTANT: SUBJECT & MESSAGE EXACTLY SAME
  const mails = recipients.map(r => ({
    from: `"${(senderName || "").trim() || gmail}" <${gmail}>`,
    to: r,
    subject: subject,
    text: message,          // plain text only
    replyTo: gmail,
    headers: {
      "X-Mailer": "Mail"
    }
  }));

  const sent = await sendSafely(transporter, mails, gmail);

  hourly[gmail] += sent;
  daily[gmail]  += sent;

  return res.json({
    success: true,
    sent,
    hourly: hourly[gmail],
    daily: daily[gmail]
  });
});

/* ===== START ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("REAL INBOX-SAFE Mail Server running on port", PORT);
});
