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

/* ================= SAFE CONFIG ================= */

const DAILY_LIMIT = 28;      // 1 Gmail = 28 emails
const HOURLY_LIMIT = 14;     // extra protection
const PARALLEL = 3;          // fast but controlled
const BASE_DELAY = 110;      // fast speed
const MAX_FAIL = 3;          // stop if repeated errors

let dailyCount = {};
let hourlyCount = {};
let failCount = {};

/* Reset hourly */
setInterval(() => {
  hourlyCount = {};
}, 60 * 60 * 1000);

/* Reset daily */
setInterval(() => {
  dailyCount = {};
  failCount = {};
}, 24 * 60 * 60 * 1000);

/* ================= HELPERS ================= */

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function delay() {
  return new Promise(resolve =>
    setTimeout(resolve, BASE_DELAY + Math.floor(Math.random() * 40))
  );
}

async function sendBatch(transporter, mails, gmail) {
  let sent = 0;

  for (let i = 0; i < mails.length; i += PARALLEL) {
    const batch = mails.slice(i, i + PARALLEL);

    const results = await Promise.allSettled(
      batch.map(m => transporter.sendMail(m))
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        sent++;
        dailyCount[gmail] = (dailyCount[gmail] || 0) + 1;
        hourlyCount[gmail] = (hourlyCount[gmail] || 0) + 1;
        failCount[gmail] = 0;
      } else {
        failCount[gmail] = (failCount[gmail] || 0) + 1;
      }
    }

    await delay();

    if (failCount[gmail] >= MAX_FAIL) break;
  }

  return sent;
}

/* ================= SEND ROUTE ================= */

app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message)
    return res.json({ success: false, msg: "Missing fields" });

  if (!emailRegex.test(gmail))
    return res.json({ success: false, msg: "Invalid Gmail" });

  dailyCount[gmail] = dailyCount[gmail] || 0;
  hourlyCount[gmail] = hourlyCount[gmail] || 0;

  if (dailyCount[gmail] >= DAILY_LIMIT)
    return res.json({ success: false, msg: "Daily limit reached (28)" });

  if (hourlyCount[gmail] >= HOURLY_LIMIT)
    return res.json({ success: false, msg: "Hourly limit reached" });

  let recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  recipients = [...new Set(recipients)];

  const allowed = Math.min(
    DAILY_LIMIT - dailyCount[gmail],
    HOURLY_LIMIT - hourlyCount[gmail]
  );

  if (recipients.length > allowed)
    return res.json({ success: false, msg: `Only ${allowed} allowed now` });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmail,
      pass: apppass
    }
  });

  try {
    await transporter.verify();
  } catch {
    return res.json({ success: false, msg: "Authentication failed" });
  }

  const mails = recipients.map(r => ({
    from: `"${(senderName || "").trim() || gmail}" <${gmail}>`,
    to: r,
    subject: subject,   // unchanged
    text: message,      // unchanged (plain text only)
    replyTo: gmail
  }));

  const sent = await sendBatch(transporter, mails, gmail);

  res.json({
    success: true,
    sent,
    usedToday: dailyCount[gmail],
    limit: DAILY_LIMIT
  });
});

/* ================= START ================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Safe Mail Server running on port", PORT);
});
