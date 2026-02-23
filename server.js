require('dotenv').config();
const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

const ADMIN_CREDENTIAL = "@##2588^$$^*O*^%%^";
const MAX_PER_HOUR = 27;

/* ================= GLOBAL STATE ================= */

const mailLimits = new Map();
let launcherLocked = false;

/* ================= MIDDLEWARE ================= */

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || "secure-secret-change-this",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 1000
  }
}));

/* ================= SECURITY HEADERS ================= */

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

/* ================= AUTH ================= */

function requireAuth(req, res, next) {
  if (launcherLocked) return res.redirect('/');
  if (req.session.user === ADMIN_CREDENTIAL) return next();
  return res.redirect('/');
}

/* ================= LIMIT CHECK ================= */

function checkHourlyLimit(email, countToAdd) {
  const now = Date.now();
  const record = mailLimits.get(email);

  if (!record || now - record.startTime > 3600000) {
    mailLimits.set(email, { count: 0, startTime: now });
  }

  const updated = mailLimits.get(email);

  if (updated.count + countToAdd > MAX_PER_HOUR) {
    return false;
  }

  updated.count += countToAdd;
  return true;
}

/* ================= ROUTES ================= */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (launcherLocked) {
    return res.json({
      success: false,
      message: "Launcher temporarily locked"
    });
  }

  if (username === ADMIN_CREDENTIAL && password === ADMIN_CREDENTIAL) {
    req.session.user = ADMIN_CREDENTIAL;
    return res.json({ success: true });
  }

  return res.json({ success: false, message: "Invalid credentials" });
});

app.get('/launcher', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true, message: "Logged out" });
  });
});

/* ================= SEND MAIL ================= */

app.post('/send', requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } = req.body || {};

    if (!email || !password || !recipients) {
      return res.json({
        success: false,
        message: "Email, password and recipients required"
      });
    }

    const recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(Boolean);

    if (recipientList.length === 0) {
      return res.json({
        success: false,
        message: "No valid recipients found"
      });
    }

    if (!checkHourlyLimit(email, recipientList.length)) {
      return res.json({
        success: false,
        message: `Max ${MAX_PER_HOUR} emails per hour exceeded`
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    await transporter.verify();

    for (const to of recipientList) {
      await transporter.sendMail({
        from: `"${senderName || "Anonymous"}" <${email}>`,
        to,
        subject: subject || "Quick Note",
        text: message || ""
      });
    }

    return res.json({
      success: true,
      message: `Sent ${recipientList.length} email(s)`
    });

  } catch (err) {
    console.error("Send error:", err.message);
    return res.json({
      success: false,
      message: "Email sending failed"
    });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
