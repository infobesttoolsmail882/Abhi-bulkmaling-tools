require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());

// ==============================
// CONFIG
// ==============================
const MAX_PER_HOUR = 27;
const PARALLEL_LIMIT = 5;
const DELAY_BETWEEN_BATCHES = 300; // 300ms
const PORT = process.env.PORT || 3000;

// In-memory rate tracker (per email ID)
const rateStore = new Map();

// ==============================
// UTIL FUNCTIONS
// ==============================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(text = "") {
  return text
    .replace(/\b(hi|hello|rank|report|error|price|quote|google|showing|can)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getRateData(email) {
  const now = Date.now();
  if (!rateStore.has(email)) {
    rateStore.set(email, { count: 0, start: now });
  }

  const data = rateStore.get(email);

  if (now - data.start >= 60 * 60 * 1000) {
    data.count = 0;
    data.start = now;
  }

  return data;
}

// ==============================
// MAIL TRANSPORT
// ==============================

function createTransporter(user, pass) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
    pool: true,
    maxConnections: 5,
    maxMessages: 50,
  });
}

// ==============================
// SEND FUNCTION
// ==============================

async function sendSingleMail(transporter, from, to, subject, text) {
  await transporter.sendMail({
    from: `"${from}" <${from}>`,
    to,
    subject,
    text,
    headers: {
      "X-Mailer": "NodeMailer",
    },
  });
}

// ==============================
// ROUTE
// ==============================

app.post("/send", async (req, res) => {
  try {
    const { senderEmail, senderPass, subject, message, recipients } = req.body;

    if (!senderEmail || !senderPass || !recipients?.length) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const rateData = getRateData(senderEmail);

    if (rateData.count >= MAX_PER_HOUR) {
      return res.status(429).json({ error: "Hourly limit reached (27/hour)" });
    }

    const transporter = createTransporter(senderEmail, senderPass);

    let sentCount = 0;

    const cleanSubject = cleanText(subject);
    const cleanMessage = cleanText(message);

    // Split into batches of 5
    for (let i = 0; i < recipients.length; i += PARALLEL_LIMIT) {
      const batch = recipients.slice(i, i + PARALLEL_LIMIT);

      if (rateData.count >= MAX_PER_HOUR) break;

      const promises = batch.map(async (email) => {
        if (rateData.count >= MAX_PER_HOUR) return;

        try {
          await sendSingleMail(
            transporter,
            senderEmail,
            email,
            cleanSubject,
            cleanMessage
          );

          rateData.count++;
          sentCount++;
        } catch (err) {
          // silent fail to avoid pattern spikes
        }
      });

      await Promise.all(promises);
      await sleep(DELAY_BETWEEN_BATCHES);
    }

    return res.json({
      message: `Sent ${sentCount}`,
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal error" });
  }
});

// ==============================

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
