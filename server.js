import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ===== ROOT ===== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ===== SAFE LIMITS (CONSERVATIVE) ===== */
const HOURLY_LIMIT = 25;     // per Gmail / hour
const DAILY_LIMIT  = 80;     // per Gmail / day
const PARALLEL = 3;          // SAME SPEED
const BASE_DELAY_MS = 120;   // SAME SPEED

/* ===== STATE ===== */
let hourlyCount = {};
let dailyCount = {};
let failStreak = {};

/* Resets */
setInterval(() => {
  hourlyCount = {};
  failStreak = {};
}, 60 * 60 * 1000);

setInterval(() => {
  dailyCount = {};
}, 24 * 60 * 60 * 1000);

/* ===== HELPERS (NO TEXT CHANGE) ===== */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function delayWithJitter() {
  const jitter = Math.floor(Math.random() * 41) - 20; // ±20ms (human-like)
  return new Promise(r => setTimeout(r, BASE_DELAY_MS + jitter));
}

async function sendSafely(transporter, mails, gmail) {
  let sent = 0;

  for (let i = 0; i < mails.length; i += PARALLEL) {
    const batch = mails.slice(i, i + PARALLEL);

    const results = await Promise.allSettled(
      batch.map(m => transporter.sendMail(m))
    );

    results.forEach(r => {
      if (r.status === "fulfilled") {
        sent++;
        failStreak[gmail] = 0;
      } else {
        failStreak[gmail] = (failStreak[gmail] || 0) + 1;
        console.log("Send error:", r.reason?.message);
      }
    });

    await delayWithJitter();

    // Protect account if repeated failures
    if ((failStreak[gmail] || 0) >= 5) break;
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

  // Validate recipients ONLY (no content change)
  let recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  recipients = [...new Set(recipients)];
  if (recipients.length === 0)
    return res.json({ success: false, msg: "No valid recipients" });

  // Init counters
  if (!hourlyCount[gmail]) hourlyCount[gmail] = 0;
  if (!dailyCount[gmail])  dailyCount[gmail]  = 0;

  // Limit checks
  if (hourlyCount[gmail] >= HOURLY_LIMIT)
    return res.json({ success: false, msg: "Hourly limit reached" });

  if (dailyCount[gmail] >= DAILY_LIMIT)
    return res.json({ success: false, msg: "Daily limit reached" });

  const allowedNow = Math.min(
    HOURLY_LIMIT - hourlyCount[gmail],
    DAILY_LIMIT  - dailyCount[gmail]
  );

  if (recipients.length > allowedNow)
    return res.json({
      success: false,
      msg: `Limit reached. Allowed now: ${allowedNow}`
    });

  // Trusted Gmail SMTP
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmail, pass: apppass }
  });

  try {
    await transporter.verify();
  } catch {
    return res.json({ success: false, msg: "Gmail login failed" });
  }

  // IMPORTANT: Subject & message go EXACTLY as provided
  const mails = recipients.map(r => ({
    from: `"${(senderName || "").trim() || gmail}" <${gmail}>`,
    to: r,
    subject: subject, // unchanged
    text: message,    // unchanged
    replyTo: gmail
  }));

  const sent = await sendSafely(transporter, mails, gmail);

  hourlyCount[gmail] += sent;
  dailyCount[gmail]  += sent;

  return res.json({
    success: true,
    sent,
    hourly: hourlyCount[gmail],
    daily: dailyCount[gmail]
  });
});

/* ===== START ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Safe Mail Server running on port", PORT);
});
