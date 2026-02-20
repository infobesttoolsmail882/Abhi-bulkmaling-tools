const express = require("express");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));


// Health route
app.get("/", (req, res) => {
  res.send("Server Running ✅");
});


// Send mail route
app.post("/send", async (req, res) => {
  try {
    const { senderName, gmail, apppass, subject, message, to } = req.body;

    if (!senderName || !gmail || !apppass || !subject || !message || !to) {
      return res.status(400).json({
        success: false,
        msg: "All fields required"
      });
    }

    // Clean email list
    const recipients = to
      .split(/[\n,]+/)
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        msg: "No valid emails found"
      });
    }

    // Safety limit (important for Gmail)
    if (recipients.length > 60) {
      return res.status(400).json({
        success: false,
        msg: "Maximum 60 emails per request"
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

    for (let email of recipients) {

      const uniqueTag = Math.floor(Math.random() * 9999);

      await transporter.sendMail({
        from: `"${senderName}" <${gmail}>`,
        to: email,
        subject: `${subject} - ${uniqueTag}`,

        text: message,

        html: `
          <div style="font-family:Arial;line-height:1.6">
            <p>${message}</p>
            <br/>
            <hr/>
            <small>Sent securely.</small>
          </div>
        `
      });

      sent++;

      // ⚡ Fast delay (800ms)
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    return res.json({
      success: true,
      sent
    });

  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({
      success: false,
      msg: "Server error"
    });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
