require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

const ADMIN = process.env.ADMIN_CREDENTIAL || "@##2588^$$^O^%%^";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(64).toString("hex");

const DAILY_LIMIT = 9500;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_TIME = 15 * 60 * 1000;

/* ================= MEMORY ================= */

const dailyUsage = new Map();
const loginAttempts = new Map();

/* ================= BASIC SECURITY HEADERS ================= */

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

app.disable("x-powered-by");

/* ================= BODY PARSER ================= */

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ================= SESSION ================= */

app.use(
  session({
    name: "secure.sid",
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

function checkDailyLimit(email, amount) {
  const now = Date.now();
  const record = dailyUsage.get(email);

  if (!record || now - record.start > 86400000) {
    dailyUsage.set(email, { count: 0, start: now });
  }

  const updated = dailyUsage.get(email);

  if (updated.count + amount > DAILY_LIMIT) return false;

  updated.count += amount;
  return true;
}

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN) return next();
  return res.status(401).json({ success: false });
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
    return res.json({ success: false, message: "Try later" });
  }

  if (username === ADMIN && password === ADMIN) {
    loginAttempts.delete(ip);
    req.session.user = ADMIN;
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

/* LOGOUT */
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("secure.sid");
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
      auth: { user: email, pass: password }
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
  console.log("Server running on port " + PORT);
});
