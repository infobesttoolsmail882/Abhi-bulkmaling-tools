import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable("x-powered-by");

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* =========================
   SPEED SETTINGS (SAFE)
========================= */

const HOURLY_LIMIT = 28;
const PARALLEL = 3;
const DELAY_MS = 120;

let stats = {};
setInterval(() => {
  stats = {};
}, 60 * 60 * 1000);

/* =========================
   VALIDATION
========================= */

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cleanText = text =>
  (text || "").replace(/\r\n/g, "\n").trim().slice(0, 5000);

const cleanSubject = sub =>
  (sub || "").replace(/\s+/g, " ").trim().slice(0, 150);

/* =========================
   SAFE PARALLEL SENDER
========================= */

async function sendBatch(transporter, mails) {
  let sent = 0;

  for (let i = 0; i < mails.length; i += PARALLEL) {
    const batch = mails.slice(i, i + PARALLEL);

    const results = await Promise.allSettled(
      batch.map(mail => transporter.sendMail(mail))
    );

    results.forEach(r => {
      if (r.status === "fulfilled") sent++;
      else console.log("Mail failed:", r.reason?.message);
    });

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  return sent;
}

/* =========================
   SEND ROUTE
========================= */

app.post("/send", async (req, res) => {
  try {
    const { senderName, gmail, apppass, to, subject, message } = req.body;

    if (!gmail || !apppass || !to || !subject || !message)
      return res.json({ success: false, msg: "Missing fields" });

    if (!emailRegex.test(gmail))
      return res.json({ success: false, msg: "Invalid Gmail" });

    if (!stats[gmail]) stats[gmail] = { count: 0 };

    if (stats[gmail].count >= HOURLY_LIMIT)
      return res.json({ success: false, msg: "Hourly limit reached" });

    const recipients = to
      .split(/,|\n/)
      .map(r => r.trim())
      .filter(r => emailRegex.test(r));

    if (recipients.length === 0)
      return res.json({ success: false, msg: "No valid recipients" });

    const remaining = HOURLY_LIMIT - stats[gmail].count;

    if (recipients.length > remaining)
      return res.json({ success: false, msg: "Limit exceeded" });

    /* =========================
       PROFESSIONAL TRANSPORTER
    ========================= */

    const transporter = nodemailer.createTransport({
      service: "gmail",
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      auth: {
        user: gmail,
        pass: apppass
      }
    });

    await transporter.verify();

    /* =========================
       CLEAN MAIL OBJECT
    ========================= */

    const mails = recipients.map(recipient => ({
      from: `"${senderName?.trim() || gmail}" <${gmail}>`,
      to: recipient,
      subject: cleanSubject(subject),
      text: cleanText(message),
      replyTo: gmail,
      headers: {
        "X-Mailer": "SecureMailConsole",
        "X-Priority": "3"
      }
    }));

    const sent = await sendBatch(transporter, mails);

    stats[gmail].count += sent;

    return res.json({ success: true, sent });

  } catch (err) {
    console.log("SERVER ERROR:", err.message);
    return res.json({ success: false, msg: "Server error" });
  }
});

/* =========================
   START SERVER
========================= */

app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Clean & Safe Mail Server Running");
});
