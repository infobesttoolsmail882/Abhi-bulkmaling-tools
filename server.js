/*************************************************
 SAFE & SIMPLE MAIL SERVER
 Batch: 6
 Delay: 320ms
 No extra dependencies
*************************************************/

const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

/* =====================================
   🔐 EDIT THESE TWO VALUES
===================================== */

const EMAIL_USER = "yourgmail@gmail.com";
const EMAIL_PASS = "your_app_password_here";

/* =====================================
   BASIC SETUP
===================================== */

app.use(express.json({ limit: "10kb" }));

/* =====================================
   EMAIL VALIDATION
===================================== */

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* =====================================
   MAIL TRANSPORT
===================================== */

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

/* =====================================
   SEND ROUTE
===================================== */

app.post("/send", async (req, res) => {
  try {
    const { fromName, subject, message, recipients } = req.body;

    if (!fromName || !subject || !message) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: "Recipients must be array" });
    }

    const validRecipients = recipients.filter(isValidEmail);

    if (validRecipients.length === 0) {
      return res.status(400).json({ error: "No valid emails" });
    }

    const BATCH_SIZE = 6;
    const BATCH_DELAY = 320;

    let sent = 0;
    let failed = 0;

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

            sent++;
          } catch (err) {
            failed++;
          }
        })
      );

      await delay(BATCH_DELAY);
    }

    return res.json({
      success: true,
      sent,
      failed,
      message: `Send ${sent}`
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Server Error"
    });
  }
});

/* =====================================
   ROOT CHECK
===================================== */

app.get("/", (req, res) => {
  res.send("Server Running");
});

/* =====================================
   START SERVER
===================================== */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
