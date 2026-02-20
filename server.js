const express = require("express");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));


// ✅ Health check
app.get("/", (req, res) => {
  res.send("Server Running ✅");
});


// ✅ Mail Sender Route
app.post("/send", async (req, res) => {
  try {
    const { senderName, gmail, apppass, subject, message, to } = req.body;

    if (!senderName || !gmail || !apppass || !subject || !message || !to) {
      return res.status(400).json({
        success: false,
        msg: "All fields are required"
      });
    }

    // Clean recipients list
    const recipients = to
      .split(/[\n,]+/)
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        msg: "No valid recipient emails found"
      });
    }

    // ⚠ Gmail daily safe limit protection
    if (recipients.length > 40) {
      return res.status(400).json({
        success: false,
        msg: "Maximum 40 emails allowed per request for safety"
      });
    }

    // ✅ Create transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmail,
        pass: apppass
      }
    });

    let sentCount = 0;

    for (let email of recipients) {

      // Random small variation (spam reduce)
      const randomId = Math.floor(Math.random() * 10000);

      await transporter.sendMail({
        from: `"${senderName}" <${gmail}>`,
        to: email,
        subject: `${subject} | Ref-${randomId}`,

        text: message + "\n\n--\nSent securely",

        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6">
            <p>${message}</p>
            <br/>
            <hr/>
            <small>
              This email was sent securely.<br/>
              If this was sent in error, please ignore.
            </small>
          </div>
        `,

        headers: {
          "X-Mailer": "Secure Mail System",
          "Precedence": "bulk"
        }
      });

      sentCount++;

      // ✅ 7 second delay (VERY IMPORTANT)
      await new Promise(resolve => setTimeout(resolve, 7000));
    }

    return res.json({
      success: true,
      sent: sentCount
    });

  } catch (err) {
    console.error("Mail Error:", err);
    return res.status(500).json({
      success: false,
      msg: "Server error while sending mail"
    });
  }
});


// ✅ Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
