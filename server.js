import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

/* ================= SERVER CONFIG ================= */

const PANEL_USER = "admin";
const PANEL_PASS = "strongpassword123";
const PANEL_TOKEN = "secure_token_2026_internal";

/* ================= INIT ================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(helmet());
app.use(express.json({ limit: "50kb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60
});
app.use(limiter);

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ================= SAME SPEED SETTINGS ================= */

const HOURLY_LIMIT = 28;
const PARALLEL = 3;
const DELAY_MS = 120;

let stats = {};
setInterval(() => { stats = {}; }, 60 * 60 * 1000);

/* ================= HELPERS ================= */

const cleanText = t =>
  (t || "").replace(/\r\n/g, "\n").trim().slice(0, 4000);

const cleanSubject = s =>
  (s || "").replace(/\s+/g, " ").trim().slice(0, 120);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ================= SAFE PARALLEL SEND ================= */

async function sendSafely(transporter, mails) {
  let sent = 0;

  for (let i = 0; i < mails.length; i += PARALLEL) {
    const batch = mails.slice(i, i + PARALLEL);

    const results = await Promise.allSettled(
      batch.map(m => transporter.sendMail(m))
    );

    results.forEach(r => {
      if (r.status === "fulfilled") sent++;
    });

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  return sent;
}

/* ================= LOGIN ================= */

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === PANEL_USER && password === PANEL_PASS) {
    return res.json({ success: true, token: PANEL_TOKEN });
  }

  return res.json({ success: false });
});

/* ================= SEND ================= */

app.post("/send", async (req, res) => {

  if (req.headers["x-auth-token"] !== PANEL_TOKEN)
    return res.json({ success: false, msg: "Unauthorized ❌" });

  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to || !subject || !message)
    return res.json({ success: false, msg: "Missing fields ❌" });

  if (!emailRegex.test(gmail))
    return res.json({ success: false, msg: "Invalid Gmail ❌" });

  if (!stats[gmail]) stats[gmail] = { count: 0 };

  if (stats[gmail].count >= HOURLY_LIMIT)
    return res.json({ success: false, msg: "Hourly limit reached ❌" });

  const recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => emailRegex.test(r));

  if (recipients.length === 0)
    return res.json({ success: false, msg: "No valid recipients ❌" });

  const remaining = HOURLY_LIMIT - stats[gmail].count;

  if (recipients.length > remaining)
    return res.json({ success: false, msg: "Limit full ❌" });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmail, pass: apppass }
  });

  try {
    await transporter.verify();
  } catch {
    return res.json({ success: false, msg: "Gmail login failed ❌" });
  }

  const mails = recipients.map(r => ({
    from: `"${senderName || gmail}" <${gmail}>`,
    to: r,
    subject: cleanSubject(subject),
    text: cleanText(message),
    replyTo: gmail
  }));

  const sent = await sendSafely(transporter, mails);
  stats[gmail].count += sent;

  res.json({ success: true, sent });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Secure Mail Server Running");
});
