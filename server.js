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

let stats = {};
let failStreak = {};

setInterval(() => {
  stats = {};
  failStreak = {};
}, 60 * 60 * 1000);

/* ===== AUTO SAFE REWRITE (NO HIDING) ===== */
const SAFE_REWRITE = [
  [/hello\b/gi, "Hi"],
  [/error|glitch|issue\b/gi, "something that may need attention"],
  [/stops? it from showing|not showing\b/gi, "may be affecting how it appears"],
  [/search platforms?|google\b/gi, "online"],
  [/screen ?shot\b/gi, "details"],
  [/can i.*email\?/gi, "Would you like me to share the details by email?"]
];

function rewriteToSafeEnglish(text = "") {
  let t = text.replace(/\r\n/g, "\n").trim();
  SAFE_REWRITE.forEach(([pattern, replace]) => {
    t = t.replace(pattern, replace);
  });
  return t.replace(/\n{3,}/g, "\n\n").slice(0, 5000);
}

function cleanSubject(s = "") {
  return s.replace(/\s+/g, " ").trim().slice(0, 150);
}

function delay(base) {
  const jitter = Math.floor(Math.random() * 41) - 20;
  return new Promise(r => setTimeout(r, base + jitter));
}

async function sendSafely(transporter, mails, gmail) {
  let sent = 0;
  for (let i = 0; i < mails.length; i += PARALLEL) {
    const batch = mails.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      batch.map(m => transporter.sendMail(m))
    );
    results.forEach(r => {
      if (r.status === "fulfilled") {
        sent++;
        failStreak[gmail] = 0;
      } else {
        failStreak[gmail] = (failStreak[gmail] || 0) + 1;
      }
    });
    await delay(BASE_DELAY_MS);
    if ((failStreak[gmail] || 0) >= 5) break;
  }
  return sent;
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message)
    return res.json({ success: false, msg: "Missing fields" });

  if (!emailRegex.test(gmail))
    return res.json({ success: false, msg: "Invalid Gmail" });

  let recipients = to.split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));
  recipients = [...new Set(recipients)];

  if (!stats[gmail]) stats[gmail] = { count: 0 };
  if (stats[gmail].count >= HOURLY_LIMIT)
    return res.json({ success: false, msg: "Hourly limit reached" });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmail, pass: apppass }
  });

  try { await transporter.verify(); }
  catch { return res.json({ success: false, msg: "Gmail login failed" }); }

  const finalText = rewriteToSafeEnglish(message);

  const mails = recipients.map(r => ({
    from: `"${(senderName || "").trim() || gmail}" <${gmail}>`,
    to: r,
    subject: cleanSubject(subject),
    text: finalText,
    replyTo: gmail
  }));

  const sent = await sendSafely(transporter, mails, gmail);
  stats[gmail].count += sent;

  res.json({ success: true, sent });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Safe Mail Server running (auto rewrite enabled)");
});
