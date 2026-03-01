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

/* ================= CONFIG ================= */

const ADMIN = "@##2588^$$^*O*^%%^"; // same login id & password

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(64).toString("hex");

const DAILY_LIMIT = 500;
const SESSION_LIMIT = 300;

const BATCH_SIZE = 5;     // SAME SPEED
const BATCH_DELAY = 300;  // SAME DELAY

const LOGIN_LIMIT = 5;
const LOGIN_BLOCK_TIME = 15 * 60 * 1000;

/* ================= STATE TRACKERS ================= */

const dailyTracker = new Map();
const loginAttempts = new Map();
const ipRateTracker = new Map();

/* ================= MIDDLEWARE ================= */

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
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
      maxAge: 60 * 60 * 1000 // 1 hour auto logout
    }
  })
);

/* ================= GLOBAL IP RATE PROTECTION ================= */

app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const windowTime = 60 * 1000;

  if (!ipRateTracker.has(ip)) ipRateTracker.set(ip, []);

  const requests = ipRateTracker
    .get(ip)
    .filter(t => now - t < windowTime);

  if (requests.length > 120)
    return res.status(429).send("Too many requests");

  requests.push(now);
  ipRateTracker.set(ip, requests);
  next();
});

/* ================= HELPERS ================= */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitize(text = "", max = 1000) {
  return text
    .replace(/[\r\n]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, max);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checkDailyLimit(email, count) {
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

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN) return next();
  return res.redirect("/");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

/* ================= LOGIN ================= */

app.post("/login", (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (record && record.blockUntil > now)
    return res.json({ success: false });

  const { username, password } = req.body || {};

  if (username === ADMIN && password === ADMIN) {
    loginAttempts.delete(ip);

    req.session.user = ADMIN;
    req.session.sent = 0;

    return req.session.save(() =>
      res.json({ success: true, redirect: "/launcher" })
    );
  }

  if (!record) {
    loginAttempts.set(ip, { count: 1, blockUntil: 0 });
  } else {
    record.count++;
    if (record.count >= LOGIN_LIMIT) {
      record.blockUntil = now + LOGIN_BLOCK_TIME;
      record.count = 0;
    }
  }

  return res.json({ success: false });
});

/* ================= LAUNCHER ================= */

app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

/* ================= LOGOUT ================= */

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("secure-session");
    res.json({ success: true });
  });
});

/* ================= SEND EMAIL ================= */

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

    if (!isValidEmail(email))
      return res.json({ success: false });

    const recipientList = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(isValidEmail)
      )
    ];

    if (!recipientList.length)
      return res.json({ success: false });

    if (req.session.sent + recipientList.length > SESSION_LIMIT)
      return res.json({ success: false });

    if (!checkDailyLimit(email, recipientList.length))
      return res.json({ success: false });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass: password },
      pool: true,
      maxConnections: 2,
      maxMessages: 100
    });

    await transporter.verify();

    let successCount = 0;

    for (let i = 0; i < recipientList.length; i += BATCH_SIZE) {
      const batch = recipientList.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(to =>
          transporter.sendMail({
            from: `"${sanitize(senderName, 40) || "Sender"}" <${email}>`,
            to,
            subject: sanitize(subject, 120),
            text: sanitize(message, 2000)
          })
        )
      );

      results.forEach(r => {
        if (r.status === "fulfilled") successCount++;
      });

      await delay(BATCH_DELAY); // SAME SPEED
    }

    req.session.sent += successCount;

    return res.json({
      success: true,
      message: `Send ${successCount}`
    });

  } catch (err) {
    return res.json({ success: false });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
