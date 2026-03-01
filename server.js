require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

const ADMIN = process.env.ADMIN_CREDENTIAL || "@##2588^$$^O^%%^";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(64).toString("hex");

const DAILY_LIMIT = 9500;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_TIME = 15 * 60 * 1000;

/* ================= MEMORY STORE ================= */

const dailyUsage = new Map();
const loginAttempts = new Map();

/* ================= MIDDLEWARE ================= */

app.use(helmet());

app.use(express.json({ limit: "25kb" }));
app.use(express.urlencoded({ extended: false, limit: "25kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "fastmailer.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // true if using HTTPS
      sameSite: "strict",
      maxAge: 60 * 60 * 1000
    }
  })
);

app.disable("x-powered-by");

/* IP Rate Protection */
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100
  })
);

/* ================= HELPERS ================= */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function clean(text = "", max = 1000) {
  return text
    .replace(/<[^>]*>?/gm, "")
    .replace(/[^\x00-\x7F]/g, "")
    .trim()
    .slice(0, max);
}

function checkDailyLimit(email, count) {
  const now = Date.now();
  const record = dailyUsage.get(email);

  if (!record || now - record.start > 86400000) {
    dailyUsage.set(email, { count: 0, start: now });
  }

  const updated = dailyUsage.get(email);

  if (updated.count + count > DAILY_LIMIT) {
    return false;
  }

  updated.count += count;
  return true;
}

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN) return next();
  return res.status(401).json({
    success: false,
    message: "Unauthorized"
  });
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

/* LOGIN */
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip;
  const now = Date.now();

  const record = loginAttempts.get(ip);

  if (record && record.blockUntil > now) {
    return res.json({
      success: false,
      message: "Too many attempts. Try later."
    });
  }

  if (username === ADMIN && password === ADMIN) {
    loginAttempts.delete(ip);
    req.session.user = ADMIN;
    return res.json({
      success: true,
      message: "Login successful"
    });
  }

  if (!record) {
    loginAttempts.set(ip, { count: 1 });
  } else {
    record.count++;
    if (record.count >= LOGIN_MAX_ATTEMPTS) {
      record.blockUntil = now + LOGIN_BLOCK_TIME;
    }
  }

  return res.json({
    success: false,
    message: "Invalid credentials"
  });
});

app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("fastmailer.sid");
    res.json({ success: true });
  });
});

/* SEND MAIL */
app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, subject, message, recipients } =
      req.body;

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
        message: "24 hour limit reached"
      });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass: password },
      pool: true,
      maxConnections: 2,
      maxMessages: 50
    });

    await transporter.verify();

    let sent = 0;

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(to =>
          transporter.sendMail({
            from: `"${clean(senderName, 40) || "Sender"}" <${email}>`,
            to,
            subject: clean(subject, 120) || "Message",
            text: clean(message, 3000)
          })
        )
      );

      results.forEach(r => {
        if (r.status === "fulfilled") sent++;
      });

      await delay(BATCH_DELAY);
    }

    return res.json({
      success: true,
      message: `Send ${sent}`
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
  console.log("Secure server running on port " + PORT);
});
