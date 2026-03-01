/*************************************************
 * SAFE & CLEAN MAIL SERVER (Single File)
 * Batch: 6
 * Delay: 320ms
 *************************************************/

const express = require("express");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = 3000;

/* =============================
   🔐 HARD CODE YOUR EMAIL HERE
   (Use Gmail App Password Only)
============================= */

const EMAIL_USER = "yourgmail@gmail.com";
const EMAIL_PASS = "your_app_password_here";

/* =============================
   BASIC SECURITY
============================= */

app.use(helmet());
app.use(express.json({ limit: "10kb" }));

/* =============================
   RATE LIMIT
============================= */

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

/* =============================
   MAIL TRANSPORT
============================= */

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

/* Verify SMTP once */
transporter.verify((err) => {
  if (err) {
    console.error("SMTP Error:", err.message);
  } else {
    console.log("SMTP Ready");
  }
});

/* =============================
   HELPERS
============================= */

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* =============================
   SEND ROUTE
============================= */

app.post("/send", async (req, res) => {
  try {
    const { fromName, subject, message, recipients } = req.body;

    if (!fromName || !subject || !message) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: "Recipients must be array" });
    }

    const validRecipients = recipients.filter(validateEmail);

    if (validRecipients.length === 0) {
      return res.status(400).json({ error: "No valid emails" });
    }

    let sentCount = 0;
    let failedCount = 0;

    const BATCH_SIZE = 6;
    const BATCH_DELAY = 320;

    for (let i = 0; i < validRecipients.length; i += BATCH_SIZE) {

      const batch = validRecipients.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (email) => {
          try {
            await transporter.sendMail({
              from: `"${fromName}" <${EMAIL_USER}>`,
              to: email,
              subject: subject,
              text: message
            });

            sentCount++;
          } catch (err) {
            failedCount++;
          }
        })
      );

      await delay(BATCH_DELAY);
    }

    return res.status(200).json({
      success: true,
      sent: sentCount,
      failed: failedCount,
      message: `Send ${sentCount}`
    });

  } catch (error) {
    console.error("Server Error:", error.message);
    return res.status(500).json({
      error: "Internal Server Error"
    });
  }
});

/* =============================
   ROOT CHECK
============================= */

app.get("/", (req, res) => {
  res.json({
    status: "Server Running",
    email: EMAIL_USER
  });
});

/* =============================
   START SERVER
============================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
