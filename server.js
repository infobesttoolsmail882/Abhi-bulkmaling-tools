const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

// 🔐 CHANGE THESE
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "StrongPassword123!";

// Gmail App Password (not normal password)
const SMTP_USER = "yourgmail@gmail.com";
const SMTP_PASS = "your_app_password_here";

// Sending Control
const BATCH_SIZE = 5;
const BATCH_DELAY = 300; // ms between batches
const DAILY_LIMIT = 9500;
const SESSION_TIMEOUT = 60 * 60 * 1000; // 1 hour

/* ================= STATE ================= */

let dailyCounter = 0;
let dailyStartTime = Date.now();

/* ================= SECURITY ================= */

app.disable("x-powered-by");
app.use(helmet());

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "ultra_secure_random_key_123",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      maxAge: SESSION_TIMEOUT
    }
  })
);

// Global API limiter
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50
  })
);

/* ================= HELPERS ================= */

const isValidEmail = email =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "Session expired" });
  }
  next();
}

function resetDailyLimitIfNeeded() {
  const now = Date.now();
  if (now - dailyStartTime >= 24 * 60 * 60 * 1000) {
    dailyCounter = 0;
    dailyStartTime = now;
  }
}

const delay = ms => new Promise(res => setTimeout(res, ms));

/* ================= ROUTES ================= */

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.user = ADMIN_USERNAME;
    return res.json({ success: true });
  }

  res.json({ success: false });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/* ================= SEND MAIL ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    resetDailyLimitIfNeeded();

    const { recipients, subject, message } = req.body;

    if (!recipients || !subject || !message)
      return res.json({ success: false, message: "Missing fields" });

    const emailList = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(e => e.trim())
          .filter(isValidEmail)
      )
    ];

    if (!emailList.length)
      return res.json({ success: false, message: "No valid emails" });

    if (dailyCounter + emailList.length > DAILY_LIMIT) {
      return res.json({
        success: false,
        message: "24 hour limit exceeded"
      });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });

    await transporter.verify();

    let sent = 0;

    for (let i = 0; i < emailList.length; i += BATCH_SIZE) {
      const batch = emailList.slice(i, i + BATCH_SIZE);

      for (const to of batch) {
        await transporter.sendMail({
          from: SMTP_USER,
          to,
          subject: subject.substring(0, 120),
          text: message.substring(0, 2000)
        });
        sent++;
        dailyCounter++;
      }

      await delay(BATCH_DELAY);
    }

    res.json({ success: true, sent });

  } catch (err) {
    console.error("Send error:", err.message);
    res.json({ success: false, message: "Sending failed" });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Secure server running on port " + PORT);
});
