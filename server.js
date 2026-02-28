require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "20kb" }));

/* ==============================
   CONFIG
============================== */

const MAX_PER_HOUR = 27;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300; // same speed
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

/* ==============================
   STATE (Per Sender Limit)
============================== */

const senderLimits = new Map();

/* ==============================
   HELPERS
============================== */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checkAndUpdateLimit(sender, amount) {
  const now = Date.now();
  const record = senderLimits.get(sender);

  if (!record || now - record.startTime > 3600000) {
    senderLimits.set(sender, { count: 0, startTime: now });
  }

  const updated = senderLimits.get(sender);

  if (updated.count + amount > MAX_PER_HOUR) {
    return false;
  }

  updated.count += amount;
  return true;
}

async function sendBatch(transporter, mails) {
  let successCount = 0;

  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const chunk = mails.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      chunk.map(mail => transporter.sendMail(mail))
    );

    results.forEach(r => {
      if (r.status === "fulfilled") successCount++;
    });

    await delay(BATCH_DELAY);
  }

  return successCount;
}

/* ==============================
   SEND ROUTE
============================== */

app.post("/send", async (req, res) => {
  try {
    const { email, password, recipients, subject, message } = req.body || {};

    if (!email || !password || !recipients) {
      return res.json({ success: false, message: "Missing required fields" });
    }

    if (!isValidEmail(email)) {
      return res.json({ success: false, message: "Invalid sender email" });
    }

    const recipientList = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(r => isValidEmail(r))
      )
    ];

    if (recipientList.length === 0) {
      return res.json({ success: false, message: "No valid recipients" });
    }

    if (!checkAndUpdateLimit(email, recipientList.length)) {
      return res.json({
        success: false,
        message: `Limit ${MAX_PER_HOUR}/hour exceeded`
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      auth: {
        user: email,
        pass: password
      }
    });

    await transporter.verify();

    const mails = recipientList.map(to => ({
      from: `"${email}" <${email}>`,
      to,
      subject: subject || "Message",
      text: message || ""
    }));

    const sentCount = await sendBatch(transporter, mails);

    return res.json({
      success: true,
      message: `Send ${sentCount}`
    });

  } catch (err) {
    console.error("Mail Error:", err.message);
    return res.json({
      success: false,
      message: "Email sending failed"
    });
  }
});

/* ==============================
   START
============================== */

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
