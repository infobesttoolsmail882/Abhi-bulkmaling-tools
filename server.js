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

/* ===== SAFE LIMITS (Gmail Friendly) ===== */

const DAILY_LIMIT = 300;                 // Safe Gmail range
const MAX_PER_BATCH = 3;                 // Small human-like batch
const MIN_DELAY = 1200;                  // 1.2s
const MAX_DELAY = 2500;                  // 2.5s random delay
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_TIME = 15 * 60 * 1000;
const IP_RATE_LIMIT = 100;
const MAX_BODY_SIZE = "12kb";

/* ================= STATE ================= */

const dailyLimitMap = new Map();
const loginAttempts = new Map();
const ipLimit = new Map();

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
      maxAge: 60 * 60 * 1000
    }
  })
);

/* ===== SECURITY HEADERS ===== */

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

/* ===== IP RATE LIMIT ===== */

app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();

  const record = ipLimit.get(ip);
  if (!record || now - record.start > 60000) {
    ipLimit.set(ip, { count: 1, start: now });
    return next();
  }

  if (record.count >= IP_RATE_LIMIT) {
    return res.status(429).send("Too many requests");
  }

  record.count++;
  next();
});

/* ================= HELPERS ================= */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay() {
  return Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY)) + MIN_DELAY;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function clean(text = "", max = 800) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
}

/* ===== DAILY LIMIT (24h rolling) ===== */

function checkDailyLimit(sender, count) {
  const now = Date.now();
  let record = dailyLimitMap.get(sender);

  if (!record || now - record.start > 24 * 60 * 60 * 1000) {
    record = { count: 0, start: now };
    dailyLimitMap.set(sender, record);
  }

  if (record.count + count > DAILY_LIMIT) return false;

  record.count += count;
  return true;
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

  return res.json({ success: false });
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

/* ================= SEND ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } =
      req.body || {};

    if (!email || !password || !recipients)
      return res.json({ success: false, message: "Missing fields" });

    if (!isValidEmail(email))
      return res.json({ success: false, message: "Invalid email" });

    const list = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(isValidEmail)
      )
    ];

    if (!list.length)
      return res.json({ success: false, message: "No valid recipients" });

    if (!checkDailyLimit(email, list.length))
      return res.json({
        success: false,
        message: "Daily limit reached (300)"
      });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass: password }
    });

    await transporter.verify();

    for (let i = 0; i < list.length; i += MAX_PER_BATCH) {
      const chunk = list.slice(i, i + MAX_PER_BATCH);

      for (const to of chunk) {
        await transporter.sendMail({
          from: `"${clean(senderName, 40) || "Sender"}" <${email}>`,
          to,
          subject: clean(subject, 120) || "Message",
          text: clean(message)
        });

        await delay(randomDelay());
      }
    }

    res.json({ success: true, message: "Emails sent safely" });

  } catch (err) {
    res.json({ success: false, message: "Sending failed" });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Safe Mail Server running on port " + PORT);
});
