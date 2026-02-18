import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "60kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ================= SAFE CONFIG ================= */

const LIMIT_4H = 28;
const WINDOW_TIME = 4 * 60 * 60 * 1000;   // 4 hours
const MIN_DELAY = 150;
const MAX_DELAY = 250;
const MAX_FAIL = 2;                        // strict protection

let usageMap = {};   // { gmail: { count, windowStart } }
let failMap = {};

/* ================= HELPERS ================= */

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function randomDelay() {
  const time = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
  return new Promise(r => setTimeout(r, time));
}

function getUsage(gmail) {
  const now = Date.now();

  if (!usageMap[gmail]) {
    usageMap[gmail] = { count: 0, windowStart: now };
  }

  const elapsed = now - usageMap[gmail].windowStart;

  if (elapsed >= WINDOW_TIME) {
    usageMap[gmail] = { count: 0, windowStart: now };
  }

  return usageMap[gmail];
}

async function sendSafely(transporter, mails, gmail) {
  let sent = 0;

  for (const mail of mails) {
    try {
      await transporter.sendMail(mail);
      sent++;
      usageMap[gmail].count++;
      failMap[gmail] = 0;
    } catch (err) {
      failMap[gmail] = (failMap[gmail] || 0) + 1;

      if (failMap[gmail] >= MAX_FAIL) break;
    }

    await randomDelay();
  }

  return sent;
}

/* ================= SEND ROUTE ================= */

app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message)
    return res.json({ success:false, msg:"Missing fields" });

  if (!emailRegex.test(gmail))
    return res.json({ success:false, msg:"Invalid Gmail address" });

  const usage = getUsage(gmail);

  if (usage.count >= LIMIT_4H)
    return res.json({
      success:false,
      msg:"28 email limit reached (4-hour window)"
    });

  let recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  recipients = [...new Set(recipients)];

  const remaining = LIMIT_4H - usage.count;

  if (recipients.length > remaining)
    return res.json({
      success:false,
      msg:`Only ${remaining} emails allowed in this window`
    });

  const transporter = nodemailer.createTransport({
    service:"gmail",
    auth:{ user:gmail, pass:apppass }
  });

  try {
    await transporter.verify();
  } catch {
    return res.json({ success:false, msg:"Authentication failed" });
  }

  const mails = recipients.map(r => ({
    from:`"${(senderName||"").trim()||gmail}" <${gmail}>`,
    to:r,
    subject:subject,
    text:message,
    replyTo:gmail
  }));

  const sent = await sendSafely(transporter, mails, gmail);

  res.json({
    success:true,
    sent,
    used:usageMap[gmail].count,
    limit:LIMIT_4H
  });
});

/* ================= START ================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Strict Safe Mail Server running on port", PORT);
});
