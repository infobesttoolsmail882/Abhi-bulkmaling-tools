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

/* ===== CONFIG ===== */
const LIMIT_PER_4HOURS = 28;       // 🔒 28 emails
const RESET_TIME = 4 * 60 * 60 * 1000; // 4 hours
const DELAY_MS = 120;              // fast but safe
const MAX_FAIL = 3;

/* ===== STATE ===== */
let sentCount = {};
let failCount = {};

/* ===== AUTO RESET EVERY 4 HOURS ===== */
setInterval(() => {
  sentCount = {};
  failCount = {};
  console.log("4 Hour limit reset done");
}, RESET_TIME);

/* ===== HELPERS ===== */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function wait() {
  return new Promise(resolve =>
    setTimeout(resolve, DELAY_MS + Math.floor(Math.random() * 40))
  );
}

async function sendEmails(transporter, mails, gmail) {
  let sent = 0;

  for (const mail of mails) {
    try {
      await transporter.sendMail(mail);

      sent++;
      sentCount[gmail] = (sentCount[gmail] || 0) + 1;
      failCount[gmail] = 0;

    } catch (err) {
      failCount[gmail] = (failCount[gmail] || 0) + 1;
      console.log("Send error:", err.message);

      if (failCount[gmail] >= MAX_FAIL) break;
    }

    await wait();
  }

  return sent;
}

/* ===== SEND ROUTE ===== */
app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message)
    return res.json({ success: false, msg: "Missing fields" });

  if (!emailRegex.test(gmail))
    return res.json({ success: false, msg: "Invalid Gmail address" });

  sentCount[gmail] = sentCount[gmail] || 0;

  if (sentCount[gmail] >= LIMIT_PER_4HOURS)
    return res.json({
      success: false,
      msg: "28 email limit reached (4 hours limit)"
    });

  let recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  recipients = [...new Set(recipients)];

  const remaining = LIMIT_PER_4HOURS - sentCount[gmail];

  if (recipients.length > remaining)
    return res.json({
      success: false,
      msg: `Only ${remaining} emails allowed in this 4-hour window`
    });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmail, pass: apppass }
  });

  try {
    await transporter.verify();
  } catch {
    return res.json({ success: false, msg: "Gmail authentication failed" });
  }

  const mails = recipients.map(r => ({
    from: `"${(senderName || "").trim() || gmail}" <${gmail}>`,
    to: r,
    subject: subject,   // unchanged
    text: message,      // unchanged
    replyTo: gmail
  }));

  const sent = await sendEmails(transporter, mails, gmail);

  res.json({
    success: true,
    sent,
    used: sentCount[gmail],
    limit: LIMIT_PER_4HOURS
  });
});

/* ===== START SERVER ===== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Mail server running (28 emails per 4 hours)");
});
