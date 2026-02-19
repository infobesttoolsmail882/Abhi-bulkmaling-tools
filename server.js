const express = require("express");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

/* ========== MIDDLEWARE ========== */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ========== STATIC FILES ========== */
app.use(express.static(path.join(__dirname, "public")));

/* ========== ROOT FIX ========== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ========== LOGIN API ========== */
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === "admin" && password === "1234") {
    return res.json({ success: true });
  }

  res.json({ success: false });
});

/* ========== SEND MAIL API ========== */
app.post("/send", async (req, res) => {
  try {
    const { senderName, gmail, apppass, subject, message, to } = req.body;

    if (!gmail || !apppass || !subject || !message || !to) {
      return res.json({ success: false, msg: "All fields required" });
    }

    const recipients = to
      .split(/[\n,]+/)
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (recipients.length === 0) {
      return res.json({ success: false, msg: "No valid recipients" });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmail,
        pass: apppass
      }
    });

    await transporter.sendMail({
      from: `"${senderName}" <${gmail}>`,
      to: recipients,
      subject: subject,
      text: message
    });

    res.json({ success: true, sent: recipients.length });

  } catch (err) {
    console.error("Mail Error:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

/* ========== START SERVER ========== */
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
