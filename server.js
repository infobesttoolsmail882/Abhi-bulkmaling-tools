require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "StrongPassword123!";

const SMTP_USER = "yourgmail@gmail.com";
const SMTP_PASS = "your_app_password_here";

const BATCH_SIZE = 5;
const BATCH_DELAY = 300;
const DAILY_LIMIT = 9500;
const SESSION_TIMEOUT = 60 * 60 * 1000;

/* ================= STATE ================= */

let dailyCount = 0;
let dailyStart = Date.now();

/* ================= MIDDLEWARE ================= */

app.use(bodyParser.json({ limit: "10kb" }));
app.use(bodyParser.urlencoded({ extended: false, limit: "10kb" }));

app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "secure_random_key_12345",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: SESSION_TIMEOUT
    }
  })
);

/* ================= ROOT FIX ================= */

// 👇 THIS FIXES "Cannot GET /"
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

/* ================= HELPERS ================= */

const delay = ms => new Promise(r => setTimeout(r, ms));

const isValidEmail = email =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function resetDailyIfNeeded() {
  if (Date.now() - dailyStart >= 24 * 60 * 60 * 1000) {
    dailyCount = 0;
    dailyStart = Date.now();
  }
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Session expired"
    });
  }
  next();
}

/* ================= AUTH ================= */

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
    resetDailyIfNeeded();

    const { recipients, subject, message } = req.body;

    if (!recipients || !subject || !message) {
      return res.json({ success: false, message: "Missing fields" });
    }

    const emailList = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(e => e.trim())
          .filter(isValidEmail)
      )
    ];

    if (!emailList.length) {
      return res.json({ success: false, message: "No valid emails" });
    }

    if (dailyCount + emailList.length > DAILY_LIMIT) {
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
        dailyCount++;
      }

      await delay(BATCH_DELAY);
    }

    res.json({ success: true, sent });

  } catch (err) {
    console.error(err.message);
    res.json({ success: false, message: "Sending failed" });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
