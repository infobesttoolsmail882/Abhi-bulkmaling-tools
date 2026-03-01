require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= SECURITY CORE ================= */

app.set("trust proxy", 1);
app.disable("x-powered-by");

/* ================= CONSTANTS ================= */

const ADMIN = "@##2588^$$^*O*^%%^";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(64).toString("hex");

const DAILY_LIMIT = 9500;
const SESSION_LIMIT = 2000;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;

const LOGIN_ATTEMPTS_LIMIT = 5;
const LOGIN_BLOCK_TIME = 15 * 60 * 1000;

/* ================= STATE ================= */

const dailyTracker = new Map();
const loginAttempts = new Map();
const ipRateMap = new Map();

/* ================= MIDDLEWARE ================= */

app.use(express.json({ limit: "15kb" }));
app.use(express.urlencoded({ extended: false, limit: "15kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "secure-session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000
    }
  })
);

/* ================= GLOBAL PROTECTION ================= */

function rateLimitIP(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const windowTime = 60 * 1000;
  const limit = 100;

  if (!ipRateMap.has(ip)) {
    ipRateMap.set(ip, []);
  }

  const timestamps = ipRateMap.get(ip).filter(t => now - t < windowTime);

  if (timestamps.length > limit) {
    return res.status(429).json({ success: false });
  }

  timestamps.push(now);
  ipRateMap.set(ip, timestamps);
  next();
}

app.use(rateLimitIP);

/* ================= HELPERS ================= */

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sanitize(str = "", max = 1000) {
  return str
    .replace(/[\r\n]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, max);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checkDaily(email, count) {
  const now = Date.now();
  const record = dailyTracker.get(email);

  if (!record || now - record.start > 24 * 60 * 60 * 1000) {
    dailyTracker.set(email, { count: 0, start: now });
  }

  const updated = dailyTracker.get(email);

  if (updated.count + count > DAILY_LIMIT) return false;

  updated.count += count;
  return true;
}

function auth(req, res, next) {
  if (req.session.user === ADMIN) return next();
  return res.redirect("/");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

/* LOGIN PROTECTION */
app.post("/login", (req, res) => {
  const ip = req.ip;
  const now = Date.now();

  const attempt = loginAttempts.get(ip);

  if (attempt && attempt.blockUntil > now) {
    return res.json({ success: false });
  }

  const { username, password } = req.body || {};

  if (username === ADMIN && password === ADMIN) {
    loginAttempts.delete(ip);

    req.session.user = ADMIN;
    req.session.sent = 0;

    return req.session.save(() =>
      res.json({ success: true, redirect: "/launcher" })
    );
  }

  if (!attempt) {
    loginAttempts.set(ip, { count: 1, blockUntil: 0 });
  } else {
    attempt.count += 1;

    if (attempt.count >= LOGIN_ATTEMPTS_LIMIT) {
      attempt.blockUntil = now + LOGIN_BLOCK_TIME;
      attempt.count = 0;
    }
  }

  return res.json({ success: false });
});

app.get("/launcher", auth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("secure-session");
    res.json({ success: true });
  });
});

/* ================= MAIL SEND ================= */

app.post("/send", auth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } =
      req.body || {};

    if (!validEmail(email)) return res.json({ success: false });

    const list = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(validEmail)
      )
    ];

    if (!list.length) return res.json({ success: false });

    if (req.session.sent + list.length > SESSION_LIMIT)
      return res.json({ success: false });

    if (!checkDaily(email, list.length))
      return res.json({ success: false });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass: password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });

    await transporter.verify();

    let sent = 0;

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE);

      for (const to of batch) {
        try {
          await transporter.sendMail({
            from: `"${sanitize(senderName, 40) || "Sender"}" <${email}>`,
            to,
            subject: sanitize(subject, 150),
            text: sanitize(message, 3000)
          });
          sent++;
        } catch {}
      }

      await delay(BATCH_DELAY + Math.floor(Math.random() * 200));
    }

    req.session.sent += sent;

    return res.json({ success: true, message: `Sent ${sent}` });
  } catch {
    return res.json({ success: false });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Ultra Secure Server Running on " + PORT);
});
