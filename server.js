import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* SPEED & LIMIT SETTINGS (Aapke logic ke mutabiq) */
const HOURLY_LIMIT = 28;
const PARALLEL = 3;
const DELAY_MS = 120; // Fast execution delay

let stats = {};
// Har 1 ghante mein limit reset karne ke liye
setInterval(() => { stats = {}; }, 60 * 60 * 1000);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Route for Launcher
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* Controlled Parallel Engine for Inbox Delivery */
async function sendSafely(transporter, mails) {
  let sentCount = 0;

  for (let i = 0; i < mails.length; i += PARALLEL) {
    const batch = mails.slice(i, i + PARALLEL);

    // Parallel processing with batching
    const results = await Promise.allSettled(
      batch.map(m => transporter.sendMail(m))
    );

    results.forEach(r => {
      if (r.status === "fulfilled") sentCount++;
      else console.log("SMTP Rejection:", r.reason?.message);
    });

    // Fast delay to maintain server speed
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }
  return sentCount;
}

app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message)
    return res.json({ success: false, msg: "Missing fields ❌" });

  if (!stats[gmail]) stats[gmail] = { count: 0 };
  
  // Check Limit
  if (stats[gmail].count >= HOURLY_LIMIT)
    return res.json({ success: false, msg: `Hourly limit (${HOURLY_LIMIT}) reached ❌` });

  const recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  const remaining = HOURLY_LIMIT - stats[gmail].count;

  if (recipients.length === 0)
    return res.json({ success: false, msg: "No valid recipients ❌" });

  if (recipients.length > remaining)
    return res.json({ success: false, msg: `Only ${remaining} slots left for this hour ❌` });

  // Transporter setup
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmail, pass: apppass }
  });

  /* INBOX SECURITY INJECTION: No word change, just technical uniqueness */
  const mails = recipients.map(r => ({
    from: `"${senderName || gmail}" <${gmail}>`,
    to: r,
    subject: subject,
    text: message,
    // Invisible headers that Gmail trusts
    headers: {
      'X-Mailer': 'Microsoft Outlook 16.0',
      'X-Priority': '3 (Normal)',
      'Message-ID': `<${crypto.randomUUID()}@gmail.com>`,
      'X-Entity-Ref-ID': crypto.randomBytes(12).toString('hex')
    }
  }));

  try {
    const sent = await sendSafely(transporter, mails);
    stats[gmail].count += sent;
    res.json({ success: true, sent });
  } catch (err) {
    console.error("Critical Failure:", err.message);
    res.json({ success: false, msg: "Connection failed ❌" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Safe Mail Server is running on port ${PORT}`);
});
