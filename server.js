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

/* ===== ULTRA SAFE LIMITS ===== */
const HOURLY_LIMIT = 10;   // VERY SAFE
const DAILY_LIMIT  = 30;   // VERY SAFE
const PARALLEL = 1;        // ONE BY ONE (BEST FOR INBOX)
const DELAY_MS = 150;      // GENTLE SPEED

let hourly = {};
let daily = {};
let fail = {};

/* Reset */
setInterval(() => { hourly = {}; fail = {}; }, 60 * 60 * 1000);
setInterval(() => { daily = {}; }, 24 * 60 * 60 * 1000);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const wait = () =>
  new Promise(r => setTimeout(r, DELAY_MS + Math.floor(Math.random()*50)));

async function sendSafely(transporter, mails, gmail) {
  let sent = 0;

  for (const mail of mails) {
    try {
      await transporter.sendMail(mail);
      sent++;
      fail[gmail] = 0;
    } catch (e) {
      fail[gmail] = (fail[gmail] || 0) + 1;
      console.log("Send error:", e.message);
      if (fail[gmail] >= 3) break;
    }
    await wait();
  }
  return sent;
}

app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message)
    return res.json({ success:false, msg:"Missing fields" });

  if (!emailRegex.test(gmail))
    return res.json({ success:false, msg:"Invalid Gmail" });

  let recipients = to.split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  recipients = [...new Set(recipients)];
  if (!recipients.length)
    return res.json({ success:false, msg:"No valid recipients" });

  hourly[gmail] ??= 0;
  daily[gmail]  ??= 0;

  if (hourly[gmail] >= HOURLY_LIMIT)
    return res.json({ success:false, msg:"Hourly limit reached" });

  if (daily[gmail] >= DAILY_LIMIT)
    return res.json({ success:false, msg:"Daily limit reached" });

  const allowed = Math.min(
    HOURLY_LIMIT - hourly[gmail],
    DAILY_LIMIT  - daily[gmail]
  );

  if (recipients.length > allowed)
    return res.json({ success:false, msg:`Allowed now: ${allowed}` });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmail, pass: apppass }
  });

  try { await transporter.verify(); }
  catch {
    return res.json({ success:false, msg:"Gmail login failed" });
  }

  const mails = recipients.map(r => ({
    from: `"${(senderName||"").trim() || gmail}" <${gmail}>`,
    to: r,
    subject: subject,   // EXACT SAME
    text: message,     // EXACT SAME (plain text)
    replyTo: gmail
  }));

  const sent = await sendSafely(transporter, mails, gmail);
  hourly[gmail] += sent;
  daily[gmail]  += sent;

  res.json({ success:true, sent });
});

app.listen(3000, () => {
  console.log("Ultra-safe inbox mail server running");
});
