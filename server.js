require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

const ADMIN_CREDENTIAL = "@##2588^$$^*O*^%%^";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

/* ===== LIMIT SETTINGS ===== */

const DAILY_LIMIT = 9500;              // 24 hour limit
const BATCH_SIZE = 5;                  // sending speed
const BATCH_DELAY = 300;               // 300ms delay
const MAX_BODY_SIZE = "15kb";
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_TIME = 15 * 60 * 1000;
const IP_RATE_LIMIT_PER_MIN = 120;

/* ================= STATE ================= */

const dailyMailLimits = new Map();     // per sender 24h limit
const loginAttempts = new Map();       // brute force protection
const ipRateLimit = new Map();         // basic abuse control

/* ================= MIDDLEWARE ================= */

app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(express.urlencoded({ extended: false, limit: MAX_BODY_SIZE }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 60 * 60 * 1000 // 1 hour auto logout
    }
  })
);

/* ===== Security Headers ===== */

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

/* ===== Basic IP Rate Limit ===== */

app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const record = ipRateLimit.get(ip);

  if (!record || now - record.startTime > 60000) {
    ipRateLimit.set(ip, { count: 1, startTime: now });
    return next();
  }

  if (record.count >= IP_RATE_LIMIT_PER_MIN) {
    return res.status(429).send("Too many requests");
  }

  record.count++;
  next();
});

/* ================= HELPERS ================= */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitize(text = "", max = 1000) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .trim()
    .slice(0, max);
}

/* ===== 24 Hour Rolling Limit ===== */

function checkDailyLimit(senderEmail, amount) {
  const now = Date.now();
  const record = dailyMailLimits.get(senderEmail);

  if (!record || now - record.startTime > 24 * 60 * 60 * 1000) {
    dailyMailLimits.set(senderEmail, {
      count: 0,
      startTime: now
    });
  }

  const updated = dailyMailLimits.get(senderEmail);

  if (updated.count + amount > DAILY_LIMIT) {
    return false;
  }

  updated.count += amount;
  return true;
}

/* ===== Batch Sending ===== */

async function sendBatch(transporter, mails) {
  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const chunk = mails.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      chunk.map(mail => transporter.sendMail(mail))
    );

    await delay(BATCH_DELAY);
  }
}

/* ================= AUTH ================= */

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN_CREDENTIAL) return next();
  return res.redirect("/");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

/* ===== LOGIN ===== */

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  const ip = req.ip;
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (record && record.blockUntil > now) {
    return res.json({ success: false, message: "Try again later" });
  }

  if (username === ADMIN_CREDENTIAL && password === ADMIN_CREDENTIAL) {
    loginAttempts.delete(ip);
    req.session.user = ADMIN_CREDENTIAL;
    return res.json({ success: true });
  }

  if (!record) {
    loginAttempts.set(ip, { count: 1 });
  } else {
    record.count++;
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
      record.blockUntil = now + LOGIN_BLOCK_TIME;
    }
  }

  return res.json({ success: false, message: "Invalid credentials" });
});

/* ===== DASHBOARD ===== */

app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

/* ===== LOGOUT ===== */

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

/* ================= SEND ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } = req.body || {};

    if (!email || !password || !recipients) {
      return res.json({ success: false, message: "Missing fields" });
    }

    if (!isValidEmail(email)) {
      return res.json({ success: false, message: "Invalid sender email" });
    }

    const recipientList = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(r => isValidEmail(r))
      )
    ];

    if (recipientList.length === 0) {
      return res.json({ success: false, message: "No valid recipients" });
    }

    /* ===== 24H LIMIT CHECK ===== */
    if (!checkDailyLimit(email, recipientList.length)) {
      return res.json({
        success: false,
        message: "24 hour limit (9500) exceeded"
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    await transporter.verify();

    const mails = recipientList.map(to => ({
      from: `"${sanitize(senderName, 50) || "Sender"}" <${email}>`,
      to,
      subject: sanitize(subject, 150) || "Quick Note",
      text: sanitize(message)
    }));

    await sendBatch(transporter, mails);

    return res.json({
      success: true,
      message: `Sent ${recipientList.length} emails`
    });

  } catch (err) {
    return res.json({
      success: false,
      message: "Email sending failed"
    });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`Secure Server running on port ${PORT}`);
});
