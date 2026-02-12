import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ===== SAFE CONFIG ===== */
const MAX_PER_ID = 28;     // 1 Gmail = 28 mails
const DELAY_MS = 150;      // gentle delay
const MAX_FAIL = 3;        // stop after 3 failures

let sentToday = {};
let failCount = {};

/* Reset every 24h */
setInterval(() => {
  sentToday = {};
  failCount = {};
  console.log("Daily reset complete");
}, 24 * 60 * 60 * 1000);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function wait() {
  return new Promise(r =>
    setTimeout(r, DELAY_MS + Math.floor(Math.random() * 60))
  );
}

async function sendOneByOne(transporter, mails, gmail) {
  let sent = 0;

  for (const mail of mails) {
    try {
      await transporter.sendMail(mail);
      sent++;
      sentToday[gmail] = (sentToday[gmail] || 0) + 1;
      failCount[gmail] = 0;
    } catch (err) {
      console.log("Send error:", err.message);
      failCount[gmail] = (failCount[gmail] || 0) + 1;

      if (failCount[gmail] >= MAX_FAIL) break;
    }

    await wait();
  }

  return sent;
}

app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message)
    return res.json({ success: false, msg: "Missing fields" });

  if (!emailRegex.test(gmail))
    return res.json({ success: false, msg: "Invalid Gmail" });

  sentToday[gmail] = sentToday[gmail] || 0;

  if (sentToday[gmail] >= MAX_PER_ID)
    return res.json({
      success: false,
      msg: "28 emails limit reached for this Gmail ID"
    });

  let recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  recipients = [...new Set(recipients)];

  const remaining = MAX_PER_ID - sentToday[gmail];

  if (recipients.length > remaining)
    return res.json({
      success: false,
      msg: `Only ${remaining} emails allowed today`
    });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmail, pass: apppass }
  });

  try {
    await transporter.verify();
  } catch {
    return res.json({ success: false, msg: "Gmail login failed" });
  }

  /* SUBJECT & MESSAGE SENT EXACTLY SAME */
  const mails = recipients.map(r => ({
    from: `"${(senderName || "").trim() || gmail}" <${gmail}>`,
    to: r,
    subject: subject,
    text: message,
    replyTo: gmail
  }));

  const sent = await sendOneByOne(transporter, mails, gmail);

  return res.json({
    success: true,
    sent,
    used: sentToday[gmail],
    limit: MAX_PER_ID
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Best Safe Mail Server running on port", PORT);
});
