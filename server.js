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

/* SAME SPEED */
const HOURLY_LIMIT = 28;
const PARALLEL = 3;
const BASE_DELAY = 120;

let stats = {};
let failCount = {};

setInterval(() => {
  stats = {};
  failCount = {};
}, 60 * 60 * 1000);

/* Validation helpers */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = t => (t || "").replace(/\r\n/g, "\n").trim().slice(0, 4000);

/* Small natural delay (same speed range) */
function wait() {
  const jitter = Math.floor(Math.random() * 40) - 20;
  return new Promise(r => setTimeout(r, BASE_DELAY + jitter));
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
        failCount[gmail] = 0;
      } else {
        failCount[gmail] = (failCount[gmail] || 0) + 1;
        console.log("Send fail:", r.reason?.message);
      }
    });

    await wait();

    /* Stop if many consecutive failures (protect reputation) */
    if ((failCount[gmail] || 0) >= 5) break;
  }

  return sent;
}

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

  if (recipients.length === 0)
    return res.json({ success: false, msg: "No valid recipients" });

  if (!stats[gmail]) stats[gmail] = { count: 0 };

  if (stats[gmail].count >= HOURLY_LIMIT)
    return res.json({ success: false, msg: "Hourly limit reached" });

  const remaining = HOURLY_LIMIT - stats[gmail].count;
  if (recipients.length > remaining)
    return res.json({ success: false, msg: "Limit full" });

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
    from: `"${(senderName || "").trim() || gmail}" <${gmail}>`,
    to: r,
    subject: clean(subject).slice(0,150),
    text: clean(message),
    replyTo: gmail
  }));

  const sent = await sendSafely(transporter, mails, gmail);
  stats[gmail].count += sent;

  res.json({ success: true, sent });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Real Safe Mail Server running");
});
