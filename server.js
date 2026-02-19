// ======================================
// Secure Mail Server - Production Safe
// ======================================

const express = require("express");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ===============================
// SEND ROUTE
// ===============================
app.post("/send", async (req, res) => {
  try {
    const { senderName, gmail, apppass, subject, message, to } = req.body;

    if (!senderName || !gmail || !apppass || !subject || !message || !to) {
      return res.json({ success: false, msg: "Missing fields" });
    }

    const recipients = Array.isArray(to) ? to : [to];

    // Create transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmail,
        pass: apppass
      }
    });

    let sentCount = 0;

    for (let email of recipients) {
      try {
        await transporter.sendMail({
          from: `"${senderName}" <${gmail}>`,
          to: email,
          subject: subject,
          text: message
        });

        sentCount++;
      } catch (err) {
        console.log("Failed:", email);
      }
    }

    return res.json({
      success: true,
      sent: sentCount
    });

  } catch (err) {
    console.error("SERVER ERROR:", err);
    return res.json({
      success: false,
      msg: "Internal server error"
    });
  }
});

// ===============================
// Start Server
// ===============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
