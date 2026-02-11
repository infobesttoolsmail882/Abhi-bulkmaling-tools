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

/* ===== SAME SPEED ===== */
const HOURLY_LIMIT = 28;
const PARALLEL = 3;
const BASE_DELAY_MS = 120;

/* ===== STATE ===== */
let stats = {};
let failStreak = {};

setInterval(() => {
  stats = {};
  failStreak = {};
}, 60 * 60 * 1000);

/* ===== VALIDATION ===== */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ===== SAFE AUTO-REWRITE (NO HIDING) =====
   Converts pushy/scary wording to neutral business English */
const SAFE_REWRITE = [
  [/hello\b/gi, "Hi"],
  [/error|glitch|bug\b/gi, "something that may need attention"],
  [/stops? it from showing|not showing\b/gi, "may affect how it appears"],
  [/search platforms?|google\b/gi, "online"],
  [/screen ?shot|image\b/gi, "details"],
  [/can i.*email\?/gi, "Would you like me to share the details by email?"],
];

function rewriteToNeutral(text = "") {
  let t = text.replace(/\r\n/g, "\n").trim();
  SAFE_REWRITE.forEach(([re, rep]) => { t = t.replace(re, rep); });
  // normalize spacing
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.slice(0, 5000);
}

/* ===== CLEAN SUBJECT/BODY ===== */
function cleanSubject(s = "") {
  return s.replace(/\s+/g, " ").replace(/([!?])\1+/g, "$1").trim().slice(0, 120);
}
function cleanText(t = "") {
  return t.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000);
}

/* ===== NATURAL DELAY (SAME SPEED RANGE) ===== */
function delayWithJitter(base) {
  const jitter = Math.floor(Math.random() * 41) - 20; // -20..+20ms
  return new Promise(r => setTimeout(r, base + jitter));
}

/* ===== CONTROLLED SENDER ===== */
async function sendSafely(transporter, mails, gmail) {
  let sent = 0;
  for (let i = 0; i < mails.length; i += PARALLEL) {
    const batch = mails.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(batch.map(m => transporter.sendMail(m)));

    results.forEach(r => {
      if (r.status === "fulfilled") {
        sent++;
        failStreak[gmail] = 0;
      } else {
        failStreak[gmail] = (failStreak[gmail] || 0) + 1;
      }
    });

    await delayWithJitter(BASE_DELAY_MS);
    // protect reputation
    if ((failStreak[gmail] || 0) >= 5) break;
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

  // recipients: valid + unique
  let recipients = to.split(/,|\n/).map(r => r.trim()).filter(r => emailRegex.test(r));
  recipients = [...new Set(recipients)];
  if (recipients.length === 0)
    return res.json({ success: false, msg: "No valid recipients" });

  // hourly cap
  if (!stats[gmail]) stats[gmail] = { count: 0 };
  if (stats[gmail].count >= HOURLY_LIMIT)
    return res.json({ success: false, msg: "Hourly limit reached" });
  const remaining = HOURLY_LIMIT - stats[gmail].count;
  if (recipients.length > remaining)
    return res.json({ success: false, msg: "Limit full" });

  // trusted Gmail SMTP
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmail, pass: apppass }
  });
  try { await transporter.verify(); }
  catch { return res.json({ success: false, msg: "Gmail login failed" }); }

  // ultra-safe text: rewrite + clean
  const finalText = cleanText(rewriteToNeutral(message));

  const mails = recipients.map(r => ({
    from: `"${(senderName || "").trim() || gmail}" <${gmail}>`,
    to: r,
    subject: cleanSubject(subject),
    text: finalText,
    replyTo: gmail
  }));

  const sent = await sendSafely(transporter, mails, gmail);
  stats[gmail].count += sent;

  return res.json({ success: true, sent });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Ultra-Safe Mail Server running");
});
