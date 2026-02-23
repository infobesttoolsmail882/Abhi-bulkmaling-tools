// ================= IMPORTS =================
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// ================= SECURE CONFIG =================

// Fixed login credentials (as requested)
const ADMIN_CREDENTIAL = "@##2588^$$^*O*^%%^";

const SESSION_SECRET =
  process.env.SESSION_SECRET || "super-secure-session-secret-change-this";

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

// Secure session setup
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      maxAge: 60 * 60 * 1000, // 1 hour
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

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
    console.log("✅ Launcher unlocked");
  }, 2000);
}

// ================= AUTH MIDDLEWARE =================

function requireAuth(req, res, next) {
  if (launcherLocked) return res.redirect('/');
  if (req.session.user === ADMIN_CREDENTIAL) return next();
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
      message: "⛔ Server resetting, try again shortly"
    });
  }

  if (
    username === ADMIN_CREDENTIAL &&
    password === ADMIN_CREDENTIAL
  ) {
    req.session.user = ADMIN_CREDENTIAL;

    // Auto reset after 1 hour
    setTimeout(fullServerReset, 60 * 60 * 1000);

    return res.json({ success: true });
  }

  return res.json({
    success: false,
    message: "❌ Invalid credentials"
  });
});

// Launcher page
app.get('/launcher', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({
      success: true,
      message: "✅ Logged out successfully"
    });
  });
});

// ================= HELPERS =================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// SAME SPEED AS BEFORE
async function sendBatch(transporter, mails, batchSize = 5) {
  for (let i = 0; i < mails.length; i += batchSize) {
    await Promise.allSettled(
      mails.slice(i, i + batchSize).map(mail => transporter.sendMail(mail))
    );
    await delay(300); // SAME DELAY
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

    // Reset hourly limit
    if (!mailLimits[email] || now - mailLimits[email].startTime > 60 * 60 * 1000) {
      mailLimits[email] = { count: 0, startTime: now };
    }

    const recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(Boolean);

    if (recipientList.length === 0) {
      return res.json({
        success: false,
        message: "No valid recipients"
      });
    }

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

    await transporter.verify();

    const mails = recipientList.map(r => ({
      from: `"${senderName || "Anonymous"}" <${email}>`,
      to: r,
      subject: subject || "Quick Note",
      text: message || ""
    }));

    await sendBatch(transporter, mails, 5);

    mailLimits[email].count += recipientList.length;

    return res.json({
      success: true,
      message: `✅ Sent ${recipientList.length} | Used ${mailLimits[email].count}/27`
    });

  } catch (err) {
    return res.json({
      success: false,
      message: "❌ " + err.message
    });
  }
});

// ================= START =================

app.listen(PORT, () => {
  console.log(`🚀 Mail Launcher running on port ${PORT}`);
});
