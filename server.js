const express = require("express");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Health route
app.get("/", (req, res) => {
  res.status(200).send("Server Running ✅");
});

// Email route
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

    // Clean recipients
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

    // Responsible per-request limit
    if (recipients.length > 30) {
      return res.status(400).json({
        success: false,
        msg: "Maximum 30 emails per request for account safety"
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
      maxMessages: 50
    });

    await transporter.verify();

    let sent = 0;

    for (const email of recipients) {

      await transporter.sendMail({
        from: `"${senderName}" <${gmail}>`,
        to: email,
        subject: subject,        // EXACT subject (no change)
        replyTo: gmail,
        text: message,           // EXACT message (no modification)
        html: `
          <div style="font-family: Arial, sans-serif; font-size:14px; color:#222; line-height:1.6;">
            ${message.replace(/\n/g, "<br>")}
          </div>
        `,
        headers: {
          "X-Mailer": "NodeMailer",
          "X-Priority": "3"
        }
      });

      sent++;

      // Responsible sending delay
      await new Promise(resolve => setTimeout(resolve, 1200));
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
