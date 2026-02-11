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

/* ===== SAME SPEED (UNCHANGED) ===== */
const HOURLY_LIMIT = 28;      // per Gmail ID
const PARALLEL = 3;           // same speed
const BASE_DELAY_MS = 120;    // same speed range

/* ===== STATE ===== */
let stats = {};               // hourly count per gmail
let failStreak = {};          // consecutive failures

setInterval(() => {
  stats = {};
  failStreak = {};
}, 60 * 60 * 1000);

/* ===== VALIDATION ONLY (NO TEXT CHANGES) ===== */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Natural delay with tiny jitter (pattern looks human; speed same) */
function delayWithJitter(base) {
  const jitter = Math.floor(Math.random() * 41) - 20; // -20..+20 ms
  return new Promise(r => setTimeout(r, base + jitter));
}

/* Controlled parallel sender */
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

    await delayWithJitter(BASE_DELAY_MS);

    // Protect account if repeated failures
    if ((failStreak[gmail] || 0) >= 5) break;
  }

  return sent;
}

/* ===== SEND API ===== */
app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  // Required fields
  if (!gmail || !apppass || !to || !subject || !message) {
    return res.json({ success: false, msg: "Missing fields" });
  }

  // Validate sender email
  if (!emailRegex.test(gmail)) {
    return res.json({ success: false, msg: "Invalid Gmail" });
  }

  // Validate recipients (no modification of text)
  let recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  // Remove duplicates only
  recipients = [...new Set(recipients)];

  if (recipients.length === 0) {
    return res.json({ success: false, msg: "No valid recipients" });
  }

  // Hourly cap
  if (!stats[gmail]) stats[gmail] = { count: 0 };
  if (stats[gmail].count >= HOURLY_LIMIT) {
    return res.json({ success: false, msg: "Hourly limit reached" });
  }

  const remaining = HOURLY_LIMIT - stats[gmail].count;
  if (recipients.length > remaining) {
    return res.json({ success: false, msg: "Limit full" });
  }

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

  // IMPORTANT: Subject & message sent EXACTLY as provided (no changes)
  const mails = recipients.map(r => ({
    from: `"${(senderName || "").trim() || gmail}" <${gmail}>`,
    to: r,
    subject: subject,     // unchanged
    text: message,        // unchanged
    replyTo: gmail
  }));

  const sent = await sendSafely(transporter, mails, gmail);
  stats[gmail].count += sent;

  return res.json({ success: true, sent });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Safe Mail Server running (templates unchanged)");
});
