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

/* SAME SPEED (BASE) */
const HOURLY_LIMIT = 28;
const PARALLEL = 3;
const BASE_DELAY_MS = 120; // base same speed

/* Reputation-safe state */
let stats = {};
let failStreak = {};

setInterval(() => {
  stats = {};
  failStreak = {};
}, 60 * 60 * 1000);

/* Helpers (no spam tricks) */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanSubject = s => (s || "").replace(/\s+/g, " ").trim().slice(0, 150);
const cleanText = t => (t || "").replace(/\r\n/g, "\n").trim().slice(0, 5000);

/* Small natural jitter around same speed (±20ms) */
function delayWithJitter(base) {
  const jitter = Math.floor(Math.random() * 41) - 20; // -20..+20
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
        console.log("Send fail:", r.reason?.message);
        failStreak[gmail] = (failStreak[gmail] || 0) + 1;
      }
    });

    // keep same speed range
    await delayWithJitter(BASE_DELAY_MS);

    // protect account if many consecutive failures
    if ((failStreak[gmail] || 0) >= 5) {
      console.log("Stopping early due to repeated failures");
      break;
    }
  }

  return sent;
}

app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message) {
    return res.json({ success: false, msg: "Missing fields" });
  }

  if (!emailRegex.test(gmail)) {
    return res.json({ success: false, msg: "Invalid Gmail" });
  }

  /* Prepare recipients: valid + unique */
  let recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  recipients = [...new Set(recipients)];

  if (recipients.length === 0) {
    return res.json({ success: false, msg: "No valid recipients" });
  }

  if (!stats[gmail]) stats[gmail] = { count: 0 };
  if (stats[gmail].count >= HOURLY_LIMIT) {
    return res.json({ success: false, msg: "Hourly limit reached" });
  }

  const remaining = HOURLY_LIMIT - stats[gmail].count;
  if (recipients.length > remaining) {
    return res.json({ success: false, msg: "Limit full for this Gmail" });
  }

  /* Standard Gmail SMTP */
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmail, pass: apppass }
  });

  try {
    await transporter.verify();
  } catch (err) {
    console.log("SMTP ERROR:", err.message);
    return res.json({ success: false, msg: "Gmail login failed" });
  }

  /* One message per recipient */
  const mails = recipients.map(r => ({
    from: `"${(senderName || "").trim() || gmail}" <${gmail}>`,
    to: r,
    subject: cleanSubject(subject),
    text: cleanText(message),
    replyTo: gmail
  }));

  const sent = await sendSafely(transporter, mails, gmail);
  stats[gmail].count += sent;

  return res.json({ success: true, sent });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Most Safe-Practice Mail Server running");
});
