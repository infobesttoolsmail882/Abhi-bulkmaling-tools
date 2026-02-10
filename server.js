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

/* SAME SPEED SETTINGS */
const HOURLY_LIMIT = 28;   // per Gmail ID
const PARALLEL = 3;        // same speed
const BASE_DELAY_MS = 120; // same speed range

let stats = {};
let failStreak = {};

setInterval(() => {
  stats = {};
  failStreak = {};
}, 60 * 60 * 1000);

/* Helpers: validation + light cleanup (no spam tricks) */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanSubject = s => (s || "").replace(/\s+/g, " ").trim().slice(0, 150);
const cleanText = t => (t || "").replace(/\r\n/g, "\n").trim().slice(0, 5000);

function delayWithJitter(base) {
  const jitter = Math.floor(Math.random() * 41) - 20; // -20..+20 ms
  return new Promise(r => setTimeout(r, base + jitter));
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
        console.log("Send fail:", r.reason?.message);
        failStreak[gmail] = (failStreak[gmail] || 0) + 1;
      }
    });

    await delayWithJitter(BASE_DELAY_MS);

    // Protect reputation if many consecutive failures
    if ((failStreak[gmail] || 0) >= 5) break;
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

  /* Standard Gmail SMTP (trusted config) */
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

  /* Send exactly the user's message (no footer added) */
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
  console.log("Safe Mail Server running (no footer)");
});
