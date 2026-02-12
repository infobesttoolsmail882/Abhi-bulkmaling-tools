import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ===== SAFE LIMIT ===== */
const MAX_PER_ID = 28;
const DELAY_MS = 150;

let sentCount = {};
let failCount = {};

setInterval(() => {
  sentCount = {};
  failCount = {};
}, 24 * 60 * 60 * 1000);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function wait() {
  return new Promise(r =>
    setTimeout(r, DELAY_MS + Math.floor(Math.random() * 50))
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
      if (failCount[gmail] >= 3) break;
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

  sentCount[gmail] = sentCount[gmail] || 0;

  if (sentCount[gmail] >= MAX_PER_ID)
    return res.json({ success: false, msg: "28 email limit reached" });

  let recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  recipients = [...new Set(recipients)];

  const remaining = MAX_PER_ID - sentCount[gmail];

  if (recipients.length > remaining)
    return res.json({
      success: false,
      msg: `Only ${remaining} emails allowed`
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

  const mails = recipients.map(r => ({
    from: `"${senderName || gmail}" <${gmail}>`,
    to: r,
    subject: subject,
    text: message,
    replyTo: gmail
  }));

  const sent = await sendOneByOne(transporter, mails, gmail);

  res.json({
    success: true,
    sent,
    used: sentCount[gmail],
    limit: MAX_PER_ID
  });
});

/* ===== IMPORTANT FOR RENDER ===== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
