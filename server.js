require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

const ADMIN_KEY = process.env.ADMIN_KEY || "@##2588^$$^*O*^%%^";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(64).toString("hex");

const MAX_PER_HOUR = 27;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;
const MAX_BODY_SIZE = "20kb";
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_TIME = 15 * 60 * 1000;

/* ================= STATE ================= */

const mailLimits = new Map();
const loginAttempts = new Map();
const ipLimiter = new Map();

/* ================= APP SETUP ================= */

app.set("trust proxy", 1);

app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(express.urlencoded({ extended: false, limit: MAX_BODY_SIZE }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "secure.session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000
    }
  })
);

/* ================= SECURITY HEADERS ================= */

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

/* ================= GLOBAL RATE LIMIT ================= */

app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const record = ipLimiter.get(ip);

  if (!record || now - record.start > 60000) {
    ipLimiter.set(ip, { count: 1, start: now });
    return next();
  }

  if (record.count >= 120) {
    return res.status(429).json({ success: false, message: "Too many requests" });
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

function sanitize(text = "") {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/(.)\1{4,}/g, "$1$1")
    .replace(/[!]{3,}/g, "!!")
    .replace(/[?]{3,}/g, "??")
    .trim()
    .slice(0, 1000);
}

function checkLimit(sender, amount) {
  const now = Date.now();
  const record = mailLimits.get(sender);

  if (!record || now - record.start > 3600000) {
    mailLimits.set(sender, { count: 0, start: now });
  }

  const updated = mailLimits.get(sender);

  if (updated.count + amount > MAX_PER_HOUR) {
    return false;
  }

  updated.count += amount;
  return true;
}

async function sendBatch(transporter, mails) {
  let success = 0;

  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const chunk = mails.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      chunk.map(mail => transporter.sendMail(mail))
    );

    results.forEach(r => {
      if (r.status === "fulfilled") success++;
    });

    await delay(BATCH_DELAY);
  }

  return success;
}

/* ================= AUTH ================= */

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN_KEY) return next();
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
    return res.json({ success: false, message: "Blocked temporarily" });
  }

  if (username === ADMIN_KEY && password === ADMIN_KEY) {
    loginAttempts.delete(ip);
    req.session.user = ADMIN_KEY;
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
    res.clearCookie("secure.session");
    res.json({ success: true });
  });
});

/* ================= SEND ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } =
      req.body || {};

    if (!email || !password || !recipients) {
      return res.json({ success: false, message: "Missing fields" });
    }

    if (!isValidEmail(email)) {
      return res.json({ success: false, message: "Invalid sender email" });
    }

    const list = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(r => isValidEmail(r))
      )
    ];

    if (!list.length) {
      return res.json({ success: false, message: "No valid recipients" });
    }

    if (!checkLimit(email, list.length)) {
      return res.json({
        success: false,
        message: `Limit ${MAX_PER_HOUR}/hour reached`
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      auth: { user: email, pass: password }
    });

    await transporter.verify();

    const mails = list.map(to => ({
      from: `"${sanitize(senderName).slice(0, 50) || "Sender"}" <${email}>`,
      to,
      subject: sanitize(subject).slice(0, 150) || "Message",
      text: sanitize(message)
    }));

    const sentCount = await sendBatch(transporter, mails);

    return res.json({
      success: true,
      message: `Send ${sentCount}`
    });

  } catch (err) {
    return res.json({
      success: false,
      message: "Send failed"
    });
  }
});

/* ================= CLEANUP ================= */

setInterval(() => {
  const now = Date.now();

  for (const [key, value] of mailLimits.entries()) {
    if (now - value.start > 3600000) {
      mailLimits.delete(key);
    }
  }

  for (const [ip, record] of loginAttempts.entries()) {
    if (record.blockUntil && now > record.blockUntil) {
      loginAttempts.delete(ip);
    }
  }
}, 10 * 60 * 1000);

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
