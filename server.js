require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const validator = require("validator");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

// ================= SECURITY =================

app.use(helmet());
app.use(bodyParser.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 1000
  }
}));

// ================= RATE LIMIT =================

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5
});

const sendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20 // fixed hourly limit
});

app.use(express.static(path.join(__dirname, "public")));

// ================= AUTH =================

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/");
  next();
}

// ================= ROUTES =================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (username !== process.env.ADMIN_USER)
    return res.json({ success: false });

  const match = await bcrypt.compare(password, process.env.ADMIN_PASS_HASH);

  if (!match)
    return res.json({ success: false });

  req.session.user = username;
  res.json({ success: true });
});

app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ================= SEND MAIL =================

app.post("/send", requireAuth, sendLimiter, async (req, res) => {
  try {
    const { senderName, email, appPassword, recipients, subject, message } = req.body;

    if (!validator.isEmail(email))
      return res.json({ success: false, message: "Invalid sender email" });

    const list = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => validator.isEmail(r));

    if (list.length === 0)
      return res.json({ success: false, message: "No valid recipients" });

    if (list.length > 20)
      return res.json({ success: false, message: "Max 20 per hour allowed" });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass: appPassword }
    });

    // Fast but safe batching (5 parallel)
    const batchSize = 5;

    for (let i = 0; i < list.length; i += batchSize) {
      const batch = list.slice(i, i + batchSize);

      await Promise.all(
        batch.map(r =>
          transporter.sendMail({
            from: `"${senderName || "Mailer"}" <${email}>`,
            to: r,
            subject: subject || "Notification",
            text: message || ""
          })
        )
      );

      await new Promise(resolve => setTimeout(resolve, 700));
    }

    res.json({
      success: true,
      message: `Successfully sent ${list.length} emails`
    });

  } catch (err) {
    res.json({ success: false, message: "Sending failed" });
  }
});

app.listen(PORT, () => {
  console.log("🚀 Safe Mailer Running");
});
