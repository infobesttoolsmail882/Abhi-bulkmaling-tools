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

/* ==============================
   SAFE CONFIGURATION
============================== */

const DAILY_LIMIT = 28;        // 1 Gmail = 28 emails/day
const HOURLY_LIMIT = 12;       // extra protection
const DELAY_MS = 130;          // natural delay
const MAX_FAILS = 3;           // stop on repeated errors

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

/* ==============================
   HELPERS
============================== */

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function wait() {
  return new Promise(resolve =>
    setTimeout(resolve, DELAY_MS + Math.floor(Math.random() * 50))
  );
}

async function sendSafely(transporter, mails, gmail) {
  let sent = 0;

  for (const mail of mails) {
    try {
      await transporter.sendMail(mail);

      sent++;
      dailyCount[gmail] = (dailyCount[gmail] || 0) + 1;
      hourlyCount[gmail] = (hourlyCount[gmail] || 0) + 1;
      failCount[gmail] = 0;

    } catch (err) {
      failCount[gmail] = (failCount[gmail] || 0) + 1;
      console.log("Send error:", err.message);

      if (failCount[gmail] >= MAX_FAILS) break;
    }

    await wait();
  }

  return sent;
}

/* ==============================
   SEND ROUTE
============================== */

app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message)
    return res.json({ success: false, msg: "Missing required fields" });

  if (!emailRegex.test(gmail))
    return res.json({ success: false, msg: "Invalid Gmail address" });

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
    return res.json({
      success: false,
      msg: `Only ${allowed} emails allowed now`
    });

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
    return res.json({ success: false, msg: "Gmail authentication failed" });
  }

  const mails = recipients.map(r => ({
    from: `"${(senderName || "").trim() || gmail}" <${gmail}>`,
    to: r,
    subject: subject,     // unchanged
    text: message,        // unchanged (plain text)
    replyTo: gmail
  }));

  const sent = await sendSafely(transporter, mails, gmail);

  res.json({
    success: true,
    sent,
    dailyUsed: dailyCount[gmail],
    dailyLimit: DAILY_LIMIT
  });
});

/* ==============================
   START SERVER
============================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Safe Mail Server running on port", PORT);
});
