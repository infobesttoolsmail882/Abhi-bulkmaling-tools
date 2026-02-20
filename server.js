const express = require("express");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/", (req, res) => {
  res.send("Server Running ✅");
});

// Email sending route
app.post("/send", async (req, res) => {
  try {
    const { senderName, gmail, apppass, subject, message, to } = req.body;

    // Basic validation
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
      .filter(e => e.length > 0);

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        msg: "No valid email addresses found"
      });
    }

    // Gmail safe limit
    if (recipients.length > 40) {
      return res.status(400).json({
        success: false,
        msg: "Maximum 40 emails per request"
      });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmail,
        pass: apppass
      }
    });

    let sent = 0;

    for (const email of recipients) {

      await transporter.sendMail({
        from: `"${senderName}" <${gmail}>`,
        to: email,
        subject: subject,
        replyTo: gmail,
        text: message,
        html: `
          <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #333;">
            <p>Dear Recipient,</p>

            <p>${message.replace(/\n/g, "<br/>")}</p>

            <br/>

            <p>Kind regards,</p>
            <p><strong>${senderName}</strong></p>

            <hr style="margin-top:30px;"/>

            <p style="font-size:12px;color:#777;">
              This email was sent in response to a business communication.
              If you received it in error, please disregard this message.
            </p>
          </div>
        `
      });

      sent++;

      // Responsible sending delay (recommended minimum)
      await new Promise(resolve => setTimeout(resolve, 1200));
    }

    return res.json({
      success: true,
      sent
    });

  } catch (error) {
    console.error("Send error:", error);

    return res.status(500).json({
      success: false,
      msg: "Server error"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
