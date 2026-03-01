const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 8080;

/* ================= CONFIG ================= */

const ADMIN_CREDENTIAL = "@##2588^$$^O^%%^";
const SESSION_SECRET = crypto.randomBytes(64).toString("hex");

const BATCH_SIZE = 5;          // requested speed
const BATCH_DELAY = 300;       // requested delay
const SESSION_TIMEOUT = 60 * 60 * 1000; // 1 hour
const MAX_BODY_SIZE = "15kb";
const DAILY_LIMIT = 500; // safe practical limit (not abuse)

/* ================= STATE ================= */

const ipLimiter = new Map();
const loginLimiter = new Map();
const dailyLimiter = new Map();

/* ================= BASIC SECURITY ================= */

app.disable("x-powered-by");

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
      maxAge: SESSION_TIMEOUT
    }
  })
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

/* ================= RATE LIMIT ================= */

app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const record = ipLimiter.get(ip);

  if (!record || now - record.time > 60000) {
    ipLimiter.set(ip, { count: 1, time: now });
    return next();
  }

  if (record.count > 120) {
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
    .replace(/\s{3,}/g, " ")
    .trim()
    .slice(0, max);
}

function checkDailyLimit(email, count) {
  const now = Date.now();
  const record = dailyLimiter.get(email);

  if (!record || now - record.start > 86400000) {
    dailyLimiter.set(email, { count: 0, start: now });
  }

  const updated = dailyLimiter.get(email);

  if (updated.count + count > DAILY_LIMIT) {
    return false;
  }

  updated.count += count;
  return true;
}

/* ================= AUTH ================= */

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN_CREDENTIAL) return next();
  return res.redirect("/");
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  const ip = req.ip;
  const now = Date.now();

  const record = loginLimiter.get(ip);

  if (record && record.blockUntil > now) {
    return res.json({ success: false, message: "Try later" });
  }

  if (username === ADMIN_CREDENTIAL && password === ADMIN_CREDENTIAL) {
    loginLimiter.delete(ip);
    req.session.user = ADMIN_CREDENTIAL;
    return res.json({ success: true });
  }

  if (!record) {
    loginLimiter.set(ip, { count: 1 });
  } else {
    record.count++;
    if (record.count >= 5) {
      record.blockUntil = now + 15 * 60 * 1000;
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
        message: "Daily limit reached"
      });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass: password },
      pool: true,
      maxConnections: 2,
      maxMessages: 50,
      connectionTimeout: 10000,
      socketTimeout: 15000
    });

    await transporter.verify();

    let sentCount = 0;

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(to =>
          transporter.sendMail({
            from: `"${sanitize(senderName, 40) || "Sender"}" <${email}>`,
            to,
            subject: sanitize(subject, 120) || "Message",
            text: sanitize(message, 2000)
          })
        )
      );

      results.forEach(r => {
        if (r.status === "fulfilled") sentCount++;
      });

      await delay(BATCH_DELAY);
    }

    return res.json({
      success: true,
      message: `Send ${sentCount}`
    });

  } catch {
    return res.json({
      success: false,
      message: "Sending failed"
    });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Secure mail server running on port " + PORT);
});
