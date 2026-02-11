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

/* ===== ULTRA-CONSERVATIVE LIMITS ===== */
const HOURLY_LIMIT = 18;     // safer
const DAILY_LIMIT  = 55;     // safer
const PARALLEL = 3;          // SAME SPEED RANGE
const BASE_DELAY_MS = 120;   // SAME SPEED RANGE

let hourly = {};
let daily = {};
let failStreak = {};

/* Resets */
setInterval(() => { hourly = {}; failStreak = {}; }, 60 * 60 * 1000);
setInterval(() => { daily = {}; }, 24 * 60 * 60 * 1000);

/* Helpers */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const delay = () => new Promise(r =>
  setTimeout(r, BASE_DELAY_MS + (Math.floor(Math.random()*41)-20))
);

async function sendSafely(transporter, mails, gmail) {
  let sent = 0;
  for (let i = 0; i < mails.length; i += PARALLEL) {
    const batch = mails.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(batch.map(m => transporter.sendMail(m)));
    for (const r of results) {
      if (r.status === "fulfilled") {
        sent++; failStreak[gmail] = 0;
      } else {
        failStreak[gmail] = (failStreak[gmail] || 0) + 1;
      }
    }
    await delay();
    if ((failStreak[gmail] || 0) >= 4) break; // protect reputation
  }
  return sent;
}

app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message)
    return res.json({ success:false, msg:"Missing fields" });
  if (!emailRegex.test(gmail))
    return res.json({ success:false, msg:"Invalid Gmail" });

  let recipients = to.split(/,|\n/).map(r=>r.trim()).filter(r=>emailRegex.test(r));
  recipients = [...new Set(recipients)];
  if (!recipients.length)
    return res.json({ success:false, msg:"No valid recipients" });

  hourly[gmail] ??= 0; daily[gmail] ??= 0;
  if (hourly[gmail] >= HOURLY_LIMIT)
    return res.json({ success:false, msg:"Hourly limit reached" });
  if (daily[gmail] >= DAILY_LIMIT)
    return res.json({ success:false, msg:"Daily limit reached" });

  const allowed = Math.min(HOURLY_LIMIT-hourly[gmail], DAILY_LIMIT-daily[gmail]);
  if (recipients.length > allowed)
    return res.json({ success:false, msg:`Allowed now: ${allowed}` });

  const transporter = nodemailer.createTransport({
    service:"gmail",
    auth:{ user:gmail, pass:apppass }
  });
  try { await transporter.verify(); }
  catch { return res.json({ success:false, msg:"Gmail login failed" }); }

  const mails = recipients.map(r => ({
    from:`"${(senderName||"").trim()||gmail}" <${gmail}>`,
    to:r,
    subject:subject,   // unchanged
    text:message,     // unchanged (plain text)
    replyTo:gmail
  }));

  const sent = await sendSafely(transporter, mails, gmail);
  hourly[gmail] += sent; daily[gmail] += sent;

  res.json({ success:true, sent, hourly:hourly[gmail], daily:daily[gmail] });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Inbox-safe mail server running");
});
