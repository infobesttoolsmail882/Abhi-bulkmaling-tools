const express = require("express");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/", (req, res) => {
  res.status(200).send("Server Running ✅");
});

// Send mail route
app.post("/send", async (req, res) => {
  try {
    const { senderName, gmail, apppass, subject, message, to } = req.body;

    // Strict validation
    if (!senderName || !gmail || !apppass || !subject || !message || !to) {
      return res.status(400).json({
        success: false,
        msg: "All fields are required"
      });
    }

    // Clean and validate recipients
    const recipients = to
      .split(/[\n,]+/)
      .map(e => e.trim())
      .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        msg: "No valid email addresses found"
      });
    }

    // Safety limit (protect account reputation)
    if (recipients.length > 25) {
      return res.status(400).json({
        success: false,
        msg: "Maximum 25 emails per request for account safety"
      });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmail,
        pass: apppass
      },
      pool: true,
      maxConnections: 2,
      maxMessages: 100
    });

    await transporter.verify();

    let sent = 0;

    for (const email of recipients) {

      await transporter.sendMail({
        from: `"${senderName}" <${gmail}>`,
        to: email,
        subject: subject,        // EXACT subject
        replyTo: gmail,
        text: message,           // EXACT text
        html: `
          <div style="font-family: Arial, sans-serif; font-size:14px; color:#222; line-height:1.6;">
            ${message.replace(/\n/g, "<br>")}
          </div>
        `,
        headers: {
          "X-Mailer": "NodeMailer",
          "Precedence": "bulk"
        }
      });

      sent++;

      // 3 second SAFE delay
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    return res.json({
      success: true,
      sent
    });

  } catch (error) {
    console.error("Send Error:", error);
    return res.status(500).json({
      success: false,
      msg: "Server error"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
