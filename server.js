require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const validator = require('validator');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// ================= SECURITY MIDDLEWARE =================

app.use(helmet());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 60 * 60 * 1000
  }
}));

// Login brute force protection
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many login attempts" }
});

app.use(express.static(path.join(__dirname, 'public')));

// ================= AUTH =================

async function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/');
}

// ================= LOGIN =================

app.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (username !== process.env.ADMIN_USER)
    return res.json({ success: false, message: "Invalid credentials" });

  const match = await bcrypt.compare(password, process.env.ADMIN_PASS_HASH);

  if (!match)
    return res.json({ success: false, message: "Invalid credentials" });

  req.session.user = username;
  return res.json({ success: true });
});

// ================= SEND RATE LIMIT =================

const sendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 25,
  message: { success: false, message: "Hourly send limit reached" }
});

// ================= HELPERS =================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendBatch(transporter, mails) {
  for (const mail of mails) {
    try {
      await transporter.sendMail(mail);
      await delay(800); // safe delay
    } catch (err) {
      console.error("Mail failed:", err.message);
    }
  }
}

// ================= SEND MAIL =================

app.post('/send', requireAuth, sendLimiter, async (req, res) => {
  try {
    const { senderName, email, appPassword, recipients, subject, message } = req.body;

    if (!validator.isEmail(email))
      return res.json({ success: false, message: "Invalid sender email" });

    const recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => validator.isEmail(r));

    if (recipientList.length === 0)
      return res.json({ success: false, message: "No valid recipients" });

    if (recipientList.length > 25)
      return res.json({ success: false, message: "Max 25 per hour allowed" });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass: appPassword }
    });

    const mails = recipientList.map(r => ({
      from: `"${senderName || 'Mailer'}" <${email}>`,
      to: r,
      subject: subject || "Notification",
      text: message || ""
    }));

    await sendBatch(transporter, mails);

    return res.json({
      success: true,
      message: `Sent ${recipientList.length} mails safely`
    });

  } catch (err) {
    return res.json({ success: false, message: "Error sending emails" });
  }
});

// ================= START =================

app.listen(PORT, () => {
  console.log(`🚀 Safe Mail Launcher running on port ${PORT}`);
});
