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

const {
  SESSION_SECRET,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS
} = process.env;

if (!SESSION_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.error("Missing environment variables");
  process.exit(1);
}

const MAX_PER_HOUR = 20;
const MAX_BODY_SIZE = "8kb";

/* ================= STATE ================= */

const mailLimits = new Map();

/* ================= SECURITY ================= */

app.disable("x-powered-by");
app.use(helmet());

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
      secure: false, // true if HTTPS
      sameSite: "strict",
      maxAge: 60 * 60 * 1000
    }
  })
);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: "Too many requests"
});

app.use("/send", apiLimiter);

/* ================= HELPERS ================= */

const isValidEmail = email =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function cleanText(text = "", max = 500) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s{3,}/g, " ")
    .trim()
    .slice(0, max);
}

function checkHourlyLimit(email, count) {
  const now = Date.now();
  const record = mailLimits.get(email);

  if (!record || now - record.start > 3600000) {
    mailLimits.set(email, { count: 0, start: now });
  }

  const updated = mailLimits.get(email);

  if (updated.count + count > MAX_PER_HOUR) return false;

  updated.count += count;
  return true;
}

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN_USERNAME) return next();
  return res.status(401).json({ success: false });
}

/* ================= ROUTES ================= */

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.user = ADMIN_USERNAME;
    return res.json({ success: true });
  }

  return res.json({ success: false });
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
    const { recipients, subject, message } = req.body || {};

    if (!recipients || !subject || !message)
      return res.json({ success: false, message: "Missing fields" });

    const recipientList = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(isValidEmail)
      )
    ];

    if (!recipientList.length)
      return res.json({ success: false, message: "No valid recipients" });

    if (!checkHourlyLimit(SMTP_USER, recipientList.length))
      return res.json({
        success: false,
        message: "Hourly limit exceeded"
      });

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: true,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });

    await transporter.verify();

    let sentCount = 0;

    for (const to of recipientList) {
      await transporter.sendMail({
        from: SMTP_USER,
        to,
        subject: cleanText(subject, 120),
        text: cleanText(message, 1000)
      });
      sentCount++;
    }

    return res.json({
      success: true,
      message: `Sent ${sentCount} emails`
    });

  } catch (err) {
    console.error(err);
    return res.json({
      success: false,
      message: "Sending failed"
    });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
