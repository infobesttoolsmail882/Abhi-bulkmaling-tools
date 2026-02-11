import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ===== ROOT ===== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ===== FIXED SAFE LIMIT ===== */
const MAX_PER_ID = 28;      // 🔒 EXACT LIMIT
const PARALLEL = 1;         // ONE BY ONE (INBOX SAFE)
const DELAY_MS = 150;       // GENTLE SPEED

/* ===== STATE ===== */
let sentCount = {};         // gmail => count
let failCount = {};         // gmail => failures

/* Reset every 24 hours */
setInterval(() => {
  sentCount = {};
  failCount = {};
  console.log("Daily reset done");
}, 24 * 60 * 60 * 1000);

/* ===== HELPERS ===== */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const wait = () =>
  new Promise(r => setTimeout(r, DELAY_MS + Math.floor(Math.random() * 60)));

async function sendSafely(transporter, mails, gmail) {
  let sent = 0;

  for (const mail of mails) {
    try {
      await transporter.sendMail(mail);
      sent++;
      sentCount[gmail] = (sentCount[gmail] || 0) + 1;
      failCount[gmail] = 0;
    } catch (e) {
      failCount[gmail] = (failCount[gmail] || 0) + 1;
      console.log("Send error:", e.message);
      if (failCount[gmail] >= 3) break; // protect account
    }
    await wait();
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

  if (!sentCount[gmail]) sentCount[gmail] = 0;

  if (sentCount[gmail] >= MAX_PER_ID)
    return res.json({
      success: false,
      msg: "28 emails limit reached for this Gmail ID"
    });

  let recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  recipients = [...new Set(recipients)];

  const remaining = MAX_PER_ID - sentCount[gmail];
  if (recipients.length > remaining)
    return res.json({
      success: false,
      msg: `Only ${remaining} emails allowed for this Gmail ID`
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

  /* IMPORTANT: SUBJECT & MESSAGE UNCHANGED */
  const mails = recipients.map(r => ({
    from: `"${(senderName || "").trim() || gmail}" <${gmail}>`,
    to: r,
    subject: subject,   // unchanged
    text: message,     // unchanged (plain text)
    replyTo: gmail
  }));

  const sent = await sendSafely(transporter, mails, gmail);

  return res.json({
    success: true,
    sent,
    totalUsed: sentCount[gmail],
    totalLimit: MAX_PER_ID
  });
});

/* ===== START SERVER ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Safe Mail Server running (1 ID = 28 emails)");
});
