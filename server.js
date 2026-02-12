import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "80kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ================= SAFE CONFIG ================= */

const LIMIT_4H = 28;
const RESET_TIME = 4 * 60 * 60 * 1000;
const DELAY_MS = 140;         // natural human pace
const MAX_FAIL = 2;           // stop early to protect reputation

let sentCount = {};
let failCount = {};

/* Reset every 4 hours */
setInterval(() => {
  sentCount = {};
  failCount = {};
  console.log("4-hour window reset");
}, RESET_TIME);

/* ================= HELPERS ================= */

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function delay() {
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
      sentCount[gmail] = (sentCount[gmail] || 0) + 1;
      failCount[gmail] = 0;

    } catch (err) {
      failCount[gmail] = (failCount[gmail] || 0) + 1;

      // Early stop to protect account reputation
      if (failCount[gmail] >= MAX_FAIL) break;
    }

    await delay();
  }

  return sent;
}

/* ================= SEND ROUTE ================= */

app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message)
    return res.json({ success:false, msg:"Missing fields" });

  if (!emailRegex.test(gmail))
    return res.json({ success:false, msg:"Invalid Gmail" });

  sentCount[gmail] = sentCount[gmail] || 0;

  if (sentCount[gmail] >= LIMIT_4H)
    return res.json({
      success:false,
      msg:"28 email limit reached for this 4-hour window"
    });

  let recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  recipients = [...new Set(recipients)];

  const remaining = LIMIT_4H - sentCount[gmail];

  if (recipients.length > remaining)
    return res.json({
      success:false,
      msg:`Only ${remaining} emails allowed in this window`
    });

  const transporter = nodemailer.createTransport({
    service:"gmail",
    auth:{ user:gmail, pass:apppass }
  });

  try { await transporter.verify(); }
  catch {
    return res.json({ success:false, msg:"Authentication failed" });
  }

  const mails = recipients.map(r => ({
    from:`"${(senderName||"").trim()||gmail}" <${gmail}>`,
    to:r,
    subject:subject,     // unchanged
    text:message,        // plain text only
    replyTo:gmail
  }));

  const sent = await sendOneByOne(transporter, mails, gmail);

  res.json({
    success:true,
    sent,
    used:sentCount[gmail],
    limit:LIMIT_4H
  });
});

/* ================= START ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Inbox-safe mail server running on port", PORT);
});
