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
  process.env.SESSION_SECRET || crypto.randomBytes(64).toString("hex");

const DAILY_LIMIT = 9500;
const PER_REQUEST_LIMIT = 200;
const SESSION_LIMIT = 2000;

const BATCH_SIZE = 5;
const BATCH_DELAY = 300;

const MAX_BODY = "25kb";
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_TIME = 15 * 60 * 1000;

/* ================= STATE ================= */

const dailyLimits = new Map();
const loginAttempts = new Map();
const ipLimiter = new Map();

/* ================= MIDDLEWARE ================= */

app.disable("x-powered-by");

app.use(express.json({ limit: MAX_BODY }));
app.use(express.urlencoded({ extended: false, limit: MAX_BODY }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "secure-mail-session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      maxAge: 60 * 60 * 1000
    }
  })
);

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=()");
  next();
});

// IP rate limiter
app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const record = ipLimiter.get(ip);

  if (!record || now - record.start > 60000) {
    ipLimiter.set(ip, { count: 1, start: now });
    return next();
  }

  if (record.count > 100)
    return res.status(429).send("Too many requests");

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
    .replace(/[\r\n]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, max);
}

function checkDailyLimit(email, amount) {
  const now = Date.now();
  const record = dailyLimits.get(email);

  if (!record || now - record.start > 24 * 60 * 60 * 1000) {
    dailyLimits.set(email, { count: 0, start: now });
  }

  const updated = dailyLimits.get(email);

  if (updated.count + amount > DAILY_LIMIT) return false;

  updated.count += amount;
  return true;
}

async function sendInBatches(transporter, mails) {
  let sent = 0;

  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const chunk = mails.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      chunk.map(mail => transporter.sendMail(mail))
    );

    results.forEach(r => {
      if (r.status === "fulfilled") sent++;
    });

    await delay(BATCH_DELAY);
  }

  return sent;
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

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  const ip = req.ip;
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (record && record.blockUntil > now)
    return res.json({ success: false, message: "Blocked. Try later." });

  if (
    username === ADMIN_CREDENTIAL &&
    password === ADMIN_CREDENTIAL
  ) {
    loginAttempts.delete(ip);
    req.session.user = ADMIN_CREDENTIAL;
    req.session.sent = 0;
    return res.json({ success: true });
  }

  if (!record) {
    loginAttempts.set(ip, { count: 1 });
  } else {
    record.count++;
    if (record.count >= LOGIN_MAX_ATTEMPTS)
      record.blockUntil = now + LOGIN_BLOCK_TIME;
  }

  return res.json({ success: false });
});

app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("secure-mail-session");
    res.json({ success: true });
  });
});

/* ================= SEND ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } =
      req.body || {};

    if (!email || !password || !recipients)
      return res.json({ success: false });

    if (!isValidEmail(email))
      return res.json({ success: false });

    const list = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(isValidEmail)
      )
    ];

    if (!list.length || list.length > PER_REQUEST_LIMIT)
      return res.json({ success: false });

    if (req.session.sent + list.length > SESSION_LIMIT)
      return res.json({ success: false });

    if (!checkDailyLimit(email, list.length))
      return res.json({ success: false });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass: password },
      connectionTimeout: 10000,
      greetingTimeout: 10000
    });

    await transporter.verify();

    const mails = list.map(to => ({
      from: `"${sanitize(senderName, 50) || "Sender"}" <${email}>`,
      to,
      subject: sanitize(subject, 150),
      text: sanitize(message, 3000)
    }));

    const sentCount = await sendInBatches(transporter, mails);

    req.session.sent += sentCount;

    return res.json({
      success: true,
      message: `Sent ${sentCount}`
    });

  } catch (err) {
    return res.json({ success: false });
  }
});

/* ================= CLEANUP ================= */

// auto cleanup every hour
setInterval(() => {
  const now = Date.now();
  for (let [key, value] of dailyLimits) {
    if (now - value.start > 24 * 60 * 60 * 1000)
      dailyLimits.delete(key);
  }
}, 60 * 60 * 1000);

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Secure server running on port " + PORT);
});
