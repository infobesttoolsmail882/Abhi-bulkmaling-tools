// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// 🔑 Hardcoded login
const HARD_USERNAME = "!@#$%^&*())(*&^%$#@!@#$%^&*";
const HARD_PASSWORD = "!@#$%^&*())(*&^%$#@!@#$%^&*";

// ================= GLOBAL STATE =================

// Per-sender hourly mail limit
let mailLimits = {};

// Global launcher lock
let launcherLocked = false;

// Session store
const sessionStore = new session.MemoryStore();

// ================= MIDDLEWARE =================
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session (1 hour life)
app.use(session({
  secret: 'bulk-mailer-secret',
  resave: false,
  saveUninitialized: true,
  store: sessionStore,
  cookie: {
    maxAge: 60 * 60 * 1000 // 1 hour
  }
}));

// ================= FULL RESET =================

function fullServerReset() {
  console.log("🔁 FULL LAUNCHER RESET");

  launcherLocked = true;
  mailLimits = {};

  sessionStore.clear(() => {
    console.log("🧹 All sessions cleared");
  });

  setTimeout(() => {
    launcherLocked = false;
    console.log("✅ Launcher unlocked for fresh login");
  }, 2000);
}

// ================= AUTH =================

function requireAuth(req, res, next) {
  if (launcherLocked) return res.redirect('/');
  if (req.session.user) return next();
  return res.redirect('/');
}

// ================= ROUTES =================

// Login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (launcherLocked) {
    return res.json({
      success: false,
      message: "⛔ Launcher reset ho raha hai, thodi der baad login karo"
    });
  }

  if (username === HARD_USERNAME && password === HARD_PASSWORD) {
    req.session.user = username;

    // ⏱️ Full reset after 1 hour
    setTimeout(fullServerReset, 60 * 60 * 1000);

    return res.json({ success: true });
  }

  return res.json({ success: false, message: "❌ Invalid credentials" });
});

// Launcher page
app.get('/launcher', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

// ================= LOGOUT =================
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    return res.json({
      success: true,
      message: "✅ Logged out successfully"
    });
  });
});

// ================= HELPERS =================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendBatch(transporter, mails, batchSize = 5) {
  for (let i = 0; i < mails.length; i += batchSize) {
    await Promise.allSettled(
      mails.slice(i, i + batchSize).map(m => transporter.sendMail(m))
    );
    await delay(300);
  }
}

// ================= SEND MAIL =================

app.post('/send', requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } = req.body;

    if (!email || !password || !recipients) {
      return res.json({
        success: false,
        message: "Email, password and recipients required"
      });
    }

    const now = Date.now();

    // ⏱️ Hourly sender reset
    if (!mailLimits[email] || now - mailLimits[email].startTime > 60 * 60 * 1000) {
      mailLimits[email] = { count: 0, startTime: now };
    }

    const recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(Boolean);

    if (mailLimits[email].count + recipientList.length > 27) {
      return res.json({
        success: false,
        message: `❌ Max 27 mails/hour | Remaining: ${27 - mailLimits[email].count}`
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    const mails = recipientList.map(r => ({
      from: `"${senderName || 'Anonymous'}" <${email}>`,
      to: r,

      // ✅ Re removed + inbox friendly subject
      subject: subject || "Quick Note",

      text: (message || "")
    }));

    await sendBatch(transporter, mails, 5);

    mailLimits[email].count += recipientList.length;

    return res.json({
      success: true,
      message: `✅ Sent ${recipientList.length} | Used ${mailLimits[email].count}/27`
    });

  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
});

// ================= START =================
app.listen(PORT, () => {
  console.log(`🚀 Mail Launcher running on port ${PORT}`);
});
