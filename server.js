require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

/* =======================================================
   CONFIG
======================================================= */

const app = express();
const PORT = process.env.PORT || 8080;

const ADMIN_CREDENTIAL = "@##2588^$$^*O*^%%^";

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.randomBytes(32).toString("hex");

const MAX_PER_HOUR = 27;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;
const MAX_BODY_SIZE = "10kb";
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_TIME = 15 * 60 * 1000;
const MAX_IP_REQUESTS = 80;

/* =======================================================
   STATE
======================================================= */

const mailLimits = new Map();
const loginAttempts = new Map();
const ipRateLimit = new Map();

/* =======================================================
   MIDDLEWARE
======================================================= */

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
      maxAge: 60 * 60 * 1000
    }
  })
);

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// Basic IP rate limit
app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const record = ipRateLimit.get(ip);

  if (!record || now - record.start > 60000) {
    ipRateLimit.set(ip, { count: 1, start: now });
    return next();
  }

  if (record.count >= MAX_IP_REQUESTS) {
    return res.status(429).send("Too many requests");
  }

  record.count++;
  next();
});

/* =======================================================
   HELPERS
======================================================= */

const delay = ms => new Promise(res => setTimeout(res, ms));

const isValidEmail = email =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function sanitizeText(text = "", max = 500) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[\r\n]{3,}/g, "\n\n")
    .replace(/[^\x00-\x7F]/g, "")
    .trim()
    .slice(0, max);
}

function checkHourlyLimit(email, amount) {
  const now = Date.now();
  const record = mailLimits.get(email);

  if (!record || now - record.start > 3600000) {
    mailLimits.set(email, { count: 0, start: now });
  }

  const updated = mailLimits.get(email);

  if (updated.count + amount > MAX_PER_HOUR) {
    return false;
  }

  updated.count += amount;
  return true;
}

async function sendBatch(transporter, mails) {
  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const chunk = mails.slice(i, i + BATCH_SIZE);

    for (const mail of chunk) {
      try {
        await transporter.sendMail(mail);
      } catch (err) {
        console.error("Mail error:", err.message);
      }
    }

    await delay(BATCH_DELAY);
  }
}

/* =======================================================
   AUTH
======================================================= */

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN_CREDENTIAL) return next();
  return res.redirect("/");
}

/* =======================================================
   ROUTES
======================================================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  const ip = req.ip;
  const now = Date.now();

  const record = loginAttempts.get(ip);

  if (record && record.blockUntil > now) {
    return res.json({ success: false, message: "Try later" });
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

app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

/* =======================================================
   SEND
======================================================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const {
      senderName,
      email,
      password,
      recipients,
      subject,
      message
    } = req.body || {};

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
          .filter(isValidEmail)
      )
    ];

    if (!recipientList.length) {
      return res.json({ success: false, message: "No valid recipients" });
    }

    if (!checkHourlyLimit(email, recipientList.length)) {
      return res.json({
        success: false,
        message: `Limit ${MAX_PER_HOUR}/hour exceeded`
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password },
      tls: { rejectUnauthorized: true }
    });

    await transporter.verify();

    const mails = recipientList.map(to => ({
      from: `"${sanitizeText(senderName, 40) || "Sender"}" <${email}>`,
      to,
      subject: sanitizeText(subject, 120) || "Message",
      text: sanitizeText(message, 1000)
    }));

    await sendBatch(transporter, mails);

    return res.json({
      success: true,
      message: `Sent ${recipientList.length}`
    });

  } catch (err) {
    console.error(err);
    return res.json({
      success: false,
      message: "Sending failed"
    });
  }
});

/* =======================================================
   START
======================================================= */

app.listen(PORT, () => {
  console.log(`Secure server running on port ${PORT}`);
});
